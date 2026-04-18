package com.timeline.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timeline.dto.BackupDto;
import com.timeline.service.DataBackupService;
import com.timeline.service.GoogleDriveService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.Map;

/**
 * 데이터 Export/Import REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/data")
@RequiredArgsConstructor
public class DataBackupController {

    private final DataBackupService dataBackupService;
    private final GoogleDriveService googleDriveService;
    private final ObjectMapper objectMapper;

    /**
     * 전체 DB 데이터 Export (JSON 파일 다운로드)
     */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export() {
        log.info("데이터 Export 요청");

        BackupDto.Snapshot snapshot = dataBackupService.exportAll();

        try {
            byte[] jsonBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(snapshot);
            String filename = "timeline-backup-" + LocalDate.now() + ".json";

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(jsonBytes);
        } catch (Exception e) {
            log.error("Export JSON 직렬화 실패", e);
            throw new RuntimeException("Export 처리 중 오류가 발생했습니다.", e);
        }
    }

    /**
     * JSON 파일 Import (전체 데이터 교체)
     */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> importData(@RequestParam("file") MultipartFile file) {
        log.info("데이터 Import 요청: size={}", file.getSize());

        if (file.isEmpty()) {
            throw new IllegalArgumentException("업로드된 파일이 비어 있습니다.");
        }

        BackupDto.Snapshot snapshot;
        try {
            snapshot = objectMapper.readValue(file.getInputStream(), BackupDto.Snapshot.class);
        } catch (Exception e) {
            log.error("Import JSON 파싱 실패", e);
            throw new IllegalArgumentException("유효하지 않은 백업 파일입니다: JSON 파싱에 실패했습니다.");
        }

        BackupDto.ImportResult result = dataBackupService.importAll(snapshot);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Import 완료. " + result.toSummaryMessage()
        ));
    }

    // ---- Google Drive 백업 ----

    /**
     * Google Drive 연동 상태/설정 조회
     */
    @GetMapping("/gdrive/status")
    public ResponseEntity<?> gdriveStatus() {
        var config = googleDriveService.getConfig();
        config.put("success", true);
        return ResponseEntity.ok(config);
    }

    /**
     * Google Drive OAuth2 클라이언트 설정 저장
     */
    @PutMapping("/gdrive/config")
    public ResponseEntity<?> gdriveConfigSave(@RequestBody Map<String, String> body) {
        try {
            googleDriveService.saveClientConfig(body.get("clientId"), body.get("clientSecret"), body.get("folderId"));
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Google OAuth2 인증 URL 생성
     */
    @GetMapping("/gdrive/auth-url")
    public ResponseEntity<?> gdriveAuthUrl(@RequestParam String redirectUri) {
        try {
            String url = googleDriveService.getAuthUrl(redirectUri);
            return ResponseEntity.ok(Map.of("success", true, "authUrl", url));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Google OAuth2 콜백 — 인증 코드로 토큰 교환
     */
    @PostMapping("/gdrive/auth-callback")
    public ResponseEntity<?> gdriveAuthCallback(@RequestBody Map<String, String> body) {
        try {
            googleDriveService.exchangeCodeForToken(body.get("code"), body.get("redirectUri"));
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Google Drive OAuth 콜백 실패", e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Google Drive 설정 삭제
     */
    @DeleteMapping("/gdrive/config")
    public ResponseEntity<?> gdriveConfigDelete() {
        googleDriveService.deleteConfig();
        return ResponseEntity.ok(Map.of("success", true));
    }

    /**
     * Google Drive로 백업
     */
    @PostMapping("/gdrive/backup")
    public ResponseEntity<?> gdriveBackup() {
        try {
            BackupDto.Snapshot snapshot = dataBackupService.exportAll();
            byte[] jsonBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(snapshot);
            var result = googleDriveService.upload(jsonBytes);
            return ResponseEntity.ok(Map.of("success", true, "data", result));
        } catch (Exception e) {
            log.error("Google Drive 백업 실패", e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Google Drive 백업 파일 목록 조회
     */
    @GetMapping("/gdrive/list")
    public ResponseEntity<?> gdriveList() {
        try {
            var files = googleDriveService.listBackups();
            return ResponseEntity.ok(Map.of("success", true, "data", files));
        } catch (Exception e) {
            log.error("Google Drive 목록 조회 실패", e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Google Drive에서 복원
     */
    @PostMapping("/gdrive/restore/{fileId}")
    public ResponseEntity<?> gdriveRestore(@PathVariable String fileId) {
        try {
            byte[] jsonBytes = googleDriveService.download(fileId);
            BackupDto.Snapshot snapshot = objectMapper.readValue(jsonBytes, BackupDto.Snapshot.class);
            BackupDto.ImportResult result = dataBackupService.importAll(snapshot);
            return ResponseEntity.ok(Map.of("success", true, "message", "복원 완료. " + result.toSummaryMessage()));
        } catch (Exception e) {
            log.error("Google Drive 복원 실패", e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    /**
     * Google Drive 백업 파일 삭제
     */
    @DeleteMapping("/gdrive/{fileId}")
    public ResponseEntity<?> gdriveDelete(@PathVariable String fileId) {
        try {
            googleDriveService.delete(fileId);
            return ResponseEntity.ok(Map.of("success", true));
        } catch (Exception e) {
            log.error("Google Drive 삭제 실패", e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }
}
