package com.timeline.dto;

import com.timeline.domain.entity.Project;
import com.timeline.domain.enums.ProjectStatus;
import com.timeline.domain.enums.ProjectType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

/**
 * 프로젝트 요청/응답 DTO
 */
public class ProjectDto {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Request {
        private String name;
        private ProjectType type;
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private LocalDate deadline;
        private ProjectStatus status;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private String name;
        private ProjectType type;
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private LocalDate deadline;
        private LocalDate expectedEndDate;    // 계산값: 프로젝트 내 모든 태스크의 최대 endDate
        private Boolean isDelayed;            // 계산값: expectedEndDate > deadline
        private ProjectStatus status;
        private List<MemberDto.Response> members;
        private List<DomainSystemDto.Response> domainSystems;

        public static Response from(Project project) {
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())
                    .type(project.getType())
                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .deadline(project.getDeadline())
                    .status(project.getStatus())
                    .build();
        }

        public static Response from(Project project,
                                     List<MemberDto.Response> members,
                                     List<DomainSystemDto.Response> domainSystems) {
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())
                    .type(project.getType())
                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .deadline(project.getDeadline())
                    .status(project.getStatus())
                    .members(members)
                    .domainSystems(domainSystems)
                    .build();
        }

        public static Response from(Project project,
                                     List<MemberDto.Response> members,
                                     List<DomainSystemDto.Response> domainSystems,
                                     LocalDate expectedEndDate) {
            Boolean delayed = null;
            if (expectedEndDate != null && project.getDeadline() != null) {
                delayed = expectedEndDate.isAfter(project.getDeadline());
            }
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())
                    .type(project.getType())
                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .deadline(project.getDeadline())
                    .expectedEndDate(expectedEndDate)
                    .isDelayed(delayed)
                    .status(project.getStatus())
                    .members(members)
                    .domainSystems(domainSystems)
                    .build();
        }
    }

    /**
     * 프로젝트에 멤버 추가 요청
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AddMemberRequest {
        private Long memberId;
    }

    /**
     * 프로젝트에 도메인 시스템 추가 요청
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AddDomainSystemRequest {
        private Long domainSystemId;
    }
}
