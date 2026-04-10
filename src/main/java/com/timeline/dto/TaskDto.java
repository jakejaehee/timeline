package com.timeline.dto;

import com.timeline.domain.entity.Task;
import com.timeline.domain.enums.TaskStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

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

        public static Response from(Task task, List<Long> dependencies) {
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
