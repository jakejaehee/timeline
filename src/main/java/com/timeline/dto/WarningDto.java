package com.timeline.dto;

import com.timeline.domain.enums.WarningType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 경고 DTO
 */
public class WarningDto {

    /**
     * 개별 경고 항목
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Warning {
        private WarningType type;
        private Long taskId;
        private String taskName;
        private Long projectId;
        private String projectName;
        private String message;
    }

    /**
     * 프로젝트별 경고 응답
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectWarningsResponse {
        private Long projectId;
        private String projectName;
        private List<Warning> warnings;
    }

    /**
     * 전체 경고 요약
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SummaryResponse {
        private int totalWarnings;
        private int unorderedCount;
        private int missingStartDateCount;
        private int scheduleConflictCount;
        private int dependencyIssueCount;
        private int deadlineExceededCount;
        private int orphanTaskCount;
        private int dependencyRemovedCount;
        private int unavailableDateCount;
        private List<Warning> warnings;
    }
}
