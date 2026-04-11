package com.timeline.domain.repository;

import com.timeline.domain.entity.Holiday;
import com.timeline.domain.enums.HolidayType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

@Repository
public interface HolidayRepository extends JpaRepository<Holiday, Long> {

    /**
     * 특정 연도의 공휴일/회사휴무 조회
     */
    @Query("SELECT h FROM Holiday h WHERE YEAR(h.date) = :year ORDER BY h.date ASC")
    List<Holiday> findByYear(@Param("year") int year);

    /**
     * 특정 연도+월의 공휴일/회사휴무 조회
     */
    @Query("SELECT h FROM Holiday h WHERE YEAR(h.date) = :year AND MONTH(h.date) = :month ORDER BY h.date ASC")
    List<Holiday> findByYearAndMonth(@Param("year") int year, @Param("month") int month);

    /**
     * 전체 목록 (날짜순)
     */
    List<Holiday> findAllByOrderByDateAsc();

    /**
     * 특정 기간 내 공휴일/회사휴무 날짜 목록 조회 (Set용)
     */
    @Query("SELECT h.date FROM Holiday h WHERE h.date >= :startDate AND h.date <= :endDate")
    Set<LocalDate> findDatesBetween(@Param("startDate") LocalDate startDate, @Param("endDate") LocalDate endDate);

    /**
     * 유형별 조회
     */
    List<Holiday> findByTypeOrderByDateAsc(HolidayType type);
}
