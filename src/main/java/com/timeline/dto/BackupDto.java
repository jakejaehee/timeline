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
        private List<ProjectRow> projects;
        private List<HolidayRow> holidays;
        private List<SquadMemberRow> squadMembers;
        private List<ProjectMemberRow> projectMembers;
        private List<ProjectSquadRow> projectSquads;
        private List<TaskRow> tasks;
        private List<MemberLeaveRow> memberLeaves;
        private List<TaskLinkRow> taskLinks;
        private List<TaskDependencyRow> taskDependencies;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MemberRow {
        private Long id;
        private String name;
        private String role;
        private String email;
        private BigDecimal capacity;
        private Boolean active;
        private LocalDate queueStartDate;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SquadRow {
        private Long id;
        private String name;
        private String description;
        private String color;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectRow {
        private Long id;
        private String name;
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private String status;
        private String jiraBoardId;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class HolidayRow {
        private Long id;
        private LocalDate date;
        private String name;
        private String type;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SquadMemberRow {
        private Long id;
        private Long squadId;
        private Long memberId;
        private LocalDateTime createdAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectMemberRow {
        private Long id;
        private Long projectId;
        private Long memberId;
        private LocalDateTime createdAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectSquadRow {
        private Long id;
        private Long projectId;
        private Long squadId;
        private LocalDateTime createdAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskRow {
        private Long id;
        private Long projectId;
        private Long squadId;
        private Long assigneeId;
        private String name;
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private BigDecimal manDays;
        private String status;
        private String executionMode;
        private String priority;
        private String type;
        private LocalDate actualEndDate;
        private Integer assigneeOrder;
        private Integer sortOrder;
        private String jiraKey;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MemberLeaveRow {
        private Long id;
        private Long memberId;
        private LocalDate date;
        private String reason;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskLinkRow {
        private Long id;
        private Long taskId;
        private String url;
        private String label;
        private LocalDateTime createdAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskDependencyRow {
        private Long id;
        private Long taskId;
        private Long dependsOnTaskId;
        private LocalDateTime createdAt;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ImportResult {
        private int members;
        private int squads;
        private int squadMembers;
        private int projects;
        private int holidays;
        private int projectMembers;
        private int projectSquads;
        private int tasks;
        private int memberLeaves;
        private int taskLinks;
        private int taskDependencies;

        public String toSummaryMessage() {
            return String.format(
                    "members: %d, squads: %d, squadMembers: %d, projects: %d, holidays: %d, " +
                    "projectMembers: %d, projectSquads: %d, tasks: %d, " +
                    "memberLeaves: %d, taskLinks: %d, taskDependencies: %d",
                    members, squads, squadMembers, projects, holidays,
                    projectMembers, projectSquads, tasks,
                    memberLeaves, taskLinks, taskDependencies
            );
        }
    }
}
