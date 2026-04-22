package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.enums.MemberRole;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.repository.*;
import com.timeline.dto.SquadDto;
import com.timeline.dto.MemberDto;
import com.timeline.dto.ProjectDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 프로젝트 CRUD + 멤버/스쿼드 관리 서비스
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectSquadRepository projectSquadRepository;
    private final MemberRepository memberRepository;
    private final SquadRepository squadRepository;
    private final TaskRepository taskRepository;
    private final TaskDependencyRepository taskDependencyRepository;
    private final TaskLinkRepository taskLinkRepository;
    private final ProjectLinkRepository projectLinkRepository;
    private final ProjectMilestoneRepository projectMilestoneRepository;
    private final BusinessDayCalculator bizDayCalc;
    private final HolidayService holidayService;

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

        // 프로젝트별 전체 멤버 목록 일괄 조회 (툴팁용)
        Map<Long, List<java.util.Map<String, Object>>> allMembersMap = new java.util.HashMap<>();
        Map<Long, List<java.util.Map<String, Object>>> beMembersMap = new java.util.HashMap<>();
        projectMemberRepository.findAll().stream()
                .filter(pm -> Boolean.TRUE.equals(pm.getMember().getActive()))
                .forEach(pm -> {
                    var memberInfo = java.util.Map.<String, Object>of(
                            "name", pm.getMember().getName(),
                            "role", pm.getMember().getRole().name(),
                            "capacity", pm.getMember().getCapacity());
                    allMembersMap.computeIfAbsent(pm.getProject().getId(), k -> new java.util.ArrayList<>()).add(memberInfo);
                    if (pm.getMember().getRole() == MemberRole.BE) {
                        beMembersMap.computeIfAbsent(pm.getProject().getId(), k -> new java.util.ArrayList<>())
                                .add(java.util.Map.of("name", pm.getMember().getName(), "capacity", pm.getMember().getCapacity()));
                    }
                });

        // 프로젝트별 스쿼드 목록 일괄 조회
        Map<Long, List<SquadDto.Response>> squadsMap = new java.util.HashMap<>();
        projectSquadRepository.findAll().stream()
                .forEach(ps -> squadsMap.computeIfAbsent(ps.getProject().getId(), k -> new java.util.ArrayList<>())
                        .add(SquadDto.Response.from(ps.getSquad())));

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
                    List<SquadDto.Response> squads = squadsMap.getOrDefault(project.getId(), java.util.List.of());
                    List<java.util.Map<String, Object>> allMembersList = allMembersMap.getOrDefault(project.getId(), java.util.List.of());
                    return ProjectDto.Response.from(project, memberCount, expectedEndDate, totalManDays, beCount, estimatedDays, beMembers, squads, allMembersList);
                })
                .collect(Collectors.toList());
    }

    /**
     * 프로젝트 상세 조회 (멤버, 스쿼드, expectedEndDate, isDelayed 포함)
     */
    public ProjectDto.Response getProject(Long id) {
        Project project = findProjectById(id);

        List<MemberDto.Response> members = projectMemberRepository
                .findByProjectIdWithMember(id).stream()
                .map(pm -> MemberDto.Response.from(pm.getMember()))
                .collect(Collectors.toList());

        List<SquadDto.Response> squads = projectSquadRepository
                .findByProjectIdWithSquad(id).stream()
                .map(ps -> SquadDto.Response.from(ps.getSquad()))
                .collect(Collectors.toList());

        LocalDate expectedEndDate = calculateExpectedEndDate(id);

        return ProjectDto.Response.from(project, members, squads, expectedEndDate);
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
                .description(request.getDescription())
                .startDate(request.getStartDate())
                .endDate(request.getEndDate())
                .jiraBoardId(validateJiraBoardId(request.getJiraBoardId()))
                .jiraEpicKey(request.getJiraEpicKey())
                .totalManDaysOverride(request.getTotalManDaysOverride())
                .ppl(request.getPplId() != null ? memberRepository.findById(request.getPplId()).orElse(null) : null)
                .epl(request.getEplId() != null ? memberRepository.findById(request.getEplId()).orElse(null) : null)
                .quarter(request.getQuarter())
                .ktlo(Boolean.TRUE.equals(request.getKtlo()));

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
        project.setDescription(request.getDescription());
        project.setStartDate(request.getStartDate());
        project.setEndDate(request.getEndDate());
        project.setJiraBoardId(validateJiraBoardId(request.getJiraBoardId()));
        project.setJiraEpicKey(request.getJiraEpicKey());
        project.setTotalManDaysOverride(request.getTotalManDaysOverride());
        project.setPpl(request.getPplId() != null ? memberRepository.findById(request.getPplId()).orElse(null) : null);
        project.setEpl(request.getEplId() != null ? memberRepository.findById(request.getEplId()).orElse(null) : null);
        project.setQuarter(request.getQuarter());
        project.setKtlo(Boolean.TRUE.equals(request.getKtlo()));
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
        // 연결 테이블, 마일스톤, 링크 삭제
        projectMemberRepository.deleteByProjectId(id);
        projectSquadRepository.deleteByProjectId(id);
        projectMilestoneRepository.deleteByProjectId(id);
        projectLinkRepository.deleteByProjectId(id);
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
     * 프로젝트에 스쿼드 추가
     */
    @Transactional
    public void addSquad(Long projectId, Long squadId) {
        Project project = findProjectById(projectId);
        Squad squad = squadRepository.findById(squadId)
                .orElseThrow(() -> new EntityNotFoundException("스쿼드를 찾을 수 없습니다. id=" + squadId));

        if (projectSquadRepository.existsByProjectIdAndSquadId(projectId, squadId)) {
            throw new IllegalStateException("이미 프로젝트에 등록된 스쿼드입니다. squadId=" + squadId);
        }

        ProjectSquad ps = ProjectSquad.builder()
                .project(project)
                .squad(squad)
                .build();

        projectSquadRepository.save(ps);
        log.info("프로젝트 스쿼드 추가: projectId={}, squadId={}", projectId, squadId);
    }

    /**
     * 프로젝트에서 스쿼드 제거
     */
    @Transactional
    public void removeSquad(Long projectId, Long squadId) {
        findProjectById(projectId);
        ProjectSquad ps = projectSquadRepository
                .findByProjectIdAndSquadId(projectId, squadId)
                .orElseThrow(() -> new EntityNotFoundException(
                        "프로젝트에 등록되지 않은 스쿼드입니다. projectId=" + projectId + ", squadId=" + squadId));
        projectSquadRepository.delete(ps);
        log.info("프로젝트 스쿼드 제거: projectId={}, squadId={}", projectId, squadId);
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
        Project project = findProjectById(projectId);
        List<ProjectMilestone> milestones = projectMilestoneRepository.findByProjectIdOrderBySortOrderAscStartDateAsc(projectId);

        // 공휴일 로드 (QA 날짜 역산에 사용)
        LocalDate rangeStart = LocalDate.now().minusMonths(1);
        LocalDate rangeEnd = LocalDate.now().plusYears(2);
        Set<LocalDate> holidays = holidayService.getHolidayDatesBetween(rangeStart, rangeEnd);

        List<Map<String, Object>> result = new java.util.ArrayList<>();
        for (int i = 0; i < milestones.size(); i++) {
            ProjectMilestone ms = milestones.get(i);
            var map = milestoneToMap(ms);
            // QA 유형: 론치일(project.endDate)과 QA 일수(days) 기준으로 역산
            if (ms.getType() == com.timeline.domain.enums.MilestoneType.QA && ms.getDays() != null) {
                LocalDate launchDate = project.getEndDate();
                if (launchDate != null) {
                    Set<LocalDate> qaUnavailable = new HashSet<>(holidays);
                    // QA 종료일: 론치일 - 1 영업일
                    LocalDate qaEnd = subtractBusinessDays(launchDate, 1, qaUnavailable);
                    // QA 시작일: QA 종료일에서 (days - 1) 영업일 역산
                    LocalDate qaStart = subtractBusinessDays(qaEnd, ms.getDays() - 1, qaUnavailable);
                    map.put("startDate", qaStart.toString());
                    map.put("endDate", qaEnd.toString());
                }
            }
            result.add(map);
        }
        return result;
    }

    private LocalDate subtractBusinessDays(LocalDate from, int days, Set<LocalDate> unavailable) {
        LocalDate d = from;
        while (days > 0) {
            d = d.minusDays(1);
            if (bizDayCalc.isBusinessDay(d, unavailable)) {
                days--;
            }
        }
        return d;
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
        // QA 유형이면 시작일/종료일을 null로 강제 (일정 계산 엔진이 자동 산출)
        boolean isQa = "QA".equals(body.get("type"));
        if (!isQa) {
            if (body.get("startDate") != null && !((String) body.get("startDate")).isBlank()) {
                try {
                    builder.startDate(LocalDate.parse((String) body.get("startDate")));
                } catch (java.time.format.DateTimeParseException e) {
                    throw new IllegalArgumentException("올바른 시작일 형식이 아닙니다: " + body.get("startDate"));
                }
            }
            if (body.get("endDate") != null && !((String) body.get("endDate")).isBlank()) {
                try {
                    builder.endDate(LocalDate.parse((String) body.get("endDate")));
                } catch (java.time.format.DateTimeParseException e) {
                    throw new IllegalArgumentException("올바른 종료일 형식이 아닙니다: " + body.get("endDate"));
                }
            }
        }
        if (body.containsKey("qaAssignees")) {
            builder.qaAssignees(body.get("qaAssignees") != null ? ((String) body.get("qaAssignees")).trim() : null);
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
        // QA 유형이면 시작일/종료일을 항상 null로 강제 (일정 계산 엔진이 자동 산출)
        boolean isQa = milestone.getType() == com.timeline.domain.enums.MilestoneType.QA;
        if (isQa) {
            milestone.setStartDate(null);
            milestone.setEndDate(null);
        } else {
            if (body.containsKey("startDate")) {
                String sd = (String) body.get("startDate");
                try {
                    milestone.setStartDate(sd != null && !sd.isBlank() ? LocalDate.parse(sd) : null);
                } catch (java.time.format.DateTimeParseException e) {
                    throw new IllegalArgumentException("올바른 시작일 형식이 아닙니다: " + sd);
                }
            }
            if (body.containsKey("endDate")) {
                String ed = (String) body.get("endDate");
                try {
                    milestone.setEndDate(ed != null && !ed.isBlank() ? LocalDate.parse(ed) : null);
                } catch (java.time.format.DateTimeParseException e) {
                    throw new IllegalArgumentException("올바른 종료일 형식이 아닙니다: " + ed);
                }
            }
        }
        if (body.containsKey("sortOrder")) milestone.setSortOrder(body.get("sortOrder") != null ? ((Number) body.get("sortOrder")).intValue() : null);
        if (body.containsKey("qaAssignees")) {
            milestone.setQaAssignees(body.get("qaAssignees") != null ? ((String) body.get("qaAssignees")).trim() : null);
        }
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
        map.put("qaAssignees", m.getQaAssignees());
        map.put("sortOrder", m.getSortOrder() != null ? m.getSortOrder() : 0);
        return map;
    }
}
