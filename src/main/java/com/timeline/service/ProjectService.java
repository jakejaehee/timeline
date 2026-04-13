package com.timeline.service;

import com.timeline.domain.entity.*;
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

        return projectRepository.findAllByOrderBySortOrderAscCreatedAtDesc().stream()
                .map(project -> {
                    LocalDate expectedEndDate = calculateExpectedEndDate(project.getId());
                    long memberCount = memberCountMap.getOrDefault(project.getId(), 0L);
                    return ProjectDto.Response.from(project, memberCount, expectedEndDate);
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
                .jiraBoardId(validateJiraBoardId(request.getJiraBoardId()));

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
        ProjectMilestone milestone = ProjectMilestone.builder()
                .project(project)
                .name((String) body.get("name"))
                .startDate(LocalDate.parse((String) body.get("startDate")))
                .endDate(LocalDate.parse((String) body.get("endDate")))
                .sortOrder(body.get("sortOrder") != null ? ((Number) body.get("sortOrder")).intValue() : null)
                .build();
        ProjectMilestone saved = projectMilestoneRepository.save(milestone);
        log.info("마일스톤 생성: projectId={}, name={}", projectId, saved.getName());
        return milestoneToMap(saved);
    }

    @Transactional
    public Map<String, Object> updateMilestone(Long projectId, Long milestoneId, Map<String, Object> body) {
        ProjectMilestone milestone = projectMilestoneRepository.findById(milestoneId)
                .orElseThrow(() -> new EntityNotFoundException("마일스톤을 찾을 수 없습니다. id=" + milestoneId));
        if (body.containsKey("name")) milestone.setName((String) body.get("name"));
        if (body.containsKey("startDate")) milestone.setStartDate(LocalDate.parse((String) body.get("startDate")));
        if (body.containsKey("endDate")) milestone.setEndDate(LocalDate.parse((String) body.get("endDate")));
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
        return Map.of(
                "id", m.getId(),
                "name", m.getName(),
                "startDate", m.getStartDate().toString(),
                "endDate", m.getEndDate().toString(),
                "sortOrder", m.getSortOrder() != null ? m.getSortOrder() : 0
        );
    }
}
