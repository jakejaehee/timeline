package com.timeline.dto;

import com.timeline.domain.entity.Holiday;
import com.timeline.domain.enums.HolidayType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 공휴일/회사휴무 요청/응답 DTO
 */
public class HolidayDto {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Request {
        private LocalDate date;
        private String name;
        private HolidayType type;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Response {
        private Long id;
        private LocalDate date;
        private String name;
        private HolidayType type;
        private LocalDateTime createdAt;

        public static Response from(Holiday holiday) {
            return Response.builder()
                    .id(holiday.getId())
                    .date(holiday.getDate())
                    .name(holiday.getName())
                    .type(holiday.getType())
                    .createdAt(holiday.getCreatedAt())
                    .build();
        }
    }

    /**
     * 일괄 등록 결과
     */
    @Data
    @AllArgsConstructor
    public static class BulkResult {
        private int added;
        private int skipped;
    }
}
