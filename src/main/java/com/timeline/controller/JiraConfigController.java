package com.timeline.controller;

import com.timeline.dto.JiraDto;
import com.timeline.service.JiraApiClient;
import com.timeline.service.JiraConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Jira 설정 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/jira")
@RequiredArgsConstructor
public class JiraConfigController {

    private final JiraConfigService jiraConfigService;
    private final JiraApiClient jiraApiClient;

    /**
     * 현재 Jira 설정 조회 (apiToken 마스킹)
     */
    @GetMapping("/config")
    public ResponseEntity<?> getConfig() {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", jiraConfigService.getConfig()
        ));
    }

    /**
     * Jira 설정 저장/갱신
     */
    @PutMapping("/config")
    public ResponseEntity<?> saveConfig(@RequestBody JiraDto.ConfigRequest request) {
        JiraDto.ConfigResponse saved = jiraConfigService.saveConfig(request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", saved
        ));
    }

    /**
     * Jira 설정 삭제
     */
    @DeleteMapping("/config")
    public ResponseEntity<?> deleteConfig() {
        jiraConfigService.deleteConfig();
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * Jira 연결 테스트 (저장 전 유효성 검증)
     * apiToken이 비어있으면 기존 저장된 토큰을 사용 (토큰 변경 없이 URL/이메일만 변경 시)
     */
    @PostMapping("/config/test")
    public ResponseEntity<?> testConnection(@RequestBody JiraDto.ConfigRequest request) {
        try {
            if (request.getBaseUrl() == null || request.getBaseUrl().isBlank()) {
                return ResponseEntity.ok(Map.of("success", false, "message", "Jira Cloud URL은 필수입니다."));
            }
            if (request.getEmail() == null || request.getEmail().isBlank()) {
                return ResponseEntity.ok(Map.of("success", false, "message", "이메일은 필수입니다."));
            }

            // SSRF 방지: URL 검증
            String baseUrl = request.getBaseUrl().trim();
            if (baseUrl.endsWith("/")) {
                baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
            }
            jiraConfigService.validateBaseUrl(baseUrl);

            String apiToken = request.getApiToken();
            if (apiToken == null || apiToken.isBlank()) {
                // 기존 저장된 토큰 사용
                var existing = jiraConfigService.getRawConfig();
                if (existing.isEmpty() || existing.get().getApiToken() == null) {
                    return ResponseEntity.ok(Map.of("success", false, "message", "API Token이 필요합니다. 토큰을 입력하거나 먼저 설정을 저장해주세요."));
                }
                apiToken = existing.get().getApiToken();
            }

            JiraDto.JiraUserInfo userInfo = jiraApiClient.testConnection(
                    baseUrl, request.getEmail().trim(), apiToken.trim());
            String displayName = userInfo.getDisplayName() != null ? userInfo.getDisplayName() : "(이름 없음)";
            String emailAddr = userInfo.getEmailAddress() != null ? userInfo.getEmailAddress() : "(이메일 없음)";
            String message = "연결 성공: " + displayName + " (" + emailAddr + ")";
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "data", Map.of("message", message)
            ));
        } catch (RuntimeException e) {
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "message", e.getMessage() != null ? e.getMessage() : "Jira 연결 테스트에 실패했습니다."
            ));
        } catch (Exception e) {
            log.warn("Jira 연결 테스트 중 예상치 못한 오류", e);
            return ResponseEntity.ok(Map.of(
                    "success", false,
                    "message", "Jira 연결 테스트 중 오류가 발생했습니다."
            ));
        }
    }
}
