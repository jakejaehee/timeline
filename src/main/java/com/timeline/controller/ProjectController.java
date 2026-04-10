package com.timeline.controller;

import com.timeline.dto.ProjectDto;
import com.timeline.service.ProjectService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 프로젝트 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;

    /**
     * 전체 프로젝트 목록 조회
     */
    @GetMapping
    public ResponseEntity<?> getAllProjects() {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", projectService.getAllProjects()
        ));
    }

    /**
     * 프로젝트 상세 조회 (멤버, 도메인시스템 포함)
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getProject(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", projectService.getProject(id)
        ));
    }

    /**
     * 프로젝트 생성
     */
    @PostMapping
    public ResponseEntity<?> createProject(@RequestBody ProjectDto.Request request) {
        ProjectDto.Response created = projectService.createProject(request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 프로젝트 수정
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updateProject(@PathVariable Long id,
                                           @RequestBody ProjectDto.Request request) {
        ProjectDto.Response updated = projectService.updateProject(id, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", updated
        ));
    }

    /**
     * 프로젝트 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteProject(@PathVariable Long id) {
        projectService.deleteProject(id);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 프로젝트에 멤버 추가
     */
    @PostMapping("/{id}/members")
    public ResponseEntity<?> addMember(@PathVariable Long id,
                                       @RequestBody ProjectDto.AddMemberRequest request) {
        projectService.addMember(id, request.getMemberId());
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 프로젝트에서 멤버 제거
     */
    @DeleteMapping("/{id}/members/{memberId}")
    public ResponseEntity<?> removeMember(@PathVariable Long id,
                                          @PathVariable Long memberId) {
        projectService.removeMember(id, memberId);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 프로젝트에 도메인 시스템 추가
     */
    @PostMapping("/{id}/domain-systems")
    public ResponseEntity<?> addDomainSystem(@PathVariable Long id,
                                             @RequestBody ProjectDto.AddDomainSystemRequest request) {
        projectService.addDomainSystem(id, request.getDomainSystemId());
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 프로젝트에서 도메인 시스템 제거
     */
    @DeleteMapping("/{id}/domain-systems/{domainSystemId}")
    public ResponseEntity<?> removeDomainSystem(@PathVariable Long id,
                                                @PathVariable Long domainSystemId) {
        projectService.removeDomainSystem(id, domainSystemId);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }
}
