package com.timeline.controller;

import com.timeline.dto.WarningDto;
import com.timeline.service.WarningService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Warning 시스템 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class WarningController {

    private final WarningService warningService;

    /**
     * 프로젝트별 경고 목록 조회
     */
    @GetMapping("/api/v1/projects/{projectId}/warnings")
    public ResponseEntity<?> getProjectWarnings(@PathVariable Long projectId) {
        WarningDto.ProjectWarningsResponse response = warningService.detectProjectWarnings(projectId);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", response
        ));
    }

    /**
     * 전체 경고 요약 (Dashboard용)
     */
    @GetMapping("/api/v1/warnings/summary")
    public ResponseEntity<?> getWarningSummary() {
        WarningDto.SummaryResponse response = warningService.getWarningSummary();
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", response
        ));
    }
}
