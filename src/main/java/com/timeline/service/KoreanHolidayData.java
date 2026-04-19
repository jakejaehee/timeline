package com.timeline.service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * 한국 공휴일 하드코딩 데이터
 * - 고정 양력 공휴일: 매년 동일
 * - 음력 공휴일: 2025~2030년 양력 환산 날짜 하드코딩
 * - 대체공휴일: 2025~2030년 하드코딩 (관공서의 공휴일에 관한 규정 제3조)
 */
public final class KoreanHolidayData {

    private KoreanHolidayData() {
        // 유틸리티 클래스 — 인스턴스 생성 방지
    }

    /**
     * 공휴일 항목 (날짜 + 이름)
     */
    public record HolidayEntry(LocalDate date, String name) {}

    // ── 고정 양력 공휴일 (월-일) ──
    private static final int[][] FIXED_SOLAR = {
            {1, 1},   // 신정
            {3, 1},   // 삼일절
            {5, 5},   // 어린이날
            {6, 6},   // 현충일
            {8, 15},  // 광복절
            {10, 3},  // 개천절
            {10, 9},  // 한글날
            {12, 25}  // 크리스마스
    };

    private static final String[] FIXED_SOLAR_NAMES = {
            "신정", "삼일절", "어린이날", "현충일",
            "광복절", "개천절", "한글날", "크리스마스"
    };

    // ── 음력 공휴일 + 대체공휴일 하드코딩 테이블 (2025~2030) ──
    // 대체공휴일: 공휴일이 토/일 또는 다른 공휴일과 겹칠 때 다음 첫 비공휴일
    private static final Map<Integer, List<HolidayEntry>> LUNAR_AND_SUBSTITUTE = Map.of(
            2025, List.of(
                    new HolidayEntry(LocalDate.of(2025, 1, 28), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2025, 1, 29), "설날"),
                    new HolidayEntry(LocalDate.of(2025, 1, 30), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2025, 3, 3), "삼일절 대체공휴일"),       // 3/1(토)
                    new HolidayEntry(LocalDate.of(2025, 5, 5), "석가탄신일"),               // 어린이날과 겹침
                    new HolidayEntry(LocalDate.of(2025, 5, 6), "어린이날 대체공휴일"),       // 석가탄신일과 겹침
                    new HolidayEntry(LocalDate.of(2025, 10, 5), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2025, 10, 6), "추석"),
                    new HolidayEntry(LocalDate.of(2025, 10, 7), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2025, 10, 8), "추석 대체공휴일")          // 10/5(일)
            ),
            2026, List.of(
                    new HolidayEntry(LocalDate.of(2026, 2, 16), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2026, 2, 17), "설날"),
                    new HolidayEntry(LocalDate.of(2026, 2, 18), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2026, 3, 2), "삼일절 대체공휴일"),         // 3/1(일)
                    new HolidayEntry(LocalDate.of(2026, 5, 24), "석가탄신일"),
                    new HolidayEntry(LocalDate.of(2026, 5, 25), "석가탄신일 대체공휴일"),     // 5/24(일)
                    new HolidayEntry(LocalDate.of(2026, 8, 17), "광복절 대체공휴일"),         // 8/15(토)
                    new HolidayEntry(LocalDate.of(2026, 9, 24), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2026, 9, 25), "추석"),
                    new HolidayEntry(LocalDate.of(2026, 9, 26), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2026, 9, 28), "추석 대체공휴일"),          // 9/26(토)
                    new HolidayEntry(LocalDate.of(2026, 10, 5), "개천절 대체공휴일")         // 10/3(토)
            ),
            2027, List.of(
                    new HolidayEntry(LocalDate.of(2027, 2, 6), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2027, 2, 7), "설날"),
                    new HolidayEntry(LocalDate.of(2027, 2, 8), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2027, 2, 9), "설날 대체공휴일"),           // 2/6(토), 2/7(일)
                    new HolidayEntry(LocalDate.of(2027, 5, 13), "석가탄신일"),
                    new HolidayEntry(LocalDate.of(2027, 8, 16), "광복절 대체공휴일"),         // 8/15(일)
                    new HolidayEntry(LocalDate.of(2027, 10, 4), "개천절 대체공휴일"),         // 10/3(일)
                    new HolidayEntry(LocalDate.of(2027, 10, 11), "한글날 대체공휴일"),        // 10/9(토)
                    new HolidayEntry(LocalDate.of(2027, 10, 14), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2027, 10, 15), "추석"),
                    new HolidayEntry(LocalDate.of(2027, 10, 16), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2027, 10, 18), "추석 대체공휴일"),         // 10/16(토)
                    new HolidayEntry(LocalDate.of(2027, 12, 27), "크리스마스 대체공휴일")     // 12/25(토)
            ),
            2028, List.of(
                    new HolidayEntry(LocalDate.of(2028, 1, 26), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2028, 1, 27), "설날"),
                    new HolidayEntry(LocalDate.of(2028, 1, 28), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2028, 5, 2), "석가탄신일"),
                    new HolidayEntry(LocalDate.of(2028, 10, 2), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2028, 10, 3), "추석"),                    // 개천절과 겹침
                    new HolidayEntry(LocalDate.of(2028, 10, 4), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2028, 10, 5), "개천절 대체공휴일")         // 추석과 겹침
            ),
            2029, List.of(
                    new HolidayEntry(LocalDate.of(2029, 2, 12), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2029, 2, 13), "설날"),
                    new HolidayEntry(LocalDate.of(2029, 2, 14), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2029, 5, 7), "어린이날 대체공휴일"),        // 5/5(토)
                    new HolidayEntry(LocalDate.of(2029, 5, 20), "석가탄신일"),
                    new HolidayEntry(LocalDate.of(2029, 5, 21), "석가탄신일 대체공휴일"),      // 5/20(일)
                    new HolidayEntry(LocalDate.of(2029, 9, 22), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2029, 9, 23), "추석"),
                    new HolidayEntry(LocalDate.of(2029, 9, 24), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2029, 9, 25), "추석 대체공휴일"),           // 9/22(토), 9/23(일)
                    new HolidayEntry(LocalDate.of(2029, 9, 26), "추석 대체공휴일")            // 9/22(토), 9/23(일)
            ),
            2030, List.of(
                    new HolidayEntry(LocalDate.of(2030, 2, 2), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2030, 2, 3), "설날"),
                    new HolidayEntry(LocalDate.of(2030, 2, 4), "설날 연휴"),
                    new HolidayEntry(LocalDate.of(2030, 2, 5), "설날 대체공휴일"),            // 2/2(토), 2/3(일)
                    new HolidayEntry(LocalDate.of(2030, 2, 6), "설날 대체공휴일"),            // 2/2(토), 2/3(일)
                    new HolidayEntry(LocalDate.of(2030, 5, 6), "어린이날 대체공휴일"),         // 5/5(일)
                    new HolidayEntry(LocalDate.of(2030, 5, 9), "석가탄신일"),
                    new HolidayEntry(LocalDate.of(2030, 10, 11), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2030, 10, 12), "추석"),
                    new HolidayEntry(LocalDate.of(2030, 10, 13), "추석 연휴"),
                    new HolidayEntry(LocalDate.of(2030, 10, 14), "추석 대체공휴일"),          // 10/12(토), 10/13(일)
                    new HolidayEntry(LocalDate.of(2030, 10, 15), "추석 대체공휴일")           // 10/12(토), 10/13(일)
            )
    );

    /**
     * 지원되는 연도 범위의 최소값
     */
    public static final int MIN_YEAR = 2025;

    /**
     * 지원되는 연도 범위의 최대값
     */
    public static final int MAX_YEAR = 2030;

    /**
     * 주어진 연도의 한국 공휴일 목록을 반환한다.
     * - 고정 양력 공휴일은 항상 포함
     * - 음력 공휴일 + 대체공휴일은 2025~2030년 범위 내에서만 포함
     *
     * @param year 연도
     * @return 공휴일 목록 (날짜 오름차순)
     */
    public static List<HolidayEntry> getHolidays(int year) {
        List<HolidayEntry> holidays = new ArrayList<>();

        // 고정 양력 공휴일
        for (int i = 0; i < FIXED_SOLAR.length; i++) {
            holidays.add(new HolidayEntry(
                    LocalDate.of(year, FIXED_SOLAR[i][0], FIXED_SOLAR[i][1]),
                    FIXED_SOLAR_NAMES[i]
            ));
        }

        // 음력 공휴일 + 대체공휴일 (하드코딩 범위 내)
        List<HolidayEntry> lunarAndSubst = LUNAR_AND_SUBSTITUTE.get(year);
        if (lunarAndSubst != null) {
            holidays.addAll(lunarAndSubst);
        }

        // 날짜 오름차순 정렬
        holidays.sort(java.util.Comparator.comparing(HolidayEntry::date));

        return Collections.unmodifiableList(holidays);
    }
}
