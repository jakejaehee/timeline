package com.timeline.dto;

import com.timeline.domain.enums.MemberRole;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskPriority;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.enums.TaskType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 간트차트 데이터 응답 DTO
 * - 프로젝트 내 태스크를 스쿼드별로 그룹핑하여 반환
 */
public class GanttDataDto {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private ProjectSummary project;
        private List<MilestoneItem> milestones;
        private List<SquadGroup> squads;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MilestoneItem {
        private Long id;
        private String name;
        private LocalDate startDate;
        private LocalDate endDate;
        private Integer sortOrder;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectSummary {
        private Long id;
        private String name;
        private LocalDate startDate;
        private LocalDate endDate;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SquadGroup {
        private Long id;
        private String name;
        private String color;
        private List<TaskItem> tasks;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskItem {
        private Long id;
        private String name;
        private AssigneeSummary assignee;
        private LocalDate startDate;
        private LocalDate endDate;
        private BigDecimal manDays;
        private TaskStatus status;
        private Integer sortOrder;
        private List<Long> dependencies;
        private TaskExecutionMode executionMode;
        private TaskPriority priority;
        private TaskType type;
        private LocalDate actualEndDate;
        private Integer assigneeOrder;
        private String jiraKey;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AssigneeSummary {
        private Long id;
        private String name;
        private MemberRole role;
        private LocalDate queueStartDate;
    }
}
