package com.timeline.controller;

import com.timeline.dto.HolidayDto;
import com.timeline.service.HolidayService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 공휴일/회사휴무 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/holidays")
@RequiredArgsConstructor
public class HolidayController {

    private final HolidayService holidayService;

    /**
     * 공휴일/회사휴무 목록 조회
     * - 연도/월 필터 지원
     */
    @GetMapping
    public ResponseEntity<?> getHolidays(
            @RequestParam(required = false) Integer year,
            @RequestParam(required = false) Integer month) {

        Object data;
        if (year != null && month != null) {
            data = holidayService.getHolidaysByYearAndMonth(year, month);
        } else if (year != null) {
            data = holidayService.getHolidaysByYear(year);
        } else {
            data = holidayService.getAllHolidays();
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", data
        ));
    }

    /**
     * 공휴일/회사휴무 등록
     */
    @PostMapping
    public ResponseEntity<?> createHoliday(@RequestBody HolidayDto.Request request) {
        HolidayDto.Response created = holidayService.createHoliday(request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 공휴일/회사휴무 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteHoliday(@PathVariable Long id) {
        holidayService.deleteHoliday(id);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 한국 공휴일 일괄 등록
     */
    @PostMapping("/bulk-korean")
    public ResponseEntity<?> bulkAddKoreanHolidays(@RequestBody Map<String, Object> body) {
        Object yearObj = body.get("year");
        if (!(yearObj instanceof Number)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "연도를 입력해주세요."
            ));
        }
        int year = ((Number) yearObj).intValue();
        if (year < 2000 || year > 2099) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "연도는 2000~2099 범위만 지원합니다."
            ));
        }
        HolidayDto.BulkResult result = holidayService.bulkAddKoreanHolidays(year);
        return ResponseEntity.ok(Map.of("success", true, "data", result));
    }
}
