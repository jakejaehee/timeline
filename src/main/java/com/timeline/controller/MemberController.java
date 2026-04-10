package com.timeline.controller;

import com.timeline.dto.MemberDto;
import com.timeline.dto.TeamBoardDto;
import com.timeline.service.MemberService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 멤버 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/members")
@RequiredArgsConstructor
public class MemberController {

    private final MemberService memberService;

    /**
     * 전체 멤버 목록 조회
     */
    @GetMapping
    public ResponseEntity<?> getAllMembers() {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", memberService.getAllMembers()
        ));
    }

    /**
     * 멤버 상세 조회
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getMember(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", memberService.getMember(id)
        ));
    }

    /**
     * 멤버 생성
     */
    @PostMapping
    public ResponseEntity<?> createMember(@RequestBody MemberDto.Request request) {
        MemberDto.Response created = memberService.createMember(request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 멤버 수정
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updateMember(@PathVariable Long id,
                                          @RequestBody MemberDto.Request request) {
        MemberDto.Response updated = memberService.updateMember(id, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", updated
        ));
    }

    /**
     * 멤버 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteMember(@PathVariable Long id) {
        memberService.deleteMember(id);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 특정 멤버의 배정 태스크 목록 조회
     */
    @GetMapping("/{id}/tasks")
    public ResponseEntity<?> getMemberTasks(@PathVariable Long id) {
        List<TeamBoardDto.TaskItem> taskItems = memberService.getMemberTasks(id);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", taskItems
        ));
    }
}
