package com.timeline.dto;

import com.timeline.domain.entity.Member;
import com.timeline.domain.enums.MemberRole;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

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
        private String email;
        private BigDecimal capacity;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private String name;
        private MemberRole role;
        private String email;
        private BigDecimal capacity;
        private Boolean active;

        public static Response from(Member member) {
            return Response.builder()
                    .id(member.getId())
                    .name(member.getName())
                    .role(member.getRole())
                    .email(member.getEmail())
                    .capacity(member.getCapacity())
                    .active(member.getActive())
                    .build();
        }
    }
}
