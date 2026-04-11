package com.timeline.dto;

import com.timeline.domain.entity.MemberLeave;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 멤버 개인 휴무 요청/응답 DTO
 */
public class MemberLeaveDto {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Request {
        private LocalDate date;
        private String reason;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private Long memberId;
        private String memberName;
        private LocalDate date;
        private String reason;
        private LocalDateTime createdAt;

        public static Response from(MemberLeave leave) {
            return Response.builder()
                    .id(leave.getId())
                    .memberId(leave.getMember().getId())
                    .memberName(leave.getMember().getName())
                    .date(leave.getDate())
                    .reason(leave.getReason())
                    .createdAt(leave.getCreatedAt())
                    .build();
        }
    }
}
