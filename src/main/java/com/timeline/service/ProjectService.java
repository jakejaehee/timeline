package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.enums.MemberRole;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.repository.*;
import com.timeline.dto.DomainSystemDto;
import com.timeline.dto.MemberDto;
import com.timeline.dto.ProjectDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 프로젝트 CRUD + 멤버/도메인시스템 관리 서비스
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectDomainSystemRepository projectDomainSystemRepository;
    private final MemberRepository memberRepository;
    private final DomainSystemRepository domainSystemRepository;
    private final TaskRepository taskRepository;
    private final TaskDependencyRepository taskDependencyRepository;
    private final TaskLinkRepository taskLinkRepository;
    private final ProjectMilestoneRepository projectMilestoneRepository;

    /** CANCELLED 태스크는 expectedEndDate 계산에서 제외 */
    private static final List<TaskStatus> INACTIVE_STATUSES = List.of(TaskStatus.HOLD, TaskStatus.CANCELLED);

    /**
     * 전체 프로젝트 목록 조회 (expectedEndDate, isDelayed, memberCount 포함)
     * - 멤버 수를 일괄 조회하여 N+1 쿼리 방지
     */
    public List<ProjectDto.Response> getAllProjects() {
        // 멤버 수를 한 번에 조회 (N+1 방지)
        Map<Long, Long> memberCountMap = projectMemberRepository.countByProjectIdGrouped().stream()
                .collect(Collectors.toMap(
                        row -> (Long) row[0],
                        row -> (Long) row[1]
                ));

        // 프로젝트별 총 공수(MD) 합계 일괄 조회 (TODO, IN_PROGRESS만)
        List<TaskStatus> activeStatuses = List.of(TaskStatus.TODO, TaskStatus.IN_PROGRESS);
        Map<Long, BigDecimal> manDaysMap = taskRepository.sumManDaysByProjectGrouped(activeStatuses).stream()
                .collect(Collectors.toMap(
                        row -> (Long) row[0],
                        row -> (row[1] instanceof BigDecimal) ? (BigDecimal) row[1] : new BigDecimal(row[1].toString())
                ));

        // 프로젝트별 BE 멤버 수 일괄 조회
        Map<Long, Long> beCountMap = projectMemberRepository.countByProjectIdAndRoleGrouped(MemberRole.BE).stream()
                .collect(Collectors.toMap(
                        row -> (Long) row[0],
                        row -> (Long) row[1]
                ));

        // 프로젝트별 BE 캐파 합계 일괄 조회
        Map<Long, BigDecimal> beCapacityMap = projectMemberRepository.sumCapacityByProjectIdAndRoleGrouped(MemberRole.BE).stream()
                .collect(Collectors.toMap(
                        row -> (Long) row[0],
                        row -> (row[1] instanceof BigDecimal) ? (BigDecimal) row[1] : new BigDecimal(row[1].toString())
                ));

        // 프로젝트별 BE 멤버 목록 일괄 조회
        Map<Long, List<java.util.Map<String, Object>>> beMembersMap = new java.util.HashMap<>();
        projectMemberRepository.findAll().stream()
                .filter(pm -> pm.getMember().getRole() == MemberRole.BE && Boolean.TRUE.equals(pm.getMember().getActive()))
                .forEach(pm -> beMembersMap.computeIfAbsent(pm.getProject().getId(), k -> new java.util.ArrayList<>())
                        .add(java.util.Map.of("name", pm.getMember().getName(), "capacity", pm.getMember().getCapacity())));

        return projectRepository.findAllByOrderBySortOrderAscCreatedAtDesc().stream()
                .map(project -> {
                    LocalDate expectedEndDate = calculateExpectedEndDate(project.getId());
                    long memberCount = memberCountMap.getOrDefault(project.getId(), 0L);
                    BigDecimal taskManDays = manDaysMap.getOrDefault(project.getId(), BigDecimal.ZERO);
                    BigDecimal totalManDays = (project.getTotalManDaysOverride() != null) ? project.getTotalManDaysOverride() : taskManDays;
                    long beCount = beCountMap.getOrDefault(project.getId(), 0L);
                    BigDecimal beCapacity = beCapacityMap.getOrDefault(project.getId(), BigDecimal.ZERO);
                    BigDecimal estimatedDays = calculateEstimatedDays(totalManDays, beCapacity);
                    List<java.util.Map<String, Object>> beMembers = beMembersMap.getOrDefault(project.getId(), java.util.List.of());
                    return ProjectDto.Response.from(project, memberCount, expectedEndDate, totalManDays, beCount, estimatedDays, beMembers);
                })
                .collect(Collectors.toList());
    }

    /**
     * 프로젝트 상세 조회 (멤버, 도메인시스템, expectedEndDate, isDelayed 포함)
     */
    public ProjectDto.Response getProject(Long id) {
        Project project = findProjectById(id);

        List<MemberDto.Response> members = projectMemberRepository
                .findByProjectIdWithMember(id).stream()
                .map(pm -> MemberDto.Response.from(pm.getMember()))
                .collect(Collectors.toList());

        List<DomainSystemDto.Response> domainSystems = projectDomainSystemRepository
                .findByProjectIdWithDomainSystem(id).stream()
                .map(pds -> DomainSystemDto.Response.from(pds.getDomainSystem()))
                .collect(Collectors.toList());

        LocalDate expectedEndDate = calculateExpectedEndDate(id);

        return ProjectDto.Response.from(project, members, domainSystems, expectedEndDate);
    }

    /**
     * 프로젝트 생성
     */
    @Transactional
    public ProjectDto.Response createProject(ProjectDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("프로젝트명은 필수입니다.");
        }

        Project.ProjectBuilder builder = Project.builder()
                .name(request.getName())
                .projectType(normalizeProjectType(request.getProjectType()))
                .description(request.getDescription())
                .startDate(request.getStartDate())
                .endDate(request.getEndDate())
                .jiraBoardId(validateJiraBoardId(request.getJiraBoardId()))
                .jiraEpicKey(request.getJiraEpicKey())
                .totalManDaysOverride(request.getTotalManDaysOverride())
                .ppl(request.getPplId() != null ? memberRepository.findById(request.getPplId()).orElse(null) : null)
                .epl(request.getEplId() != null ? memberRepository.findById(request.getEplId()).orElse(null) : null)
                .quarter(request.getQuarter());

        // status가 null이면 @Builder.Default(PLANNING)가 적용됨
        if (request.getStatus() != null) {
            builder.status(request.getStatus());
        }

        Project saved = projectRepository.save(builder.build());
        log.info("프로젝트 생성 완료: id={}, name={}", saved.getId(), saved.getName());
        return ProjectDto.Response.from(saved);
    }

    /**
     * 프로젝트 수정
     */
    @Transactional
    public ProjectDto.Response updateProject(Long id, ProjectDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("프로젝트명은 필수입니다.");
        }

        Project project = findProjectById(id);

        project.setName(request.getName());
        project.setProjectType(normalizeProjectType(request.getProjectType()));
        project.setDescription(request.getDescription());
        project.setStartDate(request.getStartDate());
        project.setEndDate(request.getEndDate());
        project.setJiraBoardId(validateJiraBoardId(request.getJiraBoardId()));
        project.setJiraEpicKey(request.getJiraEpicKey());
        project.setTotalManDaysOverride(request.getTotalManDaysOverride());
        project.setPpl(request.getPplId() != null ? memberRepository.findById(request.getPplId()).orElse(null) : null);
        project.setEpl(request.getEplId() != null ? memberRepository.findById(request.getEplId()).orElse(null) : null);
        project.setQuarter(request.getQuarter());
        if (request.getStatus() != null) {
            project.setStatus(request.getStatus());
        }

        Project updated = projectRepository.save(project);
        log.info("프로젝트 수정 완료: id={}, name={}", updated.getId(), updated.getName());

        LocalDate expectedEndDate = calculateExpectedEndDate(id);
        return ProjectDto.Response.from(updated, null, null, expectedEndDate);
    }

    /**
     * 프로젝트 삭제
     */
    @Transactional
    public void deleteProject(Long id) {
        Project project = findProjectById(id);
        // 태스크 의존관계 및 링크 먼저 삭제 (FK 제약조건)
        List<Task> tasks = taskRepository.findByProjectId(id);
        for (Task task : tasks) {
            taskDependencyRepository.deleteByTaskId(task.getId());
            taskDependencyRepository.deleteByDependsOnTaskId(task.getId());
            taskLinkRepository.deleteByTaskId(task.getId());
        }
        // 태스크 삭제
        taskRepository.deleteByProjectId(id);
        // 연결 테이블 및 마일스톤 삭제
        projectMemberRepository.deleteByProjectId(id);
        projectDomainSystemRepository.deleteByProjectId(id);
        projectMilestoneRepository.deleteByProjectId(id);
        projectRepository.delete(project);
        log.info("프로젝트 삭제 완료: id={}, name={}", id, project.getName());
    }

    /**
     * 프로젝트 순서 변경
     */
    @Transactional
    public void updateSortOrder(Long id, Integer sortOrder) {
        Project project = findProjectById(id);
        project.setSortOrder(sortOrder);
        projectRepository.save(project);
        log.info("프로젝트 순서 변경: id={}, sortOrder={}", id, sortOrder);
    }

    /**
     * 프로젝트에 멤버 추가
     */
    @Transactional
    public void addMember(Long projectId, Long memberId) {
        Project project = findProjectById(projectId);
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + memberId));

        if (projectMemberRepository.existsByProjectIdAndMemberId(projectId, memberId)) {
            throw new IllegalStateException("이미 프로젝트에 등록된 멤버입니다. memberId=" + memberId);
        }

        ProjectMember projectMember = ProjectMember.builder()
                .project(project)
                .member(member)
                .build();

        projectMemberRepository.save(projectMember);
        log.info("프로젝트 멤버 추가: projectId={}, memberId={}", projectId, memberId);
    }

    /**
     * 프로젝트에서 멤버 제거
     */
    @Transactional
    public void removeMember(Long projectId, Long memberId) {
        findProjectById(projectId);
        ProjectMember projectMember = projectMemberRepository
                .findByProjectIdAndMemberId(projectId, memberId)
                .orElseThrow(() -> new EntityNotFoundException(
                        "프로젝트에 등록되지 않은 멤버입니다. projectId=" + projectId + ", memberId=" + memberId));
        projectMemberRepository.delete(projectMember);
        log.info("프로젝트 멤버 제거: projectId={}, memberId={}", projectId, memberId);
    }

    /**
     * 프로젝트에 도메인 시스템 추가
     */
    @Transactional
    public void addDomainSystem(Long projectId, Long domainSystemId) {
        Project project = findProjectById(projectId);
        DomainSystem domainSystem = domainSystemRepository.findById(domainSystemId)
                .orElseThrow(() -> new EntityNotFoundException("도메인 시스템을 찾을 수 없습니다. id=" + domainSystemId));

        if (projectDomainSystemRepository.existsByProjectIdAndDomainSystemId(projectId, domainSystemId)) {
            throw new IllegalStateException("이미 프로젝트에 등록된 도메인 시스템입니다. domainSystemId=" + domainSystemId);
        }

        ProjectDomainSystem pds = ProjectDomainSystem.builder()
                .project(project)
                .domainSystem(domainSystem)
                .build();

        projectDomainSystemRepository.save(pds);
        log.info("프로젝트 도메인 시스템 추가: projectId={}, domainSystemId={}", projectId, domainSystemId);
    }

    /**
     * 프로젝트에서 도메인 시스템 제거
     */
    @Transactional
    public void removeDomainSystem(Long projectId, Long domainSystemId) {
        findProjectById(projectId);
        ProjectDomainSystem pds = projectDomainSystemRepository
                .findByProjectIdAndDomainSystemId(projectId, domainSystemId)
                .orElseThrow(() -> new EntityNotFoundException(
                        "프로젝트에 등록되지 않은 도메인 시스템입니다. projectId=" + projectId + ", domainSystemId=" + domainSystemId));
        projectDomainSystemRepository.delete(pds);
        log.info("프로젝트 도메인 시스템 제거: projectId={}, domainSystemId={}", projectId, domainSystemId);
    }

    /**
     * 기존 프로젝트 유형 목록 조회 (중복 제거, null 제외, 정렬)
     */
    public List<String> getProjectTypes() {
        return projectRepository.findDistinctProjectTypes();
    }

    /**
     * projectType null 정규화: null/빈 문자열이면 null, 아니면 trim 처리 + 길이 검증 (DB column 100)
     */
    private String normalizeProjectType(String rawType) {
        if (rawType == null || rawType.isBlank()) {
            return null;
        }
        String trimmed = rawType.trim();
        if (trimmed.length() > 100) {
            throw new IllegalArgumentException("프로젝트 유형은 100자를 초과할 수 없습니다.");
        }
        return trimmed;
    }

    /**
     * Jira Board ID 검증: 숫자만 허용 (path injection 방지), DB column: VARCHAR(100)
     */
    private String validateJiraBoardId(String jiraBoardId) {
        if (jiraBoardId == null) return null;
        String trimmed = jiraBoardId.trim();
        if (trimmed.isEmpty()) return null;
        if (!trimmed.matches("^\\d+$")) {
            throw new IllegalArgumentException("Jira Board ID는 숫자만 허용됩니다.");
        }
        if (trimmed.length() > 100) {
            throw new IllegalArgumentException("Jira Board ID는 100자를 초과할 수 없습니다.");
        }
        return trimmed;
    }

    /**
     * ID로 프로젝트 조회 (내부용)
     */
    public Project findProjectById(Long id) {
        return projectRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + id));
    }

    /**
     * 프로젝트 내 모든 태스크의 최대 endDate 계산 (expectedEndDate)
     * - HOLD/CANCELLED 상태 태스크는 제외
     * - SEQUENTIAL/PARALLEL 무관
     */
    private LocalDate calculateExpectedEndDate(Long projectId) {
        return taskRepository.findMaxEndDateByProjectId(projectId, INACTIVE_STATUSES);
    }

    /**
     * 예상 소요 일수 = 총 공수(MD) / BE 캐파 합계
     * BE가 없거나 캐파가 0이면 null 반환
     */
    private BigDecimal calculateEstimatedDays(BigDecimal totalManDays, BigDecimal beCapacity) {
        if (totalManDays == null || totalManDays.compareTo(BigDecimal.ZERO) == 0) return null;
        if (beCapacity == null || beCapacity.compareTo(BigDecimal.ZERO) == 0) return null;
        return totalManDays.divide(beCapacity, 1, java.math.RoundingMode.CEILING);
    }

    // ---- 마일스톤 관리 ----

    public List<Map<String, Object>> getMilestones(Long projectId) {
        findProjectById(projectId);
        return projectMilestoneRepository.findByProjectIdOrderBySortOrderAscStartDateAsc(projectId).stream()
                .map(this::milestoneToMap)
                .collect(Collectors.toList());
    }

    @Transactional
    public Map<String, Object> createMilestone(Long projectId, Map<String, Object> body) {
        Project project = findProjectById(projectId);
        var builder = ProjectMilestone.builder()
                .project(project)
                .name((String) body.get("name"))
                .sortOrder(body.get("sortOrder") != null ? ((Number) body.get("sortOrder")).intValue() : null);
        if (body.get("type") != null && !((String) body.get("type")).isBlank()) {
            builder.type(com.timeline.domain.enums.MilestoneType.valueOf((String) body.get("type")));
        }
        if (body.get("days") != null) {
            builder.days(((Number) body.get("days")).intValue());
        }
        if (body.get("startDate") != null && !((String) body.get("startDate")).isBlank()) {
            builder.startDate(LocalDate.parse((String) body.get("startDate")));
        }
        if (body.get("endDate") != null && !((String) body.get("endDate")).isBlank()) {
            builder.endDate(LocalDate.parse((String) body.get("endDate")));
        }
        ProjectMilestone saved = projectMilestoneRepository.save(builder.build());
        log.info("마일스톤 생성: projectId={}, name={}", projectId, saved.getName());
        return milestoneToMap(saved);
    }

    @Transactional
    public Map<String, Object> updateMilestone(Long projectId, Long milestoneId, Map<String, Object> body) {
        ProjectMilestone milestone = projectMilestoneRepository.findById(milestoneId)
                .orElseThrow(() -> new EntityNotFoundException("마일스톤을 찾을 수 없습니다. id=" + milestoneId));
        if (body.containsKey("name")) milestone.setName((String) body.get("name"));
        if (body.containsKey("type")) {
            String typeStr = (String) body.get("type");
            milestone.setType(typeStr != null && !typeStr.isBlank() ? com.timeline.domain.enums.MilestoneType.valueOf(typeStr) : null);
        }
        if (body.containsKey("days")) {
            milestone.setDays(body.get("days") != null ? ((Number) body.get("days")).intValue() : null);
        }
        if (body.containsKey("startDate")) {
            String sd = (String) body.get("startDate");
            milestone.setStartDate(sd != null && !sd.isBlank() ? LocalDate.parse(sd) : null);
        }
        if (body.containsKey("endDate")) {
            String ed = (String) body.get("endDate");
            milestone.setEndDate(ed != null && !ed.isBlank() ? LocalDate.parse(ed) : null);
        }
        if (body.containsKey("sortOrder")) milestone.setSortOrder(body.get("sortOrder") != null ? ((Number) body.get("sortOrder")).intValue() : null);
        ProjectMilestone saved = projectMilestoneRepository.save(milestone);
        log.info("마일스톤 수정: id={}, name={}", milestoneId, saved.getName());
        return milestoneToMap(saved);
    }

    @Transactional
    public void deleteMilestone(Long projectId, Long milestoneId) {
        projectMilestoneRepository.deleteById(milestoneId);
        log.info("마일스톤 삭제: projectId={}, milestoneId={}", projectId, milestoneId);
    }

    private Map<String, Object> milestoneToMap(ProjectMilestone m) {
        var map = new java.util.LinkedHashMap<String, Object>();
        map.put("id", m.getId());
        map.put("name", m.getName());
        map.put("type", m.getType() != null ? m.getType().name() : null);
        map.put("startDate", m.getStartDate() != null ? m.getStartDate().toString() : null);
        map.put("endDate", m.getEndDate() != null ? m.getEndDate().toString() : null);
        map.put("days", m.getDays());
        map.put("sortOrder", m.getSortOrder() != null ? m.getSortOrder() : 0);
        return map;
    }
}
