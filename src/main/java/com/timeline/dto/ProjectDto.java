package com.timeline.dto;

import com.timeline.domain.entity.Project;
import com.timeline.domain.enums.ProjectStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

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
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private ProjectStatus status;
        private String jiraBoardId;
        private String jiraEpicKey;
        private BigDecimal totalManDaysOverride;
        private Long pplId;
        private Long eplId;
        private String quarter;
        private Boolean ktlo;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private String name;
        private String description;
        private LocalDate startDate;
        private LocalDate endDate;
        private LocalDate expectedEndDate;    // 계산값: 프로젝트 내 모든 태스크의 최대 endDate
        private Boolean isDelayed;            // 계산값: expectedEndDate > endDate
        private ProjectStatus status;
        private BigDecimal totalManDays;
        private BigDecimal totalManDaysOverride;
        private BigDecimal estimatedDays;         // 계산값: totalManDays / BE캐파합계
        private Integer beCount;
        private List<Map<String, Object>> beMembers;
        private List<Map<String, Object>> allMembers;
        private Integer memberCount;
        private Integer sortOrder;
        private String jiraBoardId;
        private String jiraEpicKey;
        private Long pplId;
        private String pplName;
        private Long eplId;
        private String eplName;
        private String quarter;
        private Boolean ktlo;
        private List<MemberDto.Response> members;
        private List<SquadDto.Response> squads;
        private Integer noteCount;

        public static Response from(Project project) {
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())

                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
                    .jiraEpicKey(project.getJiraEpicKey())
                    .totalManDaysOverride(project.getTotalManDaysOverride())
                    .pplId(project.getPpl() != null ? project.getPpl().getId() : null)
                    .pplName(project.getPpl() != null ? project.getPpl().getName() : null)
                    .eplId(project.getEpl() != null ? project.getEpl().getId() : null)
                    .eplName(project.getEpl() != null ? project.getEpl().getName() : null)
                    .quarter(project.getQuarter())
                    .ktlo(Boolean.TRUE.equals(project.getKtlo()))
                    .sortOrder(project.getSortOrder())
                    .build();
        }

        public static Response from(Project project,
                                     List<MemberDto.Response> members,
                                     List<SquadDto.Response> squads) {
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())

                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
                    .jiraEpicKey(project.getJiraEpicKey())
                    .totalManDaysOverride(project.getTotalManDaysOverride())
                    .pplId(project.getPpl() != null ? project.getPpl().getId() : null)
                    .pplName(project.getPpl() != null ? project.getPpl().getName() : null)
                    .eplId(project.getEpl() != null ? project.getEpl().getId() : null)
                    .eplName(project.getEpl() != null ? project.getEpl().getName() : null)
                    .quarter(project.getQuarter())
                    .ktlo(Boolean.TRUE.equals(project.getKtlo()))
                    .sortOrder(project.getSortOrder())
                    .members(members)
                    .squads(squads)
                    .build();
        }

        /**
         * 목록 조회용: memberCount + expectedEndDate (members/squads 없음)
         */
        public static Response from(Project project, long memberCount, LocalDate expectedEndDate,
                                     BigDecimal totalManDays, long beCount, BigDecimal estimatedDays,
                                     List<Map<String, Object>> beMembers, List<SquadDto.Response> squads,
                                     List<Map<String, Object>> allMembers) {
            Boolean delayed = null;
            if (expectedEndDate != null && project.getEndDate() != null) {
                delayed = expectedEndDate.isAfter(project.getEndDate());
            }
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())

                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .expectedEndDate(expectedEndDate)
                    .isDelayed(delayed)
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
                    .jiraEpicKey(project.getJiraEpicKey())
                    .totalManDaysOverride(project.getTotalManDaysOverride())
                    .pplId(project.getPpl() != null ? project.getPpl().getId() : null)
                    .pplName(project.getPpl() != null ? project.getPpl().getName() : null)
                    .eplId(project.getEpl() != null ? project.getEpl().getId() : null)
                    .eplName(project.getEpl() != null ? project.getEpl().getName() : null)
                    .quarter(project.getQuarter())
                    .ktlo(Boolean.TRUE.equals(project.getKtlo()))
                    .sortOrder(project.getSortOrder())
                    .memberCount((int) memberCount)
                    .beCount((int) beCount)
                    .beMembers(beMembers)
                    .totalManDays(totalManDays)
                    .estimatedDays(estimatedDays)
                    .squads(squads)
                    .allMembers(allMembers)
                    .build();
        }

        public static Response from(Project project,
                                     List<MemberDto.Response> members,
                                     List<SquadDto.Response> squads,
                                     LocalDate expectedEndDate) {
            Boolean delayed = null;
            if (expectedEndDate != null && project.getEndDate() != null) {
                delayed = expectedEndDate.isAfter(project.getEndDate());
            }
            return Response.builder()
                    .id(project.getId())
                    .name(project.getName())

                    .description(project.getDescription())
                    .startDate(project.getStartDate())
                    .endDate(project.getEndDate())
                    .expectedEndDate(expectedEndDate)
                    .isDelayed(delayed)
                    .status(project.getStatus())
                    .jiraBoardId(project.getJiraBoardId())
                    .jiraEpicKey(project.getJiraEpicKey())
                    .totalManDaysOverride(project.getTotalManDaysOverride())
                    .pplId(project.getPpl() != null ? project.getPpl().getId() : null)
                    .pplName(project.getPpl() != null ? project.getPpl().getName() : null)
                    .eplId(project.getEpl() != null ? project.getEpl().getId() : null)
                    .eplName(project.getEpl() != null ? project.getEpl().getName() : null)
                    .quarter(project.getQuarter())
                    .ktlo(Boolean.TRUE.equals(project.getKtlo()))
                    .sortOrder(project.getSortOrder())
                    .members(members)
                    .squads(squads)
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
     * 프로젝트에 스쿼드 추가 요청
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AddSquadRequest {
        private Long squadId;
    }
}
