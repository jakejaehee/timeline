package com.timeline.domain.repository;

import com.timeline.domain.entity.MemberLeave;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

@Repository
public interface MemberLeaveRepository extends JpaRepository<MemberLeave, Long> {

    /**
     * 특정 멤버의 개인 휴무 목록 (날짜순)
     */
    @Query("SELECT ml FROM MemberLeave ml WHERE ml.member.id = :memberId ORDER BY ml.date ASC")
    List<MemberLeave> findByMemberIdOrderByDateAsc(@Param("memberId") Long memberId);

    /**
     * 특정 멤버의 특정 기간 내 개인 휴무 날짜 목록 조회 (Set용)
     */
    @Query("SELECT ml.date FROM MemberLeave ml WHERE ml.member.id = :memberId AND ml.date >= :startDate AND ml.date <= :endDate")
    Set<LocalDate> findDatesByMemberIdBetween(
            @Param("memberId") Long memberId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate);

    /**
     * 특정 멤버의 전체 개인 휴무 날짜 Set
     */
    @Query("SELECT ml.date FROM MemberLeave ml WHERE ml.member.id = :memberId")
    Set<LocalDate> findDatesByMemberId(@Param("memberId") Long memberId);
}
