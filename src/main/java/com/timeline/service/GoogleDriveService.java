package com.timeline.service;

import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.http.ByteArrayContent;
import com.google.api.client.http.GenericUrl;
import com.google.api.client.http.HttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.model.File;
import com.google.api.services.drive.model.FileList;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.AccessToken;
import com.google.auth.oauth2.UserCredentials;
import com.timeline.domain.entity.GoogleDriveConfig;
import com.timeline.domain.repository.GoogleDriveConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class GoogleDriveService {

    private final GoogleDriveConfigRepository configRepository;

    private static final String BACKUP_PREFIX = "timeline-backup-";
    private static final String MIME_JSON = "application/json";
    private static final String SCOPE = "https://www.googleapis.com/auth/drive.file";
    private static final String AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URI = "https://oauth2.googleapis.com/token";

    // ---- 설정 관리 ----

    @Transactional(readOnly = true)
    public boolean isConfigured() {
        return configRepository.findAll().stream()
                .anyMatch(c -> c.getRefreshToken() != null && !c.getRefreshToken().isBlank());
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getConfig() {
        var config = configRepository.findAll().stream().findFirst().orElse(null);
        Map<String, Object> result = new LinkedHashMap<>();
        if (config != null) {
            boolean authorized = config.getRefreshToken() != null && !config.getRefreshToken().isBlank();
            result.put("configured", authorized);
            result.put("hasClientId", config.getClientId() != null && !config.getClientId().isBlank());
            result.put("authorized", authorized);
            result.put("folderId", config.getFolderId());
        } else {
            result.put("configured", false);
            result.put("hasClientId", false);
            result.put("authorized", false);
            result.put("folderId", null);
        }
        return result;
    }

    @Transactional
    public void saveClientConfig(String clientId, String clientSecret, String folderId) {
        if (clientId == null || clientId.isBlank()) {
            throw new IllegalArgumentException("Client ID는 필수입니다.");
        }
        if (clientSecret == null || clientSecret.isBlank()) {
            throw new IllegalArgumentException("Client Secret은 필수입니다.");
        }

        var config = configRepository.findAll().stream().findFirst()
                .orElse(GoogleDriveConfig.builder().build());
        config.setClientId(clientId.trim());
        config.setClientSecret(clientSecret.trim());
        config.setFolderId(folderId != null && !folderId.isBlank() ? folderId.trim() : null);
        configRepository.save(config);
        log.info("Google Drive OAuth2 설정 저장 완료");
    }

    /**
     * Google OAuth2 인증 URL 생성
     */
    @Transactional(readOnly = true)
    public String getAuthUrl(String redirectUri) {
        var config = configRepository.findAll().stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("Google Drive Client ID가 설정되지 않았습니다."));

        return AUTH_URI
                + "?client_id=" + URLEncoder.encode(config.getClientId(), StandardCharsets.UTF_8)
                + "&redirect_uri=" + URLEncoder.encode(redirectUri, StandardCharsets.UTF_8)
                + "&response_type=code"
                + "&scope=" + URLEncoder.encode(SCOPE, StandardCharsets.UTF_8)
                + "&access_type=offline"
                + "&prompt=consent";
    }

    /**
     * 인증 코드로 refresh token 교환 후 저장
     */
    @Transactional
    public void exchangeCodeForToken(String code, String redirectUri) throws IOException {
        var config = configRepository.findAll().stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("Google Drive Client ID가 설정되지 않았습니다."));

        try {
            HttpTransport transport = GoogleNetHttpTransport.newTrustedTransport();
            com.google.api.client.http.HttpRequestFactory requestFactory = transport.createRequestFactory();

            String postBody = "code=" + URLEncoder.encode(code, StandardCharsets.UTF_8)
                    + "&client_id=" + URLEncoder.encode(config.getClientId(), StandardCharsets.UTF_8)
                    + "&client_secret=" + URLEncoder.encode(config.getClientSecret(), StandardCharsets.UTF_8)
                    + "&redirect_uri=" + URLEncoder.encode(redirectUri, StandardCharsets.UTF_8)
                    + "&grant_type=authorization_code";

            var request = requestFactory.buildPostRequest(
                    new GenericUrl(TOKEN_URI),
                    new com.google.api.client.http.ByteArrayContent("application/x-www-form-urlencoded", postBody.getBytes(StandardCharsets.UTF_8)));
            var response = request.execute();
            String responseBody = new String(response.getContent().readAllBytes(), StandardCharsets.UTF_8);

            // JSON 파싱
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            var json = mapper.readTree(responseBody);

            String refreshToken = json.has("refresh_token") ? json.get("refresh_token").asText() : null;
            if (refreshToken == null || refreshToken.isBlank()) {
                throw new IOException("refresh_token을 받지 못했습니다. Google Cloud Console에서 앱을 제거 후 다시 시도해주세요.");
            }

            config.setRefreshToken(refreshToken);
            configRepository.save(config);
            log.info("Google Drive OAuth2 인증 완료, refresh token 저장됨");
        } catch (Exception e) {
            throw new IOException("토큰 교환 실패: " + e.getMessage(), e);
        }
    }

    @Transactional
    public void deleteConfig() {
        configRepository.deleteAll();
        log.info("Google Drive 설정 삭제 완료");
    }

    // ---- Drive 연동 ----

    private Drive buildDriveService() throws IOException {
        var config = configRepository.findAll().stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("Google Drive가 설정되지 않았습니다."));
        if (config.getRefreshToken() == null || config.getRefreshToken().isBlank()) {
            throw new IllegalStateException("Google Drive 인증이 완료되지 않았습니다.");
        }

        try {
            UserCredentials credentials = UserCredentials.newBuilder()
                    .setClientId(config.getClientId())
                    .setClientSecret(config.getClientSecret())
                    .setRefreshToken(config.getRefreshToken())
                    .build();

            credentials.refreshIfExpired();

            return new Drive.Builder(
                    GoogleNetHttpTransport.newTrustedTransport(),
                    GsonFactory.getDefaultInstance(),
                    new HttpCredentialsAdapter(credentials))
                    .setApplicationName("Timeline")
                    .build();
        } catch (Exception e) {
            throw new IOException("Google Drive 서비스 초기화 실패: " + e.getMessage(), e);
        }
    }

    private String getFolderId() {
        return configRepository.findAll().stream().findFirst()
                .map(GoogleDriveConfig::getFolderId)
                .orElse(null);
    }

    public Map<String, Object> upload(byte[] jsonBytes) throws IOException {
        Drive drive = buildDriveService();
        String folderIdVal = getFolderId();

        String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HHmmss"));
        String fileName = BACKUP_PREFIX + timestamp + ".json";

        File fileMetadata = new File();
        fileMetadata.setName(fileName);
        fileMetadata.setMimeType(MIME_JSON);
        if (folderIdVal != null && !folderIdVal.isBlank()) {
            fileMetadata.setParents(Collections.singletonList(folderIdVal));
        }

        ByteArrayContent content = new ByteArrayContent(MIME_JSON, jsonBytes);
        File uploaded = drive.files().create(fileMetadata, content)
                .setFields("id, name, size, createdTime")
                .execute();

        log.info("Google Drive 백업 완료: fileId={}, name={}, size={}", uploaded.getId(), uploaded.getName(), uploaded.getSize());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fileId", uploaded.getId());
        result.put("fileName", uploaded.getName());
        result.put("size", uploaded.getSize());
        return result;
    }

    public List<Map<String, Object>> listBackups() throws IOException {
        Drive drive = buildDriveService();
        String folderIdVal = getFolderId();

        String query = "name contains '" + BACKUP_PREFIX + "' and mimeType = '" + MIME_JSON + "' and trashed = false";
        if (folderIdVal != null && !folderIdVal.isBlank()) {
            query += " and '" + folderIdVal + "' in parents";
        }

        FileList fileList = drive.files().list()
                .setQ(query)
                .setFields("files(id, name, size, createdTime)")
                .setOrderBy("createdTime desc")
                .setPageSize(20)
                .execute();

        return fileList.getFiles().stream().map(f -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("fileId", f.getId());
            map.put("fileName", f.getName());
            map.put("size", f.getSize());
            map.put("createdTime", f.getCreatedTime() != null ? f.getCreatedTime().toString() : null);
            return map;
        }).collect(Collectors.toList());
    }

    public byte[] download(String fileId) throws IOException {
        Drive drive = buildDriveService();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        drive.files().get(fileId).executeMediaAndDownloadTo(out);
        return out.toByteArray();
    }

    public void delete(String fileId) throws IOException {
        Drive drive = buildDriveService();
        drive.files().delete(fileId).execute();
        log.info("Google Drive 백업 파일 삭제: fileId={}", fileId);
    }
}
