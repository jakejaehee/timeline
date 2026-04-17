package com.timeline.controller;

import com.timeline.dto.JiraDto;
import com.timeline.service.JiraImportService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Jira Import/Preview REST API 컨트롤러
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class JiraImportController {

    private final JiraImportService jiraImportService;

    /**
     * Jira Board 이슈 Import 미리보기 (DB 저장 없음)
     * POST: 필터 조건(createdAfter)이 요청 body에 포함
     */
    @PostMapping("/api/v1/projects/{projectId}/jira/preview")
    public ResponseEntity<?> previewImport(@PathVariable Long projectId,
                                            @RequestBody(required = false) JiraDto.PreviewRequest request) {
        try {
            JiraDto.PreviewResult result = jiraImportService.preview(projectId, request);
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "data", result
            ));
        } catch (IllegalStateException | IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        } catch (RuntimeException e) {
            log.error("Jira preview 실패: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", sanitizeErrorMessage(e)
            ));
        }
    }

    /**
     * Jira Board 이슈 Import 실행
     */
    @PostMapping("/api/v1/projects/{projectId}/jira/import")
    public ResponseEntity<?> importIssues(@PathVariable Long projectId,
                                           @RequestBody(required = false) JiraDto.ImportRequest request) {
        try {
            JiraDto.ImportResult result = jiraImportService.importIssues(projectId, request);
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "data", result
            ));
        } catch (IllegalStateException | IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage()
            ));
        } catch (RuntimeException e) {
            log.error("Jira import 실패: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", sanitizeErrorMessage(e)
            ));
        }
    }

    /**
     * Jira Space(프로젝트 키) 기반 미리보기
     */
    @PostMapping("/api/v1/jira/space/preview")
    public ResponseEntity<?> previewBySpace(@RequestBody JiraDto.PreviewRequest request) {
        try {
            JiraDto.PreviewResult result = jiraImportService.previewBySpace(request);
            return ResponseEntity.ok(Map.of("success", true, "data", result));
        } catch (IllegalStateException | IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        } catch (RuntimeException e) {
            log.error("Jira space preview 실패: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", sanitizeErrorMessage(e)));
        }
    }

    /**
     * Jira Space(프로젝트 키) 기반 가져오기
     */
    @PostMapping("/api/v1/jira/space/import")
    public ResponseEntity<?> importBySpace(@RequestBody JiraDto.ImportRequest request) {
        try {
            JiraDto.ImportResult result = jiraImportService.importBySpace(request);
            return ResponseEntity.ok(Map.of("success", true, "data", result));
        } catch (IllegalStateException | IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        } catch (RuntimeException e) {
            log.error("Jira space import 실패: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", sanitizeErrorMessage(e)));
        }
    }

    /**
     * RuntimeException 메시지 sanitize: Jira API 클라이언트에서 생성한 사용자 친화적 메시지만 전달,
     * 그 외 예상 외 예외(NullPointer, DB 오류 등)는 일반 메시지로 대체
     */
    private String sanitizeErrorMessage(RuntimeException e) {
        String msg = e.getMessage();
        if (msg != null && !msg.isBlank()) {
            // 사용자 친화적 메시지 패턴 (Jira/Board/프로젝트/멤버 관련)
            if (msg.startsWith("Jira ") || msg.startsWith("Board") || msg.startsWith("프로젝트")
                    || msg.startsWith("멤버") || e instanceof IllegalStateException || e instanceof IllegalArgumentException) {
                return msg;
            }
        }
        return "Jira 연동 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
    }
}
