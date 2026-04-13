package com.timeline.dto;

import com.timeline.domain.entity.Member;
import com.timeline.domain.enums.MemberRole;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * 멤버 요청/응답 DTO
 */
public class MemberDto {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Request {
        private String name;
        private MemberRole role;
        private String team;
        private String email;
        private BigDecimal capacity;
        private LocalDate queueStartDate;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private String name;
        private MemberRole role;
        private String team;
        private String email;
        private BigDecimal capacity;
        private Boolean active;
        private LocalDate queueStartDate;

        public static Response from(Member member) {
            return Response.builder()
                    .id(member.getId())
                    .name(member.getName())
                    .role(member.getRole())
                    .team(member.getTeam())
                    .email(member.getEmail())
                    .capacity(member.getCapacity())
                    .active(member.getActive())
                    .queueStartDate(member.getQueueStartDate())
                    .build();
        }
    }
}
