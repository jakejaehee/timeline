package com.timeline.service;

import com.timeline.domain.entity.Member;
import com.timeline.domain.entity.MemberLeave;
import com.timeline.domain.repository.MemberLeaveRepository;
import com.timeline.domain.repository.MemberRepository;
import com.timeline.dto.MemberLeaveDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 멤버 개인 휴무 서비스
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MemberLeaveService {

    private final MemberLeaveRepository memberLeaveRepository;
    private final MemberRepository memberRepository;

    /**
     * 특정 멤버의 개인 휴무 목록 조회
     */
    public List<MemberLeaveDto.Response> getMemberLeaves(Long memberId) {
        if (!memberRepository.existsById(memberId)) {
            throw new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + memberId);
        }
        return memberLeaveRepository.findByMemberIdOrderByDateAsc(memberId).stream()
                .map(MemberLeaveDto.Response::from)
                .collect(Collectors.toList());
    }

    /**
     * 개인 휴무 등록
     */
    @Transactional
    public MemberLeaveDto.Response createMemberLeave(Long memberId, MemberLeaveDto.Request request) {
        if (request.getDate() == null) {
            throw new IllegalArgumentException("날짜는 필수입니다.");
        }

        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + memberId));

        String reason = request.getReason() != null ? request.getReason().trim() : null;
        if (reason != null && reason.length() > 200) {
            reason = reason.substring(0, 200);
        }

        MemberLeave leave = MemberLeave.builder()
                .member(member)
                .date(request.getDate())
                .reason(reason)
                .build();

        MemberLeave saved = memberLeaveRepository.save(leave);
        log.info("개인 휴무 등록: id={}, memberId={}, date={}", saved.getId(), memberId, saved.getDate());
        return MemberLeaveDto.Response.from(saved);
    }

    /**
     * 개인 휴무 삭제
     */
    @Transactional
    public void deleteMemberLeave(Long memberId, Long leaveId) {
        MemberLeave leave = memberLeaveRepository.findById(leaveId)
                .orElseThrow(() -> new EntityNotFoundException("개인 휴무를 찾을 수 없습니다. id=" + leaveId));

        if (!leave.getMember().getId().equals(memberId)) {
            throw new IllegalArgumentException("해당 멤버의 휴무가 아닙니다.");
        }

        memberLeaveRepository.delete(leave);
        log.info("개인 휴무 삭제: id={}, memberId={}, date={}", leaveId, memberId, leave.getDate());
    }

    /**
     * 특정 멤버의 특정 기간 내 개인 휴무 날짜 Set 조회
     * - BusinessDayCalculator에 전달할 비가용일 목록 생성용
     */
    public Set<LocalDate> getMemberLeaveDatesBetween(Long memberId, LocalDate startDate, LocalDate endDate) {
        if (memberId == null || startDate == null || endDate == null) {
            return new HashSet<>();
        }
        return memberLeaveRepository.findDatesByMemberIdBetween(memberId, startDate, endDate);
    }

    /**
     * 특정 멤버의 전체 개인 휴무 날짜 Set 조회
     */
    public Set<LocalDate> getMemberLeaveDates(Long memberId) {
        if (memberId == null) {
            return new HashSet<>();
        }
        return memberLeaveRepository.findDatesByMemberId(memberId);
    }
}
