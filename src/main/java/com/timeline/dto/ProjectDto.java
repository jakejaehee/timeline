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
