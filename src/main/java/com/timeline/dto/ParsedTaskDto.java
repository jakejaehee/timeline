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
     * 도메인 시스템별 파싱 결과 목록
     */
    private List<DomainSystemParsed> domainSystems;

    /**
     * 도메인 시스템 파싱 결과
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DomainSystemParsed {

        /**
         * 도메인 시스템명 (AI가 추출한 이름)
         */
        private String name;

        /**
         * DB의 도메인 시스템과 매칭 여부
         */
        private Boolean domainSystemMatched;

        /**
         * 해당 도메인 시스템의 태스크 목록
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
