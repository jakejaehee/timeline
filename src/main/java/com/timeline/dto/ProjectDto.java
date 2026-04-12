package com.timeline.dto;

import com.timeline.domain.entity.Project;
import com.timeline.domain.enums.ProjectStatus;
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
        private String projectType;
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private ProjectStatus status;
        private String jiraBoardId;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private String name;
        private String projectType;
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private LocalDate expectedEndDate;    // 계산값: 프로젝트 내 모든 태스크의 최대 endDate
        private Boolean isDelayed;            // 계산값: expectedEndDate > endDate
        private ProjectStatus status;
        private Integer memberCount;
        private String jiraBoardId;
        private List<MemberDto.Response> members;
        private List<DomainSystemDto.Response> domainSystems;

        public static Response from(Project project) {
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())
                    .projectType(project.getProjectType())
                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
                    .build();
        }

        public static Response from(Project project,
                                     List<MemberDto.Response> members,
                                     List<DomainSystemDto.Response> domainSystems) {
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())
                    .projectType(project.getProjectType())
                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
                    .members(members)
                    .domainSystems(domainSystems)
                    .build();
        }

        /**
         * 목록 조회용: memberCount + expectedEndDate (members/domainSystems 없음)
         */
        public static Response from(Project project, long memberCount, LocalDate expectedEndDate) {
            Boolean delayed = null;
            if (expectedEndDate != null && project.getEndDate() != null) {
                delayed = expectedEndDate.isAfter(project.getEndDate());
            }
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())
                    .projectType(project.getProjectType())
                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .expectedEndDate(expectedEndDate)
                    .isDelayed(delayed)
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
                    .memberCount((int) memberCount)
                    .build();
        }

        public static Response from(Project project,
                                     List<MemberDto.Response> members,
                                     List<DomainSystemDto.Response> domainSystems,
                                     LocalDate expectedEndDate) {
            Boolean delayed = null;
            if (expectedEndDate != null && project.getEndDate() != null) {
                delayed = expectedEndDate.isAfter(project.getEndDate());
            }
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())
                    .projectType(project.getProjectType())
                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .expectedEndDate(expectedEndDate)
                    .isDelayed(delayed)
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
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
