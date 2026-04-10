package com.timeline.service;

import com.timeline.domain.entity.Member;
import com.timeline.domain.repository.MemberRepository;
import com.timeline.dto.MemberDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

        Member member = Member.builder()
                .name(request.getName())
                .role(request.getRole())
                .email(request.getEmail())
                .build();

        Member saved = memberRepository.save(member);
        log.info("멤버 생성 완료: id={}, name={}", saved.getId(), saved.getName());
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

        Member updated = memberRepository.save(member);
        log.info("멤버 수정 완료: id={}, name={}", updated.getId(), updated.getName());
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
     * ID로 멤버 조회 (내부용)
     */
    public Member findMemberById(Long id) {
        return memberRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + id));
    }
}
