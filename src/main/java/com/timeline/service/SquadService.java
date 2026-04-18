package com.timeline.service;

import com.timeline.domain.entity.Member;
import com.timeline.domain.entity.Squad;
import com.timeline.domain.entity.SquadMember;
import com.timeline.domain.repository.*;;
import com.timeline.dto.MemberDto;
import com.timeline.dto.SquadDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 스쿼드 CRUD + 멤버 관리 서비스
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SquadService {

    private final SquadRepository squadRepository;
    private final SquadMemberRepository squadMemberRepository;
    private final MemberRepository memberRepository;
    private final ProjectSquadRepository projectSquadRepository;
    private final TaskRepository taskRepository;

    /**
     * 전체 스쿼드 목록 조회
     */
    public List<SquadDto.Response> getAllSquads() {
        return squadRepository.findAllByOrderByNameAsc().stream()
                .map(SquadDto.Response::from)
                .collect(Collectors.toList());
    }

    /**
     * 스쿼드 상세 조회 (멤버 포함)
     */
    public SquadDto.Response getSquad(Long id) {
        Squad squad = findSquadById(id);
        List<MemberDto.Response> members = squadMemberRepository.findBySquadIdWithMember(id).stream()
                .map(sm -> MemberDto.Response.from(sm.getMember()))
                .collect(Collectors.toList());
        return SquadDto.Response.from(squad, members);
    }

    /**
     * 스쿼드 생성
     */
    @Transactional
    public SquadDto.Response createSquad(SquadDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("스쿼드 이름은 필수입니다.");
        }

        if (squadRepository.existsByName(request.getName())) {
            throw new IllegalArgumentException("이미 존재하는 스쿼드 이름입니다: " + request.getName());
        }

        validateColor(request.getColor());

        Squad squad = Squad.builder()
                .name(request.getName())
                .description(request.getDescription())
                .color(request.getColor())
                .build();

        Squad saved = squadRepository.save(squad);
        log.info("스쿼드 생성 완료: id={}, name={}", saved.getId(), saved.getName());
        return SquadDto.Response.from(saved);
    }

    /**
     * 스쿼드 수정
     */
    @Transactional
    public SquadDto.Response updateSquad(Long id, SquadDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("스쿼드 이름은 필수입니다.");
        }

        Squad squad = findSquadById(id);

        // 이름 변경 시 중복 체크
        if (!squad.getName().equals(request.getName())
                && squadRepository.existsByName(request.getName())) {
            throw new IllegalArgumentException("이미 존재하는 스쿼드 이름입니다: " + request.getName());
        }

        validateColor(request.getColor());

        squad.setName(request.getName());
        squad.setDescription(request.getDescription());
        squad.setColor(request.getColor());

        Squad updated = squadRepository.save(squad);
        log.info("스쿼드 수정 완료: id={}, name={}", updated.getId(), updated.getName());
        return SquadDto.Response.from(updated);
    }

    /**
     * 스쿼드 삭제
     */
    @Transactional
    public void deleteSquad(Long id) {
        Squad squad = findSquadById(id);
        taskRepository.nullifySquadId(id);
        projectSquadRepository.deleteBySquadId(id);
        squadMemberRepository.deleteBySquadId(id);
        squadRepository.delete(squad);
        log.info("스쿼드 삭제 완료: id={}, name={}", id, squad.getName());
    }

    // ---- 스쿼드 멤버 관리 ----

    /**
     * 스쿼드에 멤버 추가
     */
    @Transactional
    public void addMember(Long squadId, Long memberId) {
        Squad squad = findSquadById(squadId);
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + memberId));

        if (squadMemberRepository.existsBySquadIdAndMemberId(squadId, memberId)) {
            throw new IllegalStateException("이미 스쿼드에 등록된 멤버입니다. memberId=" + memberId);
        }

        SquadMember sm = SquadMember.builder()
                .squad(squad)
                .member(member)
                .build();

        squadMemberRepository.save(sm);
        log.info("스쿼드 멤버 추가: squadId={}, memberId={}", squadId, memberId);
    }

    /**
     * 스쿼드에서 멤버 제거
     */
    @Transactional
    public void removeMember(Long squadId, Long memberId) {
        findSquadById(squadId);
        SquadMember sm = squadMemberRepository.findBySquadIdAndMemberId(squadId, memberId)
                .orElseThrow(() -> new EntityNotFoundException(
                        "스쿼드에 등록되지 않은 멤버입니다. squadId=" + squadId + ", memberId=" + memberId));
        squadMemberRepository.delete(sm);
        log.info("스쿼드 멤버 제거: squadId={}, memberId={}", squadId, memberId);
    }

    /**
     * 스쿼드 멤버 목록 조회
     */
    public List<MemberDto.Response> getMembers(Long squadId) {
        findSquadById(squadId);
        return squadMemberRepository.findBySquadIdWithMember(squadId).stream()
                .map(sm -> MemberDto.Response.from(sm.getMember()))
                .collect(Collectors.toList());
    }

    /**
     * ID로 스쿼드 조회 (내부용)
     */
    public Squad findSquadById(Long id) {
        return squadRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("스쿼드를 찾을 수 없습니다. id=" + id));
    }

    /**
     * 색상 코드 유효성 검증 (#RRGGBB 형식)
     */
    private void validateColor(String color) {
        if (color != null && !color.isEmpty()) {
            if (!color.matches("^#[0-9a-fA-F]{6}$")) {
                throw new IllegalArgumentException("올바른 색상 코드 형식이 아닙니다 (예: #4A90D9): " + color);
            }
        }
    }
}
