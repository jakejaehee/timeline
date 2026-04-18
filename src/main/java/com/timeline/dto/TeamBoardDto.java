package com.timeline.dto;

import com.timeline.domain.entity.Task;
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
 * Team Board 요청/응답 DTO
 */
public class TeamBoardDto {

    /**
     * Team Board 응답 (멤버별 그룹핑)
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private List<MemberGroup> members;
        private List<TaskItem> unassigned;
    }

    /**
     * 멤버별 태스크 그룹
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MemberGroup {
        private Long id;
        private String name;
        private MemberRole role;
        private List<TaskItem> tasks;
    }

    /**
     * Team Board 태스크 항목
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskItem {
        private Long id;
        private String name;
        private Long projectId;
        private String projectName;
        private String squadName;
        private String squadColor;
        private LocalDate startDate;
        private LocalDate endDate;
        private TaskStatus status;
        private BigDecimal manDays;
        private TaskExecutionMode executionMode;
        private TaskPriority priority;
        private TaskType type;
        private Integer assigneeOrder;

        public static TaskItem from(Task task) {
            return TaskItem.builder()
                    .id(task.getId())
                    .name(task.getName())
                    .projectId(task.getProject().getId())
                    .projectName(task.getProject().getName())
                    .squadName(task.getSquad().getName())
                    .squadColor(task.getSquad().getColor())
                    .startDate(task.getStartDate())
                    .endDate(task.getEndDate())
                    .status(task.getStatus())
                    .manDays(task.getManDays())
                    .executionMode(task.getExecutionMode())
                    .priority(task.getPriority())
                    .type(task.getType())
                    .assigneeOrder(task.getAssigneeOrder())
                    .build();
        }
    }
}
