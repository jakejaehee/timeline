package com.timeline.controller;

import com.timeline.dto.MemberDto;
import com.timeline.dto.MemberLeaveDto;
import com.timeline.dto.TeamBoardDto;
import com.timeline.service.MemberLeaveService;
import com.timeline.service.MemberService;
import com.timeline.service.TaskService;
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
    private final MemberLeaveService memberLeaveService;
    private final TaskService taskService;

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

    /**
     * 담당자 큐 착수일 변경
     */
    @PatchMapping("/{id}/queue-start-date")
    public ResponseEntity<?> updateQueueStartDate(@PathVariable Long id,
                                                   @RequestBody Map<String, String> body) {
        String dateStr = body.get("queueStartDate");
        memberService.updateQueueStartDate(id, dateStr);
        taskService.recalculateQueueDates(id);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    // ---- 개인 휴무 API ----

    /**
     * 특정 멤버의 개인 휴무 목록 조회
     */
    @GetMapping("/{id}/leaves")
    public ResponseEntity<?> getMemberLeaves(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", memberLeaveService.getMemberLeaves(id)
        ));
    }

    /**
     * 개인 휴무 등록
     */
    @PostMapping("/{id}/leaves")
    public ResponseEntity<?> createMemberLeave(@PathVariable Long id,
                                                @RequestBody MemberLeaveDto.Request request) {
        MemberLeaveDto.Response created = memberLeaveService.createMemberLeave(id, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 개인 휴무 삭제
     */
    @DeleteMapping("/{id}/leaves/{leaveId}")
    public ResponseEntity<?> deleteMemberLeave(@PathVariable Long id,
                                                @PathVariable Long leaveId) {
        memberLeaveService.deleteMemberLeave(id, leaveId);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }
}
