package com.timeline.controller;

import com.timeline.domain.entity.ProjectLink;
import com.timeline.domain.repository.ProjectLinkRepository;
import com.timeline.domain.repository.ProjectRepository;
import com.timeline.dto.ProjectDto;
import com.timeline.service.ProjectService;
import com.timeline.service.ScheduleCalculationService;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 프로젝트 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectRepository projectRepository;
    private final ProjectLinkRepository projectLinkRepository;

    private final ProjectService projectService;
    private final ScheduleCalculationService scheduleCalculationService;

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
     * 기존 프로젝트 유형 목록 조회 (datalist 자동완성용)
     */
    @GetMapping("/types")
    public ResponseEntity<?> getProjectTypes() {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", projectService.getProjectTypes()
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
     * 프로젝트 순서 변경
     */
    @PatchMapping("/{id}/sort-order")
    public ResponseEntity<?> updateSortOrder(@PathVariable Long id,
                                              @RequestBody Map<String, Object> body) {
        Object sortOrderObj = body.get("sortOrder");
        Integer sortOrder = (sortOrderObj != null) ? ((Number) sortOrderObj).intValue() : null;
        projectService.updateSortOrder(id, sortOrder);
        return ResponseEntity.ok(Map.of("success", true));
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

    // ---- 마일스톤 API ----

    @GetMapping("/{id}/milestones")
    public ResponseEntity<?> getMilestones(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", projectService.getMilestones(id)
        ));
    }

    @PostMapping("/{id}/milestones")
    public ResponseEntity<?> createMilestone(@PathVariable Long id,
                                              @RequestBody Map<String, Object> body) {
        var result = projectService.createMilestone(id, body);
        return ResponseEntity.ok(Map.of("success", true, "data", result));
    }

    @PutMapping("/{id}/milestones/{milestoneId}")
    public ResponseEntity<?> updateMilestone(@PathVariable Long id,
                                              @PathVariable Long milestoneId,
                                              @RequestBody Map<String, Object> body) {
        var result = projectService.updateMilestone(id, milestoneId, body);
        return ResponseEntity.ok(Map.of("success", true, "data", result));
    }

    @DeleteMapping("/{id}/milestones/{milestoneId}")
    public ResponseEntity<?> deleteMilestone(@PathVariable Long id,
                                              @PathVariable Long milestoneId) {
        projectService.deleteMilestone(id, milestoneId);
        return ResponseEntity.ok(Map.of("success", true));
    }

    // ---- 일정 계산 ----

    @PostMapping("/schedule-calculate")
    public ResponseEntity<?> calculateSchedule(@RequestBody Map<String, List<Long>> body) {
        try {
            List<Long> projectIds = body.get("projectIds");
            var result = scheduleCalculationService.calculateSchedule(projectIds);
            return ResponseEntity.ok(Map.of("success", true, "data", result));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        } catch (Exception e) {
            log.error("일정 계산 실패: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "일정 계산 중 오류가 발생했습니다."));
        }
    }

    // ---- 프로젝트 링크 ----

    @GetMapping("/{id}/links")
    public ResponseEntity<?> getProjectLinks(@PathVariable Long id) {
        var links = projectLinkRepository.findByProjectIdOrderByCreatedAtAsc(id);
        var data = links.stream().map(l -> Map.of(
                "id", l.getId(),
                "url", l.getUrl(),
                "label", l.getLabel()
        )).toList();
        return ResponseEntity.ok(Map.of("success", true, "data", data));
    }

    @PostMapping("/{id}/links")
    public ResponseEntity<?> addProjectLink(@PathVariable Long id,
                                             @RequestBody Map<String, String> body) {
        var project = projectRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다."));
        var link = ProjectLink.builder()
                .project(project)
                .url(body.get("url"))
                .label(body.get("label"))
                .build();
        projectLinkRepository.save(link);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PutMapping("/{id}/links/{linkId}")
    public ResponseEntity<?> updateProjectLink(@PathVariable Long id,
                                                @PathVariable Long linkId,
                                                @RequestBody Map<String, String> body) {
        var link = projectLinkRepository.findById(linkId)
                .orElseThrow(() -> new EntityNotFoundException("링크를 찾을 수 없습니다."));
        if (body.containsKey("label")) link.setLabel(body.get("label"));
        if (body.containsKey("url")) link.setUrl(body.get("url"));
        projectLinkRepository.save(link);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @DeleteMapping("/{id}/links/{linkId}")
    public ResponseEntity<?> deleteProjectLink(@PathVariable Long id,
                                                @PathVariable Long linkId) {
        projectLinkRepository.deleteById(linkId);
        return ResponseEntity.ok(Map.of("success", true));
    }
}
