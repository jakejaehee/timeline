package com.timeline.dto;

import com.timeline.domain.entity.DomainSystem;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 도메인 시스템 요청/응답 DTO
 */
public class DomainSystemDto {

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

        public static Response from(DomainSystem domainSystem) {
            return Response.builder()
                    .id(domainSystem.getId())
                    .name(domainSystem.getName())
                    .description(domainSystem.getDescription())
                    .color(domainSystem.getColor())
                    .build();
        }
    }
}
