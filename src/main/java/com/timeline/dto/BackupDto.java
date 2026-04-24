package com.timeline.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 전체 DB 데이터 Export/Import용 DTO
 * schema.sql의 모든 테이블/컬럼과 1:1 대응 필수
 */
public class BackupDto {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Snapshot {
        private String schemaVersion;
        private LocalDateTime exportedAt;
        private List<MemberRow> members;
        private List<SquadRow> squads;
        private List<SquadMemberRow> squadMembers;
        private List<ProjectRow> projects;
        private List<ProjectMilestoneRow> projectMilestones;
        private List<ProjectMemberRow> projectMembers;
        private List<ProjectSquadRow> projectSquads;
        private List<ProjectLinkRow> projectLinks;
        private List<ProjectNoteRow> projectNotes;
        private List<HolidayRow> holidays;
        private List<TaskRow> tasks;
        private List<TaskLinkRow> taskLinks;
        private List<TaskDependencyRow> taskDependencies;
        private List<MemberLeaveRow> memberLeaves;
        private List<JiraConfigRow> jiraConfigs;
        private List<GoogleDriveConfigRow> googleDriveConfigs;
        private List<SidebarLinkRow> sidebarLinks;
        private List<SidebarMemoRow> sidebarMemos;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class MemberRow {
        private Long id;
        private String name;
        private String role;
        private String team;
        private String email;
        private BigDecimal capacity;
        private Boolean active;
        private LocalDate queueStartDate;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SquadRow {
        private Long id;
        private String name;
        private String description;
        private String color;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SquadMemberRow {
        private Long id;
        private Long squadId;
        private Long memberId;
        private LocalDateTime createdAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ProjectRow {
        private Long id;
        private String name;
        private String description;
        private String jiraBoardId;
        private String jiraEpicKey;
        private BigDecimal totalManDaysOverride;
        private String quarter;
        private String status;
        private Boolean ktlo;
        private Integer sortOrder;
        private Long pplId;
        private Long eplId;
        private LocalDate startDate;
        private LocalDate endDate;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ProjectMilestoneRow {
        private Long id;
        private Long projectId;
        private String name;
        private String type;
        private LocalDate startDate;
        private LocalDate endDate;
        private Integer days;
        private String qaAssignees;
        private Integer sortOrder;
        private LocalDateTime createdAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ProjectMemberRow {
        private Long id;
        private Long projectId;
        private Long memberId;
        private LocalDateTime createdAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ProjectSquadRow {
        private Long id;
        private Long projectId;
        private Long squadId;
        private LocalDateTime createdAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ProjectLinkRow {
        private Long id;
        private Long projectId;
        private String url;
        private String label;
        private LocalDateTime createdAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ProjectNoteRow {
        private Long id;
        private Long projectId;
        private String content;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class HolidayRow {
        private Long id;
        private LocalDate date;
        private String name;
        private String type;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TaskRow {
        private Long id;
        private Long projectId;
        private Long squadId;
        private Long assigneeId;
        private String name;
        private String description;
        private String status;
        private String priority;
        private String type;
        private String executionMode;
        private BigDecimal manDays;
        private LocalDate startDate;
        private LocalDate endDate;
        private LocalDate actualEndDate;
        private String jiraKey;
        private Integer sortOrder;
        private Integer assigneeOrder;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TaskLinkRow {
        private Long id;
        private Long taskId;
        private String url;
        private String label;
        private LocalDateTime createdAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TaskDependencyRow {
        private Long id;
        private Long taskId;
        private Long dependsOnTaskId;
        private LocalDateTime createdAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class MemberLeaveRow {
        private Long id;
        private Long memberId;
        private LocalDate date;
        private String reason;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class JiraConfigRow {
        private Long id;
        private String baseUrl;
        private String email;
        private String apiToken;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class GoogleDriveConfigRow {
        private Long id;
        private String clientId;
        private String clientSecret;
        private String refreshToken;
        private String folderId;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SidebarLinkRow {
        private Long id;
        private String label;
        private String url;
        private String icon;
        private Integer sortOrder;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class SidebarMemoRow {
        private Long id;
        private String content;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ImportResult {
        private int totalTables;
        private int totalRows;

        public String toSummaryMessage() {
            return String.format("%d개 테이블, %d건 복원 완료", totalTables, totalRows);
        }
    }
}
