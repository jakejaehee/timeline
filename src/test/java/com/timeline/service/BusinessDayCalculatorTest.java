package com.timeline.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BusinessDayCalculator 단위 테스트
 */
class BusinessDayCalculatorTest {

    private BusinessDayCalculator calculator;

    @BeforeEach
    void setUp() {
        calculator = new BusinessDayCalculator();
    }

    // ---- isBusinessDay ----

    @Test
    @DisplayName("평일은 영업일이다")
    void isBusinessDay_weekday_returnsTrue() {
        // 2026-04-13 (월요일)
        assertThat(calculator.isBusinessDay(LocalDate.of(2026, 4, 13))).isTrue();
        // 2026-04-14 (화요일)
        assertThat(calculator.isBusinessDay(LocalDate.of(2026, 4, 14))).isTrue();
        // 2026-04-17 (금요일)
        assertThat(calculator.isBusinessDay(LocalDate.of(2026, 4, 17))).isTrue();
    }

    @Test
    @DisplayName("주말은 영업일이 아니다")
    void isBusinessDay_weekend_returnsFalse() {
        // 2026-04-11 (토요일)
        assertThat(calculator.isBusinessDay(LocalDate.of(2026, 4, 11))).isFalse();
        // 2026-04-12 (일요일)
        assertThat(calculator.isBusinessDay(LocalDate.of(2026, 4, 12))).isFalse();
    }

    // ---- ensureBusinessDay ----

    @Test
    @DisplayName("평일 입력 시 그대로 반환")
    void ensureBusinessDay_weekday_returnsSame() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        assertThat(calculator.ensureBusinessDay(monday)).isEqualTo(monday);
    }

    @Test
    @DisplayName("토요일 입력 시 다음 월요일 반환")
    void ensureBusinessDay_saturday_returnsMonday() {
        LocalDate saturday = LocalDate.of(2026, 4, 11);
        LocalDate expected = LocalDate.of(2026, 4, 13); // 월요일
        assertThat(calculator.ensureBusinessDay(saturday)).isEqualTo(expected);
    }

    @Test
    @DisplayName("일요일 입력 시 다음 월요일 반환")
    void ensureBusinessDay_sunday_returnsMonday() {
        LocalDate sunday = LocalDate.of(2026, 4, 12);
        LocalDate expected = LocalDate.of(2026, 4, 13); // 월요일
        assertThat(calculator.ensureBusinessDay(sunday)).isEqualTo(expected);
    }

    // ---- getNextBusinessDay ----

    @Test
    @DisplayName("목요일의 다음 영업일은 금요일")
    void getNextBusinessDay_thursday_returnsFriday() {
        LocalDate thursday = LocalDate.of(2026, 4, 16);
        LocalDate expected = LocalDate.of(2026, 4, 17); // 금요일
        assertThat(calculator.getNextBusinessDay(thursday)).isEqualTo(expected);
    }

    @Test
    @DisplayName("금요일의 다음 영업일은 월요일")
    void getNextBusinessDay_friday_returnsMonday() {
        LocalDate friday = LocalDate.of(2026, 4, 17);
        LocalDate expected = LocalDate.of(2026, 4, 20); // 월요일
        assertThat(calculator.getNextBusinessDay(friday)).isEqualTo(expected);
    }

    @Test
    @DisplayName("토요일의 다음 영업일은 월요일")
    void getNextBusinessDay_saturday_returnsMonday() {
        LocalDate saturday = LocalDate.of(2026, 4, 11);
        LocalDate expected = LocalDate.of(2026, 4, 13); // 월요일
        assertThat(calculator.getNextBusinessDay(saturday)).isEqualTo(expected);
    }

    // ---- calculateEndDate ----

    @Test
    @DisplayName("월요일 시작 + 1MD = 월요일")
    void calculateEndDate_1day_sameDay() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, BigDecimal.ONE);
        assertThat(result).isEqualTo(monday);
    }

    @Test
    @DisplayName("월요일 시작 + 3MD = 수요일")
    void calculateEndDate_3days_wednesday() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate expected = LocalDate.of(2026, 4, 15); // 수요일
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("3"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("월요일 시작 + 5MD = 금요일")
    void calculateEndDate_5days_friday() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate expected = LocalDate.of(2026, 4, 17); // 금요일
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("5"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("금요일 시작 + 3MD = 주말을 넘겨 화요일")
    void calculateEndDate_crossWeekend() {
        LocalDate friday = LocalDate.of(2026, 4, 17);
        // 금(1) -> 토(skip) -> 일(skip) -> 월(2) -> 화(3)
        LocalDate expected = LocalDate.of(2026, 4, 21); // 화요일
        LocalDate result = calculator.calculateEndDate(friday, new BigDecimal("3"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("소수점 공수 0.5MD -> 올림하여 1일")
    void calculateEndDate_halfDay_ceilToOne() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("0.5"));
        assertThat(result).isEqualTo(monday);
    }

    @Test
    @DisplayName("소수점 공수 1.5MD -> 올림하여 2일")
    void calculateEndDate_oneAndHalfDays_ceilToTwo() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate expected = LocalDate.of(2026, 4, 14); // 화요일
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("1.5"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("0MD -> 시작일 그대로")
    void calculateEndDate_zeroDays_sameDay() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, BigDecimal.ZERO);
        assertThat(result).isEqualTo(monday);
    }

    @Test
    @DisplayName("목요일 시작 + 10MD = 2주 후 수요일")
    void calculateEndDate_10days_twoWeeks() {
        LocalDate thursday = LocalDate.of(2026, 4, 16);
        // 목(1) 금(2) [토일] 월(3) 화(4) 수(5) 목(6) 금(7) [토일] 월(8) 화(9) 수(10)
        LocalDate expected = LocalDate.of(2026, 4, 29); // 수요일
        LocalDate result = calculator.calculateEndDate(thursday, new BigDecimal("10"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("토요일 시작 + 1MD = 다음 월요일 (주말 보정)")
    void calculateEndDate_saturdayStart_adjustsToMonday() {
        LocalDate saturday = LocalDate.of(2026, 4, 11);
        LocalDate expected = LocalDate.of(2026, 4, 13); // 월요일
        LocalDate result = calculator.calculateEndDate(saturday, BigDecimal.ONE);
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("일요일 시작 + 3MD = 다음 수요일 (주말 보정)")
    void calculateEndDate_sundayStart_adjustsToMonday() {
        LocalDate sunday = LocalDate.of(2026, 4, 12);
        // 보정 -> 월(1) 화(2) 수(3)
        LocalDate expected = LocalDate.of(2026, 4, 15); // 수요일
        LocalDate result = calculator.calculateEndDate(sunday, new BigDecimal("3"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("null manDays -> 시작일 그대로 반환")
    void calculateEndDate_nullManDays_returnStartDate() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, null);
        assertThat(result).isEqualTo(monday);
    }

    @Test
    @DisplayName("음수 manDays -> 시작일 그대로 반환")
    void calculateEndDate_negativeManDays_returnStartDate() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("-1"));
        assertThat(result).isEqualTo(monday);
    }

    // ---- calculateEndDate with capacity ----

    @Test
    @DisplayName("capacity 1.0 + 1MD = 1영업일 (기본 동작과 동일)")
    void calculateEndDate_capacity1_1md_sameDay() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, BigDecimal.ONE, BigDecimal.ONE);
        assertThat(result).isEqualTo(monday);
    }

    @Test
    @DisplayName("capacity 0.5 + 1MD = ceil(1/0.5)=2영업일 -> 화요일")
    void calculateEndDate_capacity05_1md_twoDays() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        // actual_duration = ceil(1.0 / 0.5) = 2영업일 -> 월(1), 화(2)
        LocalDate expected = LocalDate.of(2026, 4, 14); // 화요일
        LocalDate result = calculator.calculateEndDate(monday, BigDecimal.ONE, new BigDecimal("0.5"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("capacity 0.5 + 1.5MD = ceil(1.5/0.5)=3영업일 -> 수요일")
    void calculateEndDate_capacity05_15md_threeDays() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        // actual_duration = ceil(1.5 / 0.5) = 3영업일 -> 월(1), 화(2), 수(3)
        LocalDate expected = LocalDate.of(2026, 4, 15); // 수요일
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("1.5"), new BigDecimal("0.5"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("capacity 0.5 + 3MD = ceil(3/0.5)=6영업일 -> 주말 넘김")
    void calculateEndDate_capacity05_3md_crossWeekend() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        // actual_duration = ceil(3.0 / 0.5) = 6영업일
        // 월(1), 화(2), 수(3), 목(4), 금(5), [토일 skip], 월(6)
        LocalDate expected = LocalDate.of(2026, 4, 20); // 다음 월요일
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("3"), new BigDecimal("0.5"));
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("capacity null -> 1.0으로 처리")
    void calculateEndDate_nullCapacity_treatsAsOne() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("3"), null);
        LocalDate expected = LocalDate.of(2026, 4, 15); // 수요일
        assertThat(result).isEqualTo(expected);
    }

    @Test
    @DisplayName("capacity 0 -> 1.0으로 보정")
    void calculateEndDate_zeroCapacity_treatsAsOne() {
        LocalDate monday = LocalDate.of(2026, 4, 13);
        LocalDate result = calculator.calculateEndDate(monday, new BigDecimal("3"), BigDecimal.ZERO);
        LocalDate expected = LocalDate.of(2026, 4, 15); // 수요일
        assertThat(result).isEqualTo(expected);
    }

    // ---- isFractionalMd ----

    @Test
    @DisplayName("정수 MD는 fractional이 아니다")
    void isFractionalMd_integer_returnsFalse() {
        assertThat(calculator.isFractionalMd(BigDecimal.ONE)).isFalse();
        assertThat(calculator.isFractionalMd(new BigDecimal("3"))).isFalse();
        assertThat(calculator.isFractionalMd(new BigDecimal("10.0"))).isFalse();
    }

    @Test
    @DisplayName("소수점 MD는 fractional이다")
    void isFractionalMd_fractional_returnsTrue() {
        assertThat(calculator.isFractionalMd(new BigDecimal("0.5"))).isTrue();
        assertThat(calculator.isFractionalMd(new BigDecimal("1.5"))).isTrue();
        assertThat(calculator.isFractionalMd(new BigDecimal("2.3"))).isTrue();
    }

    @Test
    @DisplayName("null MD는 fractional이 아니다")
    void isFractionalMd_null_returnsFalse() {
        assertThat(calculator.isFractionalMd(null)).isFalse();
    }
}
