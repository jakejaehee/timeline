package com.timeline.service;

import com.timeline.domain.entity.JiraConfig;
import com.timeline.domain.repository.JiraConfigRepository;
import com.timeline.dto.JiraDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.Optional;

/**
 * Jira 설정 CRUD 서비스
 * 단일 레코드(첫 번째 레코드)로 전역 Jira 설정을 관리한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class JiraConfigService {

    private final JiraConfigRepository jiraConfigRepository;

    /**
     * 현재 Jira 설정 조회 (apiToken 마스킹)
     */
    public JiraDto.ConfigResponse getConfig() {
        Optional<JiraConfig> configOpt = jiraConfigRepository.findFirstByOrderByIdAsc();
        if (configOpt.isEmpty()) {
            return JiraDto.ConfigResponse.builder()
                    .configured(false)
                    .build();
        }
        JiraConfig config = configOpt.get();
        return JiraDto.ConfigResponse.builder()
                .baseUrl(config.getBaseUrl())
                .email(config.getEmail())
                .apiTokenMasked(maskToken(config.getApiToken()))
                .configured(true)
                .build();
    }

    /**
     * 내부용: 원본 설정 엔티티 조회 (Import에서 사용)
     */
    public Optional<JiraConfig> getRawConfig() {
        return jiraConfigRepository.findFirstByOrderByIdAsc();
    }

    /**
     * Jira 설정 저장/갱신
     */
    @Transactional
    public JiraDto.ConfigResponse saveConfig(JiraDto.ConfigRequest request) {
        if (request.getBaseUrl() == null || request.getBaseUrl().isBlank()) {
            throw new IllegalArgumentException("Jira Cloud URL은 필수입니다.");
        }
        if (request.getEmail() == null || request.getEmail().isBlank()) {
            throw new IllegalArgumentException("이메일은 필수입니다.");
        }
        // trailing slash 제거 + SSRF 방지를 위한 URL 검증
        String baseUrl = request.getBaseUrl().trim();
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        validateBaseUrl(baseUrl);

        // DB 컬럼 길이 검증
        if (baseUrl.length() > 500) {
            throw new IllegalArgumentException("Jira Cloud URL은 500자를 초과할 수 없습니다.");
        }
        if (request.getEmail().trim().length() > 200) {
            throw new IllegalArgumentException("이메일은 200자를 초과할 수 없습니다.");
        }

        Optional<JiraConfig> existing = jiraConfigRepository.findFirstByOrderByIdAsc();
        JiraConfig config;
        if (existing.isPresent()) {
            config = existing.get();
            config.setBaseUrl(baseUrl);
            config.setEmail(request.getEmail().trim());
            // apiToken이 비어있으면 기존 토큰 유지 (폼에서 토큰을 변경하지 않은 경우)
            if (request.getApiToken() != null && !request.getApiToken().isBlank()) {
                if (request.getApiToken().trim().length() > 500) {
                    throw new IllegalArgumentException("API Token은 500자를 초과할 수 없습니다.");
                }
                config.setApiToken(request.getApiToken().trim());
            }
        } else {
            // 신규 생성 시 apiToken 필수
            if (request.getApiToken() == null || request.getApiToken().isBlank()) {
                throw new IllegalArgumentException("API Token은 필수입니다.");
            }
            if (request.getApiToken().trim().length() > 500) {
                throw new IllegalArgumentException("API Token은 500자를 초과할 수 없습니다.");
            }
            config = JiraConfig.builder()
                    .baseUrl(baseUrl)
                    .email(request.getEmail().trim())
                    .apiToken(request.getApiToken().trim())
                    .build();
        }
        JiraConfig saved = jiraConfigRepository.save(config);
        log.info("Jira 설정 저장 완료: baseUrl={}, email={}", saved.getBaseUrl(), saved.getEmail());

        return JiraDto.ConfigResponse.builder()
                .baseUrl(saved.getBaseUrl())
                .email(saved.getEmail())
                .apiTokenMasked(maskToken(saved.getApiToken()))
                .configured(true)
                .build();
    }

    /**
     * Jira 설정 삭제 (멱등성 보장)
     */
    @Transactional
    public void deleteConfig() {
        Optional<JiraConfig> existing = jiraConfigRepository.findFirstByOrderByIdAsc();
        existing.ifPresent(config -> {
            jiraConfigRepository.delete(config);
            log.info("Jira 설정 삭제 완료");
        });
    }

    /**
     * API Token 마스킹: 앞 4자 + **** + 뒤 4자
     */
    private String maskToken(String token) {
        if (token == null || token.length() <= 8) {
            return "****";
        }
        return token.substring(0, 4) + "****" + token.substring(token.length() - 4);
    }

    /**
     * Jira Base URL 검증: SSRF 방지
     * - https:// 프로토콜만 허용
     * - *.atlassian.net 도메인만 허용
     * - 내부 IP(127.x, 10.x, 192.168.x, 172.16-31.x, localhost)를 차단
     */
    public void validateBaseUrl(String baseUrl) {
        try {
            URL url = new URL(baseUrl);
            String protocol = url.getProtocol();
            if (!"https".equalsIgnoreCase(protocol)) {
                throw new IllegalArgumentException("Jira Cloud URL은 https:// 프로토콜만 허용됩니다.");
            }
            String host = url.getHost().toLowerCase();
            if (host.isEmpty()) {
                throw new IllegalArgumentException("Jira Cloud URL에 올바른 호스트가 필요합니다.");
            }
            // Atlassian Cloud 도메인 검증
            if (!host.endsWith(".atlassian.net")) {
                throw new IllegalArgumentException("Jira Cloud URL은 *.atlassian.net 도메인만 허용됩니다.");
            }
        } catch (MalformedURLException e) {
            throw new IllegalArgumentException("올바른 Jira Cloud URL 형식이 아닙니다.");
        }
    }
}
