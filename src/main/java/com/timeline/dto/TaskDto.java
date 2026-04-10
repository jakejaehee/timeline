package com.timeline.dto;

import com.timeline.domain.entity.Task;
import com.timeline.domain.entity.TaskLink;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 태스크 요청/응답 DTO
 */
public class TaskDto {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Request {
        private String name;
        private Long domainSystemId;
        private Long assigneeId;
        private LocalDate startDate;
        private LocalDate endDate;
        private BigDecimal manDays;
        private TaskStatus status;
        private Integer sortOrder;
        private String description;
        private TaskExecutionMode executionMode;   // null 시 SEQUENTIAL 기본값 적용
        private List<TaskLinkRequest> links;       // null 또는 빈 배열 허용
    }

    /**
     * 태스크 링크 요청 DTO
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskLinkRequest {
        private String url;
        private String label;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private String name;
        private DomainSystemDto.Response domainSystem;
        private MemberDto.Response assignee;
        private LocalDate startDate;
        private LocalDate endDate;
        private BigDecimal manDays;
        private TaskStatus status;
        private Integer sortOrder;
        private String description;
        private List<Long> dependencies;
        private TaskExecutionMode executionMode;
        private List<TaskLinkResponse> links;

        public static Response from(Task task, List<Long> dependencies) {
            return from(task, dependencies, null);
        }

        public static Response from(Task task, List<Long> dependencies, List<TaskLink> taskLinks) {
            List<TaskLinkResponse> linkResponses = null;
            if (taskLinks != null) {
                linkResponses = taskLinks.stream()
                        .map(TaskLinkResponse::from)
                        .collect(Collectors.toList());
            }
            return Response.builder()
                    .id(task.getId())
                    .name(task.getName())
                    .domainSystem(task.getDomainSystem() != null
                            ? DomainSystemDto.Response.from(task.getDomainSystem()) : null)
                    .assignee(task.getAssignee() != null
                            ? MemberDto.Response.from(task.getAssignee()) : null)
                    .startDate(task.getStartDate())
                    .endDate(task.getEndDate())
                    .manDays(task.getManDays())
                    .status(task.getStatus())
                    .sortOrder(task.getSortOrder())
                    .description(task.getDescription())
                    .dependencies(dependencies)
                    .executionMode(task.getExecutionMode())
                    .links(linkResponses)
                    .build();
        }
    }

    /**
     * 태스크 링크 응답 DTO
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskLinkResponse {
        private Long id;
        private String url;
        private String label;
        private LocalDateTime createdAt;

        public static TaskLinkResponse from(TaskLink taskLink) {
            return TaskLinkResponse.builder()
                    .id(taskLink.getId())
                    .url(taskLink.getUrl())
                    .label(taskLink.getLabel())
                    .createdAt(taskLink.getCreatedAt())
                    .build();
        }
    }

    /**
     * 의존관계 추가 요청
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AddDependencyRequest {
        private Long dependsOnTaskId;
    }
}
