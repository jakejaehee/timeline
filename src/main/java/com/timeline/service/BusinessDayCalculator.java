package com.timeline.service;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;

/**
 * 영업일 계산 유틸리티 컴포넌트
 * - 공수(MD) 기반 종료일 계산
 * - 다음 영업일 반환
 * - 영업일 보정
 * - 토/일 제외 영업일 판단
 */
@Component
public class BusinessDayCalculator {

    /**
     * 종료일 계산 (공수 기반, 주말 제외)
     * - 소수점 공수는 올림 처리 (0.5일 -> 1일)
     *
     * @param startDate 시작일
     * @param manDays   공수 (영업일 수)
     * @return 종료일
     */
    public LocalDate calculateEndDate(LocalDate startDate, BigDecimal manDays) {
        if (manDays == null || manDays.compareTo(BigDecimal.ZERO) < 0) {
            return startDate;
        }

        int businessDays = manDays.intValue();
        if (businessDays <= 0) {
            // 소수점만 있는 경우 (예: 0.5) -> 올림 후 1일
            if (manDays.remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) > 0) {
                businessDays = 1;
            } else {
                return startDate;
            }
        } else {
            // 소수점이 있으면 올림 (1.5일 -> 2일)
            if (manDays.remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) > 0) {
                businessDays = businessDays + 1;
            }
        }

        // 시작일이 주말이면 다음 영업일로 보정
        LocalDate endDate = ensureBusinessDay(startDate);
        int daysAdded = 1; // 시작일도 영업일 1일로 카운트

        while (daysAdded < businessDays) {
            endDate = endDate.plusDays(1);
            if (isBusinessDay(endDate)) {
                daysAdded++;
            }
        }

        return endDate;
    }

    /**
     * 다음 영업일 반환 (주어진 날짜의 다음 날부터)
     */
    public LocalDate getNextBusinessDay(LocalDate date) {
        LocalDate next = date.plusDays(1);
        return ensureBusinessDay(next);
    }

    /**
     * 주어진 날짜가 영업일이 아니면 다음 영업일 반환
     */
    public LocalDate ensureBusinessDay(LocalDate date) {
        while (!isBusinessDay(date)) {
            date = date.plusDays(1);
        }
        return date;
    }

    /**
     * 영업일 여부 확인 (토/일 제외)
     */
    public boolean isBusinessDay(LocalDate date) {
        DayOfWeek dow = date.getDayOfWeek();
        return dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY;
    }
}
