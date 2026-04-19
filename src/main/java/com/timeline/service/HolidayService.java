package com.timeline.service;

import com.timeline.domain.entity.Holiday;
import com.timeline.domain.repository.HolidayRepository;
import com.timeline.dto.HolidayDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.timeline.domain.enums.HolidayType;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 공휴일/회사 공통 휴무일 서비스
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class HolidayService {

    private final HolidayRepository holidayRepository;

    /**
     * 전체 목록 조회
     */
    public List<HolidayDto.Response> getAllHolidays() {
        return holidayRepository.findAllByOrderByDateAsc().stream()
                .map(HolidayDto.Response::from)
                .collect(Collectors.toList());
    }

    /**
     * 연도별 조회
     */
    public List<HolidayDto.Response> getHolidaysByYear(int year) {
        return holidayRepository.findByYear(year).stream()
                .map(HolidayDto.Response::from)
                .collect(Collectors.toList());
    }

    /**
     * 연도+월별 조회
     */
    public List<HolidayDto.Response> getHolidaysByYearAndMonth(int year, int month) {
        return holidayRepository.findByYearAndMonth(year, month).stream()
                .map(HolidayDto.Response::from)
                .collect(Collectors.toList());
    }

    /**
     * 공휴일/회사휴무 등록
     */
    @Transactional
    public HolidayDto.Response createHoliday(HolidayDto.Request request) {
        if (request.getDate() == null) {
            throw new IllegalArgumentException("날짜는 필수입니다.");
        }
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("공휴일명은 필수입니다.");
        }
        if (request.getName().trim().length() > 100) {
            throw new IllegalArgumentException("공휴일명은 100자를 초과할 수 없습니다.");
        }
        if (request.getType() == null) {
            throw new IllegalArgumentException("유형은 필수입니다.");
        }

        Holiday holiday = Holiday.builder()
                .date(request.getDate())
                .name(request.getName().trim())
                .type(request.getType())
                .build();

        Holiday saved = holidayRepository.save(holiday);
        log.info("공휴일/회사휴무 등록: id={}, date={}, name={}, type={}",
                saved.getId(), saved.getDate(), saved.getName(), saved.getType());
        return HolidayDto.Response.from(saved);
    }

    /**
     * 삭제
     */
    @Transactional
    public void deleteHoliday(Long id) {
        Holiday holiday = holidayRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("공휴일/회사휴무를 찾을 수 없습니다. id=" + id));
        holidayRepository.delete(holiday);
        log.info("공휴일/회사휴무 삭제: id={}, date={}, name={}", id, holiday.getDate(), holiday.getName());
    }

    /**
     * 특정 기간의 공휴일/회사휴무 날짜 Set 조회
     * - BusinessDayCalculator에 전달할 비가용일 목록 생성용
     */
    public Set<LocalDate> getHolidayDatesBetween(LocalDate startDate, LocalDate endDate) {
        if (startDate == null || endDate == null) {
            return new HashSet<>();
        }
        return holidayRepository.findDatesBetween(startDate, endDate);
    }

    /**
     * 한국 공휴일 일괄 등록
     * - 해당 연도의 고정 양력 + 음력 공휴일을 일괄 등록
     * - 이미 동일 날짜가 등록되어 있으면 건너뜀
     */
    @Transactional
    public HolidayDto.BulkResult bulkAddKoreanHolidays(int year) {
        List<KoreanHolidayData.HolidayEntry> candidates = KoreanHolidayData.getHolidays(year);
        Set<LocalDate> existingDates = holidayRepository.findDatesByYear(year);

        // 기존 DB 날짜 + 이번 배치 내 중복을 모두 추적
        Set<LocalDate> seenDates = new java.util.LinkedHashSet<>(existingDates);
        List<Holiday> toSave = new ArrayList<>();
        int skipped = 0;

        for (KoreanHolidayData.HolidayEntry entry : candidates) {
            if (!seenDates.add(entry.date())) {
                skipped++;
            } else {
                Holiday holiday = Holiday.builder()
                        .date(entry.date())
                        .name(entry.name())
                        .type(HolidayType.NATIONAL)
                        .build();
                toSave.add(holiday);
            }
        }

        if (!toSave.isEmpty()) {
            holidayRepository.saveAll(toSave);
        }

        log.info("한국 공휴일 일괄 등록: year={}, added={}, skipped={}", year, toSave.size(), skipped);
        return new HolidayDto.BulkResult(toSave.size(), skipped);
    }
}
