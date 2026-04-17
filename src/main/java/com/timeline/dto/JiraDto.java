package com.timeline.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Jira 연동 관련 DTO
 */
public class JiraDto {

    // ---- Jira Config DTO ----

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ConfigRequest {
        private String baseUrl;
        private String email;
        private String apiToken;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ConfigResponse {
        private String baseUrl;
        private String email;
        private String apiTokenMasked;
        private boolean configured;
    }

    // ---- Jira API 응답 파싱용 내부 모델 ----

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class JiraIssue {
        private String key;
        private String summary;
        private String issueType;             // "Epic", "Story", "Task", "Bug" 등
        private String status;
        private String statusCategoryKey;     // "new" | "indeterminate" | "done"
        private String assigneeDisplayName;
        private String assigneeEmail;         // assignee.emailAddress
        private BigDecimal storyPoints;
        private LocalDate startDate;
        private LocalDate dueDate;
        private String description;
        private LocalDate resolutionDate;   // resolutiondate 파싱 결과
        private List<JiraIssueLink> issueLinks; // issuelinks 파싱 결과
    }

    /**
     * Jira issuelinks 파싱 결과 (FR-007)
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class JiraIssueLink {
        private String type;        // "blocks", "is blocked by", "relates to" 등
        private String linkedKey;   // 연결된 이슈 key (예: "PROJ-45")
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class JiraUserInfo {
        private String displayName;
        private String emailAddress;
    }

    // ---- Import 결과 DTO ----

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportResult {
        private int created;
        private int updated;
        private int skipped;
        private int issueLinksCreated;
        private List<ImportError> errors;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportError {
        private String jiraKey;
        private String reason;
    }

    // ---- Preview DTO ----

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PreviewResult {
        private int totalIssues;
        private int toCreate;
        private int toUpdate;
        private int toSkip;
        private List<PreviewItem> issues;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PreviewItem {
        private String jiraKey;
        private String summary;
        private String jiraStatus;
        private String mappedStatus;
        private String jiraAssignee;
        private Long mappedAssigneeId;
        private String mappedAssigneeName;
        private String action; // CREATE, UPDATE, SKIP
        private Long existingProjectId; // UPDATE 시 기존 태스크의 프로젝트 ID
    }

    // ---- Request DTO ----

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PreviewRequest {
        private LocalDate createdAfter;   // 생성일자 필터 (nullable)
        private List<String> statusFilter; // Jira 상태 필터 (nullable 또는 빈 리스트 = 전체)
        private String jiraBoardId;       // Jira Board ID 오버라이드 (nullable, 없으면 프로젝트 설정값 사용)
        private String jiraProjectKey;    // Jira 프로젝트 키 (space 검색용, nullable)
        private String jiraEpicKey;       // Jira Epic 키 (epic 검색용, nullable)
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportRequest {
        private LocalDate createdAfter;                     // 생성일자 필터 (nullable)
        private List<String> statusFilter; // Jira 상태 필터 (nullable 또는 빈 리스트 = 전체)
        private List<String> selectedKeys; // 선택된 Jira 이슈 키 목록 (null이면 전체)
        private Map<String, Long> issueProjectMap; // Jira 키 -> 프로젝트 ID 매핑 (null이면 URL의 projectId 사용)
        private String jiraBoardId;       // Jira Board ID 오버라이드 (nullable, 없으면 프로젝트 설정값 사용)
        private String jiraProjectKey;    // Jira 프로젝트 키 (space 검색용, nullable)
        private String jiraEpicKey;       // Jira Epic 키 (epic 검색용, nullable)
        private Long defaultProjectId;    // 기본 프로젝트 ID (space import 시)
    }
}
