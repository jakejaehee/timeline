package com.timeline.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * AI 파싱 결과 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ParsedTaskDto {

    /**
     * 스쿼드별 파싱 결과 목록
     */
    private List<SquadParsed> squads;

    /**
     * 스쿼드 파싱 결과
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SquadParsed {

        /**
         * 스쿼드명 (AI가 추출한 이름)
         */
        private String name;

        /**
         * DB의 스쿼드와 매칭 여부
         */
        private Boolean squadMatched;

        /**
         * 해당 스쿼드의 태스크 목록
         */
        private List<TaskParsed> tasks;
    }

    /**
     * 태스크 파싱 결과
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TaskParsed {

        /**
         * 태스크명
         */
        private String name;

        /**
         * 담당자명 (AI가 추출한 이름)
         */
        private String assigneeName;

        /**
         * 프로젝트 멤버와 매칭 여부
         */
        private Boolean assigneeMatched;

        /**
         * 공수 (man-days)
         */
        private BigDecimal manDays;

        /**
         * 의존하는 선행 태스크명 목록
         */
        private List<String> dependsOn;
    }
}
