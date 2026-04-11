package com.timeline.service;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Set;

/**
 * 영업일 계산 유틸리티 컴포넌트
 * - 공수(MD) 기반 종료일 계산
 * - 다음 영업일 반환
 * - 영업일 보정
 * - 토/일 제외 영업일 판단
 * - capacity 반영 종료일 계산
 * - 비가용일(공휴일/회사휴무/개인휴무) 반영 (Phase 2)
 */
@Component
public class BusinessDayCalculator {

    /**
     * 종료일 계산 (공수 기반, 주말 제외)
     * - 소수점 공수는 올림 처리 (0.5일 -> 1일)
     * - capacity 1.0 기본 적용
     *
     * @param startDate 시작일
     * @param manDays   공수 (영업일 수)
     * @return 종료일
     */
    public LocalDate calculateEndDate(LocalDate startDate, BigDecimal manDays) {
        return calculateEndDate(startDate, manDays, BigDecimal.ONE);
    }

    /**
     * 종료일 계산 (공수 + capacity 기반, 주말 제외)
     * - actual_duration = ceil(MD / capacity) 영업일 수
     * - 소수점 공수는 올림 처리
     *
     * @param startDate 시작일
     * @param manDays   공수 (영업일 수)
     * @param capacity  담당자 하루 투입 가능 MD (0.5 또는 1.0, null이면 1.0)
     * @return 종료일
     */
    public LocalDate calculateEndDate(LocalDate startDate, BigDecimal manDays, BigDecimal capacity) {
        return calculateEndDate(startDate, manDays, capacity, null);
    }

    /**
     * 종료일 계산 (공수 + capacity + 비가용일 기반)
     * - actual_duration = ceil(MD / capacity) 영업일 수
     * - 비가용일(공휴일/회사휴무/개인휴무) 제외
     *
     * @param startDate        시작일
     * @param manDays          공수 (영업일 수)
     * @param capacity         담당자 하루 투입 가능 MD (null이면 1.0)
     * @param unavailableDates 비가용일 Set (null이면 비가용일 없음)
     * @return 종료일
     */
    public LocalDate calculateEndDate(LocalDate startDate, BigDecimal manDays,
                                       BigDecimal capacity, Set<LocalDate> unavailableDates) {
        if (manDays == null || manDays.compareTo(BigDecimal.ZERO) < 0) {
            return startDate;
        }

        // capacity 보정 (null 또는 0 이하이면 1.0)
        BigDecimal effectiveCapacity = (capacity != null && capacity.compareTo(BigDecimal.ZERO) > 0)
                ? capacity : BigDecimal.ONE;

        // actual_duration = ceil(MD / capacity)
        BigDecimal actualDuration = manDays.divide(effectiveCapacity, 0, RoundingMode.CEILING);

        int businessDays = actualDuration.intValue();
        if (businessDays <= 0) {
            // MD > 0인데 capacity로 나눈 결과가 0 이하이면 최소 1일
            if (manDays.compareTo(BigDecimal.ZERO) > 0) {
                businessDays = 1;
            } else {
                return startDate;
            }
        }

        // 시작일이 비가용일이면 다음 영업일로 보정
        LocalDate endDate = ensureBusinessDay(startDate, unavailableDates);
        int daysAdded = 1; // 시작일도 영업일 1일로 카운트

        while (daysAdded < businessDays) {
            endDate = endDate.plusDays(1);
            if (isBusinessDay(endDate, unavailableDates)) {
                daysAdded++;
            }
        }

        return endDate;
    }

    /**
     * MD가 fractional(소수점)인지 확인
     * - fractional이면 Same-Day Rule 적용 가능 (선행 태스크 endDate 당일 시작)
     *
     * @param manDays 공수
     * @return fractional 여부
     */
    public boolean isFractionalMd(BigDecimal manDays) {
        if (manDays == null) {
            return false;
        }
        return manDays.remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) != 0;
    }

    /**
     * 다음 영업일 반환 (주어진 날짜의 다음 날부터)
     */
    public LocalDate getNextBusinessDay(LocalDate date) {
        LocalDate next = date.plusDays(1);
        return ensureBusinessDay(next);
    }

    /**
     * 다음 영업일 반환 (비가용일 반영)
     */
    public LocalDate getNextBusinessDay(LocalDate date, Set<LocalDate> unavailableDates) {
        LocalDate next = date.plusDays(1);
        return ensureBusinessDay(next, unavailableDates);
    }

    /**
     * 주어진 날짜가 영업일이 아니면 다음 영업일 반환
     */
    public LocalDate ensureBusinessDay(LocalDate date) {
        return ensureBusinessDay(date, null);
    }

    /**
     * 주어진 날짜가 영업일이 아니면 다음 영업일 반환 (비가용일 반영)
     */
    public LocalDate ensureBusinessDay(LocalDate date, Set<LocalDate> unavailableDates) {
        while (!isBusinessDay(date, unavailableDates)) {
            date = date.plusDays(1);
        }
        return date;
    }

    /**
     * 영업일 여부 확인 (토/일 제외)
     */
    public boolean isBusinessDay(LocalDate date) {
        return isBusinessDay(date, null);
    }

    /**
     * 영업일 여부 확인 (토/일 + 비가용일 제외)
     *
     * @param date             확인할 날짜
     * @param unavailableDates 비가용일 Set (null이면 비가용일 없음)
     * @return 영업일 여부
     */
    public boolean isBusinessDay(LocalDate date, Set<LocalDate> unavailableDates) {
        DayOfWeek dow = date.getDayOfWeek();
        if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) {
            return false;
        }
        // 비가용일 확인
        if (unavailableDates != null && unavailableDates.contains(date)) {
            return false;
        }
        return true;
    }
}
