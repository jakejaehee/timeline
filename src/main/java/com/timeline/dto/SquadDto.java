package com.timeline.dto;

import com.timeline.domain.entity.Squad;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 스쿼드 요청/응답 DTO
 */
public class SquadDto {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Request {
        private String name;
        private String description;
        private String color;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private String name;
        private String description;
        private String color;
        private List<MemberDto.Response> members;

        public static Response from(Squad squad) {
            return Response.builder()
                    .id(squad.getId())
                    .name(squad.getName())
                    .description(squad.getDescription())
                    .color(squad.getColor())
                    .build();
        }

        public static Response from(Squad squad, List<MemberDto.Response> members) {
            return Response.builder()
                    .id(squad.getId())
                    .name(squad.getName())
                    .description(squad.getDescription())
                    .color(squad.getColor())
                    .members(members)
                    .build();
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AddMemberRequest {
        private Long memberId;
    }
}
