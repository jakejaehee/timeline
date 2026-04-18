package com.timeline.controller;

import com.timeline.dto.SquadDto;
import com.timeline.service.SquadService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 스쿼드 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/squads")
@RequiredArgsConstructor
public class SquadController {

    private final SquadService squadService;

    /**
     * 전체 스쿼드 목록 조회
     */
    @GetMapping
    public ResponseEntity<?> getAllSquads() {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", squadService.getAllSquads()
        ));
    }

    /**
     * 스쿼드 상세 조회 (멤버 포함)
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getSquad(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", squadService.getSquad(id)
        ));
    }

    /**
     * 스쿼드 생성
     */
    @PostMapping
    public ResponseEntity<?> createSquad(@RequestBody SquadDto.Request request) {
        SquadDto.Response created = squadService.createSquad(request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 스쿼드 수정
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updateSquad(@PathVariable Long id,
                                                @RequestBody SquadDto.Request request) {
        SquadDto.Response updated = squadService.updateSquad(id, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", updated
        ));
    }

    /**
     * 스쿼드 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteSquad(@PathVariable Long id) {
        squadService.deleteSquad(id);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    // ---- 스쿼드 멤버 관리 ----

    /**
     * 스쿼드 멤버 목록 조회
     */
    @GetMapping("/{id}/members")
    public ResponseEntity<?> getMembers(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", squadService.getMembers(id)
        ));
    }

    /**
     * 스쿼드에 멤버 추가
     */
    @PostMapping("/{id}/members")
    public ResponseEntity<?> addMember(@PathVariable Long id,
                                       @RequestBody SquadDto.AddMemberRequest request) {
        squadService.addMember(id, request.getMemberId());
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 스쿼드에서 멤버 제거
     */
    @DeleteMapping("/{id}/members/{memberId}")
    public ResponseEntity<?> removeMember(@PathVariable Long id,
                                          @PathVariable Long memberId) {
        squadService.removeMember(id, memberId);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }
}
