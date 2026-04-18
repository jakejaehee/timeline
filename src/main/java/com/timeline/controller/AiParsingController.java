package com.timeline.controller;

import com.timeline.dto.ParseRequestDto;
import com.timeline.dto.ParsedTaskDto;
import com.timeline.service.AiParsingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * AI 파싱 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/projects/{projectId}/tasks")
public class AiParsingController {

    private final AiParsingService aiParsingService;

    /**
     * free-text를 AI로 파싱하여 태스크 미리보기 결과 반환
     */
    @PostMapping("/parse")
    public ResponseEntity<?> parseText(@PathVariable Long projectId,
                                       @RequestBody ParseRequestDto request) {
        log.info("AI 파싱 요청: projectId={}, textLength={}", projectId,
                request.getText() != null ? request.getText().length() : 0);

        if (request.getText() == null || request.getText().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "INVALID_INPUT",
                    "message", "파싱할 텍스트를 입력해주세요."
            ));
        }

        ParsedTaskDto parsed = aiParsingService.parseTasksFromText(request.getText(), projectId);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", Map.of("parsed", parsed.getSquads())
        ));
    }

    /**
     * 파싱된 태스크 결과를 DB에 저장
     */
    @PostMapping("/parse/save")
    public ResponseEntity<?> saveParsedTasks(@PathVariable Long projectId,
                                              @RequestBody ParsedTaskDto parsedData) {
        log.info("파싱 결과 저장 요청: projectId={}", projectId);

        if (parsedData.getSquads() == null || parsedData.getSquads().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "INVALID_INPUT",
                    "message", "저장할 태스크 데이터가 없습니다."
            ));
        }

        List<Long> savedTaskIds = aiParsingService.saveParsedTasks(projectId, parsedData);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", Map.of("savedTaskIds", savedTaskIds)
        ));
    }
}
