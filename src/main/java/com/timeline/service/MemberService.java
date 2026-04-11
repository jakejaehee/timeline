package com.timeline.service;

import com.timeline.domain.entity.Member;
import com.timeline.domain.entity.Task;
import com.timeline.domain.repository.MemberRepository;
import com.timeline.domain.repository.TaskRepository;
import com.timeline.dto.MemberDto;
import com.timeline.dto.TeamBoardDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 멤버 CRUD 서비스
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MemberService {

    private final MemberRepository memberRepository;
    private final TaskRepository taskRepository;

    /**
     * 전체 멤버 목록 조회 (활성 멤버만)
     */
    public List<MemberDto.Response> getAllMembers() {
        return memberRepository.findByActiveTrueOrderByNameAsc().stream()
                .map(MemberDto.Response::from)
                .collect(Collectors.toList());
    }

    /**
     * 멤버 상세 조회
     */
    public MemberDto.Response getMember(Long id) {
        Member member = findMemberById(id);
        return MemberDto.Response.from(member);
    }

    /**
     * 멤버 생성
     */
    @Transactional
    public MemberDto.Response createMember(MemberDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("멤버 이름은 필수입니다.");
        }
        if (request.getRole() == null) {
            throw new IllegalArgumentException("멤버 역할은 필수입니다.");
        }

        Member.MemberBuilder builder = Member.builder()
                .name(request.getName())
                .role(request.getRole())
                .email(request.getEmail());

        // capacity가 null이면 @Builder.Default(1.0)가 적용됨
        if (request.getCapacity() != null) {
            validateCapacity(request.getCapacity());
            builder.capacity(request.getCapacity());
        }

        if (request.getQueueStartDate() != null) {
            builder.queueStartDate(request.getQueueStartDate());
        }

        Member saved = memberRepository.save(builder.build());
        log.info("멤버 생성 완료: id={}, name={}, capacity={}", saved.getId(), saved.getName(), saved.getCapacity());
        return MemberDto.Response.from(saved);
    }

    /**
     * 멤버 수정
     */
    @Transactional
    public MemberDto.Response updateMember(Long id, MemberDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("멤버 이름은 필수입니다.");
        }
        if (request.getRole() == null) {
            throw new IllegalArgumentException("멤버 역할은 필수입니다.");
        }

        Member member = findMemberById(id);

        member.setName(request.getName());
        member.setRole(request.getRole());
        member.setEmail(request.getEmail());
        if (request.getCapacity() != null) {
            validateCapacity(request.getCapacity());
            member.setCapacity(request.getCapacity());
        }

        member.setQueueStartDate(request.getQueueStartDate());

        Member updated = memberRepository.save(member);
        log.info("멤버 수정 완료: id={}, name={}, capacity={}", updated.getId(), updated.getName(), updated.getCapacity());
        return MemberDto.Response.from(updated);
    }

    /**
     * 멤버 삭제 (soft delete: active = false)
     */
    @Transactional
    public void deleteMember(Long id) {
        Member member = findMemberById(id);
        member.setActive(false);
        memberRepository.save(member);
        log.info("멤버 비활성화 완료: id={}, name={}", member.getId(), member.getName());
    }

    /**
     * 특정 멤버의 배정 태스크 목록 조회
     */
    public List<TeamBoardDto.TaskItem> getMemberTasks(Long memberId) {
        findMemberById(memberId);

        List<Task> tasks = taskRepository.findByAssigneeIdWithDetails(memberId);
        return tasks.stream()
                .map(TeamBoardDto.TaskItem::from)
                .collect(Collectors.toList());
    }

    /**
     * 큐 착수일 변경
     */
    @Transactional
    public void updateQueueStartDate(Long id, String dateStr) {
        Member member = findMemberById(id);
        LocalDate queueStartDate = null;
        if (dateStr != null && !dateStr.isBlank()) {
            try {
                queueStartDate = LocalDate.parse(dateStr.trim());
            } catch (java.time.format.DateTimeParseException e) {
                throw new IllegalArgumentException("올바른 날짜 형식이 아닙니다: " + dateStr);
            }
        }
        member.setQueueStartDate(queueStartDate);
        memberRepository.save(member);
        log.info("멤버 큐 착수일 변경: id={}, queueStartDate={}", id, queueStartDate);
    }

    /**
     * ID로 멤버 조회 (내부용)
     */
    public Member findMemberById(Long id) {
        return memberRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + id));
    }

    /**
     * capacity 값 유효성 검증
     * - 0보다 커야 함
     * - DB column precision(3, scale=1) 이므로 최대 99.9
     */
    private void validateCapacity(BigDecimal capacity) {
        if (capacity.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Capacity는 0보다 커야 합니다.");
        }
        if (capacity.compareTo(new BigDecimal("99.9")) > 0) {
            throw new IllegalArgumentException("Capacity는 99.9를 초과할 수 없습니다.");
        }
    }
}
