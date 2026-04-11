package com.timeline.controller;

import com.timeline.domain.enums.TaskPriority;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.enums.TaskType;
import com.timeline.dto.TeamBoardDto;
import com.timeline.service.TeamBoardService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.Map;

/**
 * Team Board REST API 컨트롤러
 * - 전체 프로젝트의 태스크를 멤버별 그룹핑하여 조회
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/team-board")
@RequiredArgsConstructor
public class TeamBoardController {

    private final TeamBoardService teamBoardService;

    /**
     * 팀 보드 태스크 조회
     * - 필터: status, projectId, startDate, endDate, assigneeId, priority, type, unordered, isDelayed
     */
    @GetMapping("/tasks")
    public ResponseEntity<?> getTeamBoardTasks(
            @RequestParam(required = false) TaskStatus status,
            @RequestParam(required = false) Long projectId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(required = false) Long assigneeId,
            @RequestParam(required = false) TaskPriority priority,
            @RequestParam(required = false) TaskType type,
            @RequestParam(required = false) Boolean unordered,
            @RequestParam(required = false) Boolean isDelayed) {

        log.debug("Team Board 조회 - status={}, projectId={}, startDate={}, endDate={}, assigneeId={}, priority={}, type={}, unordered={}, isDelayed={}",
                status, projectId, startDate, endDate, assigneeId, priority, type, unordered, isDelayed);
        TeamBoardDto.Response response = teamBoardService.getTeamBoard(status, projectId, startDate, endDate,
                assigneeId, priority, type, unordered, isDelayed);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", response
        ));
    }
}
