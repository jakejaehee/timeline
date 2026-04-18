package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.repository.*;
import com.timeline.dto.GanttDataDto;
import com.timeline.dto.TaskDto;
import com.timeline.exception.AssigneeConflictException;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 태스크 CRUD + 의존관계 + 간트차트 데이터 + 담당자 충돌 검증 + 링크 관리 + 자동 날짜 계산 서비스
 * Phase 1: capacity, Same-Day Rule, 담당자 전역 큐, Hold/Cancelled 제외 반영
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TaskService {

    private final TaskRepository taskRepository;
    private final TaskDependencyRepository taskDependencyRepository;
    private final TaskLinkRepository taskLinkRepository;
    private final ProjectRepository projectRepository;
    private final SquadRepository squadRepository;
    private final MemberRepository memberRepository;
    private final ProjectMilestoneRepository projectMilestoneRepository;
    private final BusinessDayCalculator businessDayCalculator;
    private final HolidayService holidayService;
    private final MemberLeaveService memberLeaveService;

    /** Hold/Cancelled 상태 목록 (스케줄링 제외용) */
    private static final List<TaskStatus> INACTIVE_STATUSES = List.of(TaskStatus.HOLD, TaskStatus.CANCELLED);

    /** 일정 충돌 검증에서 제외할 상태 목록 (HOLD, CANCELLED, COMPLETED) */
    private static final List<TaskStatus> CONFLICT_EXCLUDE_STATUSES = List.of(
            TaskStatus.HOLD, TaskStatus.CANCELLED, TaskStatus.COMPLETED
    );

    /** 배치 삭제 chunk 크기 */
    private static final int DELETE_CHUNK_SIZE = 100;

    /**
     * 간트차트용 프로젝트 태스크 조회 (스쿼드별 그룹핑)
     */
    public GanttDataDto.Response getGanttData(Long projectId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + projectId));

        // 태스크 조회 (JOIN FETCH로 N+1 방지)
        List<Task> tasks = taskRepository.findByProjectIdWithDetails(projectId);

        // 의존관계 조회
        List<TaskDependency> allDependencies = taskDependencyRepository.findByProjectIdWithDetails(projectId);

        // 태스크별 의존관계 ID 맵 생성
        Map<Long, List<Long>> dependencyMap = allDependencies.stream()
                .collect(Collectors.groupingBy(
                        td -> td.getTask().getId(),
                        Collectors.mapping(td -> td.getDependsOnTask().getId(), Collectors.toList())
                ));

        // 스쿼드별 그룹핑 (LinkedHashMap으로 순서 유지, null은 0L 키)
        Map<Long, List<Task>> groupedBySquad = new LinkedHashMap<>();
        for (Task task : tasks) {
            Long dsId = (task.getSquad() != null) ? task.getSquad().getId() : 0L;
            groupedBySquad
                    .computeIfAbsent(dsId, k -> new ArrayList<>())
                    .add(task);
        }

        // GanttDataDto 변환
        List<GanttDataDto.SquadGroup> squadGroups = groupedBySquad.entrySet().stream()
                .map(entry -> {
                    Task firstTask = entry.getValue().get(0);
                    Squad ds = firstTask.getSquad();

                    List<GanttDataDto.TaskItem> taskItems = entry.getValue().stream()
                            .map(task -> GanttDataDto.TaskItem.builder()
                                    .id(task.getId())
                                    .name(task.getName())
                                    .assignee(task.getAssignee() != null
                                            ? GanttDataDto.AssigneeSummary.builder()
                                                    .id(task.getAssignee().getId())
                                                    .name(task.getAssignee().getName())
                                                    .role(task.getAssignee().getRole())
                                                    .queueStartDate(task.getAssignee().getQueueStartDate())
                                                    .build()
                                            : null)
                                    .startDate(task.getStartDate())
                                    .endDate(task.getEndDate())
                                    .manDays(task.getManDays())
                                    .status(task.getStatus())
                                    .sortOrder(task.getSortOrder())
                                    .dependencies(dependencyMap.getOrDefault(task.getId(), List.of()))
                                    .executionMode(task.getExecutionMode())
                                    .priority(task.getPriority())
                                    .type(task.getType())
                                    .actualEndDate(task.getActualEndDate())
                                    .assigneeOrder(task.getAssigneeOrder())
                                    .jiraKey(task.getJiraKey())
                                    .build())
                            .collect(Collectors.toList());

                    return GanttDataDto.SquadGroup.builder()
                            .id(ds != null ? ds.getId() : 0L)
                            .name(ds != null ? ds.getName() : "미지정")
                            .color(ds != null ? ds.getColor() : "#9E9E9E")
                            .tasks(taskItems)
                            .build();
                })
                .collect(Collectors.toList());

        // 마일스톤 조회
        List<GanttDataDto.MilestoneItem> milestoneItems = projectMilestoneRepository
                .findByProjectIdOrderBySortOrderAscStartDateAsc(projectId).stream()
                .map(m -> GanttDataDto.MilestoneItem.builder()
                        .id(m.getId())
                        .name(m.getName())
                        .startDate(m.getStartDate())
                        .endDate(m.getEndDate())
                        .sortOrder(m.getSortOrder())
                        .build())
                .collect(Collectors.toList());

        return GanttDataDto.Response.builder()
                .project(GanttDataDto.ProjectSummary.builder()
                        .id(project.getId())
                        .name(project.getName())
                        .startDate(project.getStartDate())
                        .endDate(project.getEndDate())
                        .build())
                .milestones(milestoneItems)
                .squads(squadGroups)
                .build();
    }

    /**
     * 태스크 상세 조회 (링크 포함)
     */
    public TaskDto.Response getTask(Long taskId) {
        Task task = taskRepository.findByIdWithDetails(taskId)
                .orElseThrow(() -> new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId));

        List<TaskDependency> deps = taskDependencyRepository.findByTaskIdWithDependsOnTask(taskId);
        List<Long> dependencies = deps.stream()
                .map(td -> td.getDependsOnTask().getId())
                .collect(Collectors.toList());
        List<TaskDto.DependencyInfo> dependencyTasks = deps.stream()
                .map(td -> TaskDto.DependencyInfo.builder()
                        .id(td.getDependsOnTask().getId())
                        .name(td.getDependsOnTask().getName())
                        .build())
                .collect(Collectors.toList());

        List<TaskLink> links = taskLinkRepository.findByTaskIdOrderByCreatedAtAsc(taskId);

        TaskDto.Response response = TaskDto.Response.from(task, dependencies, links);
        response.setDependencyTasks(dependencyTasks);
        return response;
    }

    /**
     * 태스크 생성
     * - SEQUENTIAL 모드: 자동 날짜 계산 (startDate null이면 자동 계산, endDate 항상 자동 계산)
     * - PARALLEL 모드: 기존 방식 (startDate, endDate 직접 입력)
     * - capacity, Same-Day Rule, Hold/Cancelled 제외, 전역 큐 반영
     */
    @Transactional
    public TaskDto.Response createTask(Long projectId, TaskDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("태스크명은 필수입니다.");
        }
        if (request.getName().length() > 300) {
            throw new IllegalArgumentException("태스크명은 300자를 초과할 수 없습니다.");
        }
        // 실행 모드 결정 (null이면 SEQUENTIAL 기본값)
        TaskExecutionMode executionMode = request.getExecutionMode() != null
                ? request.getExecutionMode() : TaskExecutionMode.SEQUENTIAL;

        LocalDate startDate = request.getStartDate();
        LocalDate endDate = request.getEndDate();

        // 담당자 조회 (capacity 필요)
        Member assignee = null;
        BigDecimal capacity = BigDecimal.ONE;
        if (request.getAssigneeId() != null) {
            assignee = memberRepository.findById(request.getAssigneeId())
                    .orElseThrow(() -> new EntityNotFoundException(
                            "멤버를 찾을 수 없습니다. id=" + request.getAssigneeId()));
            capacity = assignee.getCapacity() != null ? assignee.getCapacity() : BigDecimal.ONE;
        }

        if (executionMode == TaskExecutionMode.SEQUENTIAL) {
            // SEQUENTIAL 모드: 자동 날짜 계산
            if (request.getManDays() == null) {
                throw new IllegalArgumentException("SEQUENTIAL 모드에서는 공수(MD)가 필수입니다.");
            }
            if (request.getManDays().compareTo(BigDecimal.ZERO) <= 0) {
                throw new IllegalArgumentException("공수(MD)는 0보다 커야 합니다.");
            }
            if (request.getAssigneeId() == null && startDate == null) {
                throw new IllegalArgumentException("SEQUENTIAL 모드에서 담당자가 없으면 시작일을 직접 입력해야 합니다.");
            }

            // 비가용일 조회 (공휴일 + 회사휴무 + 개인휴무)
            Set<LocalDate> unavailableDates = getUnavailableDates(request.getAssigneeId());

            if (startDate == null) {
                // 후속 태스크: 시작일 자동 계산 (전역 큐 + Same-Day Rule + Hold/Cancelled 제외)
                startDate = calculateAutoStartDate(projectId, request.getAssigneeId(),
                        List.of(), null, unavailableDates);
            } else {
                // 첫 번째 태스크: 시작일이 영업일인지 보정 (비가용일 반영)
                startDate = businessDayCalculator.ensureBusinessDay(startDate, unavailableDates);
            }

            // 종료일 자동 계산 (capacity + 비가용일 반영)
            endDate = businessDayCalculator.calculateEndDate(startDate, request.getManDays(), capacity, unavailableDates);
        } else {
            // PARALLEL 모드: 기존 방식
            if (startDate == null || endDate == null) {
                throw new IllegalArgumentException("PARALLEL 모드에서는 시작일과 종료일은 필수입니다.");
            }
            if (startDate.isAfter(endDate)) {
                throw new IllegalArgumentException("시작일은 종료일보다 이후일 수 없습니다.");
            }
        }

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + projectId));

        Squad squad = null;
        if (request.getSquadId() != null) {
            squad = squadRepository.findById(request.getSquadId())
                    .orElseThrow(() -> new EntityNotFoundException(
                            "스쿼드를 찾을 수 없습니다. id=" + request.getSquadId()));
        }

        // PARALLEL 모드인 경우 프로젝트 기간 내 검증 (다른 태스크와 충돌 검증 안 함)
        if (assignee != null && executionMode == TaskExecutionMode.PARALLEL) {
            validateParallelTaskDateRange(assignee, project, startDate, endDate);
        }

        Task.TaskBuilder taskBuilder = Task.builder()
                .project(project)
                .squad(squad)
                .assignee(assignee)
                .name(request.getName())
                .description(request.getDescription())
                .startDate(startDate)
                .endDate(endDate)
                .manDays(request.getManDays())
                .sortOrder(request.getSortOrder())
                .executionMode(executionMode)
                .priority(request.getPriority())
                .type(request.getType())
                .actualEndDate(request.getActualEndDate())
                .jiraKey(validateJiraKey(request.getJiraKey()));

        // status가 null이면 @Builder.Default(TODO)가 적용됨
        if (request.getStatus() != null) {
            taskBuilder.status(request.getStatus());
        }

        Task task = taskBuilder.build();
        Task saved = taskRepository.save(task);

        // 링크 저장
        List<TaskLink> savedLinks = saveTaskLinks(saved, request.getLinks());

        log.info("태스크 생성 완료: id={}, name={}, projectId={}, executionMode={}, startDate={}, endDate={}",
                saved.getId(), saved.getName(), projectId, executionMode, startDate, endDate);
        return TaskDto.Response.from(saved, List.of(), savedLinks);
    }

    /**
     * 태스크 수정
     * - SEQUENTIAL 모드: 자동 날짜 계산 + 후속 태스크 연쇄 재계산
     * - PARALLEL 모드: 기존 방식 (startDate, endDate 직접 입력)
     * - capacity, Same-Day Rule, Hold/Cancelled 제외, 전역 큐 반영
     */
    @Transactional
    public TaskDto.Response updateTask(Long taskId, TaskDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("태스크명은 필수입니다.");
        }
        if (request.getName().length() > 300) {
            throw new IllegalArgumentException("태스크명은 300자를 초과할 수 없습니다.");
        }
        // 실행 모드 결정
        TaskExecutionMode executionMode = request.getExecutionMode() != null
                ? request.getExecutionMode() : TaskExecutionMode.SEQUENTIAL;

        Task task = taskRepository.findByIdWithDetails(taskId)
                .orElseThrow(() -> new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId));

        Long projectId = (request.getProjectId() != null) ? request.getProjectId() : task.getProject().getId();

        LocalDate startDate = request.getStartDate();
        LocalDate endDate = request.getEndDate();

        // 담당자 조회 (capacity 필요)
        Member assignee = null;
        BigDecimal capacity = BigDecimal.ONE;
        if (request.getAssigneeId() != null) {
            assignee = memberRepository.findById(request.getAssigneeId())
                    .orElseThrow(() -> new EntityNotFoundException(
                            "멤버를 찾을 수 없습니다. id=" + request.getAssigneeId()));
            capacity = assignee.getCapacity() != null ? assignee.getCapacity() : BigDecimal.ONE;
        }

        if (executionMode == TaskExecutionMode.SEQUENTIAL) {
            // SEQUENTIAL 모드: 자동 날짜 계산
            if (request.getManDays() == null) {
                throw new IllegalArgumentException("SEQUENTIAL 모드에서는 공수(MD)가 필수입니다.");
            }
            if (request.getManDays().compareTo(BigDecimal.ZERO) <= 0) {
                throw new IllegalArgumentException("공수(MD)는 0보다 커야 합니다.");
            }
            if (request.getAssigneeId() == null && startDate == null) {
                throw new IllegalArgumentException("SEQUENTIAL 모드에서 담당자가 없으면 시작일을 직접 입력해야 합니다.");
            }

            // 현재 태스크의 의존관계 조회
            List<Long> dependsOnTaskIds = taskDependencyRepository.findByTaskIdWithDependsOnTask(taskId).stream()
                    .map(td -> td.getDependsOnTask().getId())
                    .collect(Collectors.toList());

            // 비가용일 조회 (공휴일 + 회사휴무 + 개인휴무)
            Set<LocalDate> unavailableDates = getUnavailableDates(request.getAssigneeId());

            if (startDate == null) {
                // 후속 태스크: 시작일 자동 계산
                startDate = calculateAutoStartDate(projectId, request.getAssigneeId(),
                        dependsOnTaskIds, taskId, unavailableDates);
            } else {
                // 첫 번째 태스크: 시작일이 영업일인지 보정 (비가용일 반영)
                startDate = businessDayCalculator.ensureBusinessDay(startDate, unavailableDates);
            }

            // 종료일 자동 계산 (capacity + 비가용일 반영)
            endDate = businessDayCalculator.calculateEndDate(startDate, request.getManDays(), capacity, unavailableDates);
        } else {
            // PARALLEL 모드: 기존 방식
            if (startDate == null || endDate == null) {
                throw new IllegalArgumentException("PARALLEL 모드에서는 시작일과 종료일은 필수입니다.");
            }
            if (startDate.isAfter(endDate)) {
                throw new IllegalArgumentException("시작일은 종료일보다 이후일 수 없습니다.");
            }
        }

        Squad squad = squadRepository.findById(request.getSquadId())
                .orElseThrow(() -> new EntityNotFoundException(
                        "스쿼드를 찾을 수 없습니다. id=" + request.getSquadId()));

        // 프로젝트 변경 처리
        Project project = task.getProject();
        if (request.getProjectId() != null && !request.getProjectId().equals(task.getProject().getId())) {
            project = projectRepository.findById(request.getProjectId())
                    .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + request.getProjectId()));
        }

        // PARALLEL 모드인 경우 프로젝트 기간 내 검증 (다른 태스크와 충돌 검증 안 함)
        if (assignee != null && executionMode == TaskExecutionMode.PARALLEL) {
            validateParallelTaskDateRange(assignee, project, startDate, endDate);
        }

        task.setProject(project);
        task.setSquad(squad);
        task.setAssignee(assignee);
        task.setName(request.getName());
        task.setDescription(request.getDescription());
        task.setStartDate(startDate);
        task.setEndDate(endDate);
        task.setManDays(request.getManDays());
        task.setExecutionMode(executionMode);
        task.setPriority(request.getPriority());
        task.setType(request.getType());
        task.setActualEndDate(request.getActualEndDate());
        if (request.getStatus() != null) {
            task.setStatus(request.getStatus());
        }
        task.setSortOrder(request.getSortOrder());

        // jiraKey: null이면 기존 값 유지, 빈 문자열이면 null로 저장(연결 해제), 값이 있으면 저장
        if (request.getJiraKey() != null) {
            task.setJiraKey(request.getJiraKey().isBlank() ? null : validateJiraKey(request.getJiraKey().trim()));
        }

        Task updated = taskRepository.save(task);

        // SEQUENTIAL 모드이면 후속 태스크 연쇄 재계산 (동일 트랜잭션 내)
        if (executionMode == TaskExecutionMode.SEQUENTIAL) {
            recalculateDependentTasks(taskId);
        }

        // 링크 교체 (replace-all 방식): request.links가 null이 아닌 경우에만 교체
        List<TaskLink> savedLinks;
        if (request.getLinks() != null) {
            taskLinkRepository.deleteByTaskId(taskId);
            taskLinkRepository.flush();
            savedLinks = saveTaskLinks(updated, request.getLinks());
        } else {
            savedLinks = taskLinkRepository.findByTaskIdOrderByCreatedAtAsc(taskId);
        }

        List<Long> dependencies = taskDependencyRepository.findByTaskIdWithDependsOnTask(taskId).stream()
                .map(td -> td.getDependsOnTask().getId())
                .collect(Collectors.toList());

        log.info("태스크 수정 완료: id={}, name={}, executionMode={}, startDate={}, endDate={}",
                updated.getId(), updated.getName(), executionMode, startDate, endDate);
        return TaskDto.Response.from(updated, dependencies, savedLinks);
    }

    /**
     * 태스크 삭제
     */
    @Transactional
    public void deleteTask(Long taskId) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId));

        // 의존관계 먼저 삭제
        taskDependencyRepository.deleteByTaskId(taskId);
        taskDependencyRepository.deleteByDependsOnTaskId(taskId);
        // 링크 삭제
        taskLinkRepository.deleteByTaskId(taskId);
        taskRepository.delete(task);
        log.info("태스크 삭제 완료: id={}, name={}", taskId, task.getName());
    }

    /**
     * 태스크 일괄 삭제 (best-effort 방식, chunk 분할 처리)
     * 존재하지 않는 taskId는 건너뛰고, 존재하는 것만 삭제한다.
     * DELETE_CHUNK_SIZE(100) 단위로 나눠 처리하며, 단일 트랜잭션을 유지한다.
     */
    @Transactional
    public int deleteTasksBatch(List<Long> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) return 0;

        // 중복 ID 제거 (다른 chunk에 분산되어 불필요한 DB 쿼리가 발생하는 것을 방지)
        List<Long> uniqueIds = taskIds.stream().distinct().toList();

        int totalDeleted = 0;
        // 100개씩 chunk 분할
        for (int i = 0; i < uniqueIds.size(); i += DELETE_CHUNK_SIZE) {
            List<Long> chunk = uniqueIds.subList(i, Math.min(i + DELETE_CHUNK_SIZE, uniqueIds.size()));

            List<Task> existingTasks = taskRepository.findAllById(chunk);
            if (existingTasks.isEmpty()) continue;

            List<Long> existingIds = existingTasks.stream().map(Task::getId).toList();

            taskDependencyRepository.deleteByTaskIdIn(existingIds);
            taskDependencyRepository.deleteByDependsOnTaskIdIn(existingIds);
            taskLinkRepository.deleteByTaskIdIn(existingIds);
            taskRepository.deleteAll(existingTasks);

            totalDeleted += existingTasks.size();
            log.debug("배치 삭제 chunk 처리: offset={}, chunk={}, deleted={}", i, chunk.size(), existingTasks.size());
        }

        log.info("배치 삭제 완료: 요청={}건, 고유={}건, 삭제={}건", taskIds.size(), uniqueIds.size(), totalDeleted);
        return totalDeleted;
    }

    /**
     * 의존관계 추가
     */
    @Transactional
    public void addDependency(Long taskId, Long dependsOnTaskId) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId));
        Task dependsOnTask = taskRepository.findById(dependsOnTaskId)
                .orElseThrow(() -> new EntityNotFoundException("선행 태스크를 찾을 수 없습니다. id=" + dependsOnTaskId));

        if (taskId.equals(dependsOnTaskId)) {
            throw new IllegalArgumentException("자기 자신에 대한 의존관계는 추가할 수 없습니다.");
        }

        if (taskDependencyRepository.existsByTaskIdAndDependsOnTaskId(taskId, dependsOnTaskId)) {
            throw new IllegalStateException("이미 존재하는 의존관계입니다.");
        }

        TaskDependency dependency = TaskDependency.builder()
                .task(task)
                .dependsOnTask(dependsOnTask)
                .build();

        taskDependencyRepository.save(dependency);
        log.info("의존관계 추가: taskId={} -> dependsOnTaskId={}", taskId, dependsOnTaskId);
    }

    /**
     * 의존관계 제거
     */
    @Transactional
    public void removeDependency(Long taskId, Long dependsOnTaskId) {
        List<TaskDependency> dependencies = taskDependencyRepository.findByTaskIdWithDependsOnTask(taskId);
        TaskDependency dependency = dependencies.stream()
                .filter(td -> td.getDependsOnTask().getId().equals(dependsOnTaskId))
                .findFirst()
                .orElseThrow(() -> new EntityNotFoundException(
                        "의존관계를 찾을 수 없습니다. taskId=" + taskId + ", dependsOnTaskId=" + dependsOnTaskId));

        taskDependencyRepository.delete(dependency);
        log.info("의존관계 제거: taskId={} -> dependsOnTaskId={}", taskId, dependsOnTaskId);
    }

    // ---- 날짜 프리뷰 API 메서드 ----

    /**
     * 날짜 프리뷰 계산 (DB 저장 없음, 태스크 모달 프리뷰용)
     * - 전역 큐 기반 (프로젝트 제한 없이 담당자 전체 태스크 참조)
     * - capacity 반영
     */
    public TaskDto.PreviewDatesResponse previewDates(Long projectId, Long assigneeId,
                                                      BigDecimal manDays,
                                                      List<Long> dependsOnTaskIds,
                                                      Long excludeTaskId) {
        // 첫 번째 태스크 여부 판단 (전역 기준, Hold/Cancelled 제외)
        boolean isFirstTask = true;
        if (assigneeId != null) {
            long count = taskRepository.countSequentialTasksByAssigneeGlobal(
                    assigneeId, TaskExecutionMode.SEQUENTIAL, INACTIVE_STATUSES, excludeTaskId);
            isFirstTask = (count == 0);
        }

        // 시작일/종료일 계산 (assigneeId가 있고, 첫 번째 태스크가 아닌 경우)
        LocalDate startDate = null;
        LocalDate endDate = null;

        if (assigneeId != null && !isFirstTask) {
            // 비가용일 조회
            Set<LocalDate> unavailableDates = getUnavailableDates(assigneeId);

            startDate = calculateAutoStartDate(projectId, assigneeId,
                    dependsOnTaskIds != null ? dependsOnTaskIds : List.of(), excludeTaskId, unavailableDates);

            if (manDays != null && manDays.compareTo(BigDecimal.ZERO) > 0) {
                // capacity + 비가용일 반영
                Member assignee = memberRepository.findById(assigneeId).orElse(null);
                BigDecimal capacity = (assignee != null && assignee.getCapacity() != null)
                        ? assignee.getCapacity() : BigDecimal.ONE;
                endDate = businessDayCalculator.calculateEndDate(startDate, manDays, capacity, unavailableDates);
            }
        }

        return TaskDto.PreviewDatesResponse.builder()
                .startDate(startDate)
                .endDate(endDate)
                .isFirstTask(isFirstTask)
                .build();
    }

    // ---- 담당자 큐 날짜 연쇄 재계산 ----

    /**
     * 담당자 큐의 순서에 따라 날짜를 연쇄 재계산한다.
     * - 1번 태스크: 담당자의 queueStartDate를 시작일로 사용
     * - 2번 이후: 이전 태스크 종료일 다음 영업일이 시작일
     * - 각 태스크의 종료일은 시작일 + 공수(capacity 반영)로 재계산
     */
    @Transactional
    public void recalculateQueueDates(Long assigneeId) {
        if (assigneeId == null) return;

        List<Task> allTasks = taskRepository.findSequentialTasksByAssigneeOrdered(
                assigneeId, TaskExecutionMode.SEQUENTIAL, INACTIVE_STATUSES);

        List<Task> orderedTasks = allTasks.stream()
                .filter(t -> t.getAssigneeOrder() != null)
                .sorted(Comparator.comparingInt(Task::getAssigneeOrder))
                .collect(Collectors.toList());

        if (orderedTasks.isEmpty()) return;

        Set<LocalDate> unavailableDates = getUnavailableDates(assigneeId);
        Member assignee = memberRepository.findById(assigneeId).orElse(null);
        BigDecimal capacity = (assignee != null && assignee.getCapacity() != null)
                ? assignee.getCapacity() : BigDecimal.ONE;

        // 1번 태스크: 담당자의 queueStartDate를 시작일로 사용
        Task firstTask = orderedTasks.get(0);
        LocalDate queueStartDate = (assignee != null) ? assignee.getQueueStartDate() : null;
        if (queueStartDate != null) {
            LocalDate adjustedStart = businessDayCalculator.ensureBusinessDay(queueStartDate, unavailableDates);
            firstTask.setStartDate(adjustedStart);
            if (firstTask.getManDays() != null && firstTask.getManDays().compareTo(BigDecimal.ZERO) > 0) {
                firstTask.setEndDate(businessDayCalculator.calculateEndDate(
                        adjustedStart, firstTask.getManDays(), capacity, unavailableDates));
            }
        }

        // 2번 이후 태스크: 이전 태스크 종료일 기준으로 시작일 계산
        for (int i = 1; i < orderedTasks.size(); i++) {
            Task prevTask = orderedTasks.get(i - 1);
            Task currTask = orderedTasks.get(i);

            if (prevTask.getEndDate() == null) break;

            // 이전 태스크 종료일 다음 영업일 (Same-Day Rule 적용)
            LocalDate newStartDate;
            if (businessDayCalculator.isFractionalMd(prevTask.getManDays())) {
                newStartDate = businessDayCalculator.ensureBusinessDay(prevTask.getEndDate(), unavailableDates);
            } else {
                newStartDate = businessDayCalculator.getNextBusinessDay(prevTask.getEndDate(), unavailableDates);
            }

            currTask.setStartDate(newStartDate);

            // 종료일 재계산
            if (currTask.getManDays() != null && currTask.getManDays().compareTo(BigDecimal.ZERO) > 0) {
                currTask.setEndDate(businessDayCalculator.calculateEndDate(
                        newStartDate, currTask.getManDays(), capacity, unavailableDates));
            }
        }

        taskRepository.saveAllAndFlush(orderedTasks);
        log.info("큐 날짜 연쇄 재계산 완료: assigneeId={}, orderedTasks={}", assigneeId, orderedTasks.size());
    }

    /**
     * 담당자 큐의 순서에 따라 TODO 상태 태스크에만 날짜를 재계산한다.
     * - IN_PROGRESS, COMPLETED 상태 태스크는 기존 날짜를 유지하되, 다음 태스크 시작일 계산의 기준으로 사용한다.
     * - HOLD, CANCELLED 태스크는 쿼리 단계에서 이미 제외됨.
     *
     * 처리 흐름:
     * 1. SEQUENTIAL 태스크를 assigneeOrder 기준 정렬 (HOLD/CANCELLED 제외)
     * 2. 첫 번째 TODO 태스크에만 queueStartDate를 적용
     *    - 앞에 IN_PROGRESS/COMPLETED 태스크가 있으면 그 endDate 기준으로 계산
     * 3. TODO가 아닌 태스크는 날짜 불변 (endDate를 후속 태스크 계산 기준으로만 사용)
     * 4. TODO 태스크에만 새 startDate/endDate 계산 및 저장
     */
    @Transactional
    public void recalculateQueueDatesForTodo(Long assigneeId) {
        if (assigneeId == null) return;

        List<Task> allTasks = taskRepository.findSequentialTasksByAssigneeOrdered(
                assigneeId, TaskExecutionMode.SEQUENTIAL, INACTIVE_STATUSES);

        List<Task> orderedTasks = allTasks.stream()
                .filter(t -> t.getAssigneeOrder() != null)
                .sorted(Comparator.comparingInt(Task::getAssigneeOrder))
                .collect(Collectors.toList());

        if (orderedTasks.isEmpty()) return;

        Set<LocalDate> unavailableDates = getUnavailableDates(assigneeId);
        Member assignee = memberRepository.findById(assigneeId).orElse(null);
        BigDecimal capacity = (assignee != null && assignee.getCapacity() != null)
                ? assignee.getCapacity() : BigDecimal.ONE;
        LocalDate queueStartDate = (assignee != null) ? assignee.getQueueStartDate() : null;

        // prevEndDate: 이전 태스크의 종료일 (다음 태스크 시작일 계산 기준)
        // prevIsFractional: 이전 태스크의 manDays가 소수인지 (Same-Day Rule용)
        LocalDate prevEndDate = null;
        boolean prevIsFractional = false;
        boolean queueStartDateUsed = false;

        for (int i = 0; i < orderedTasks.size(); i++) {
            Task task = orderedTasks.get(i);
            boolean isTodo = task.getStatus() == TaskStatus.TODO;

            if (isTodo) {
                // TODO 태스크: 날짜 재계산
                LocalDate newStartDate;
                if (prevEndDate != null) {
                    // 이전 태스크가 있으면 그 endDate 기준으로 시작일 계산
                    if (prevIsFractional) {
                        newStartDate = businessDayCalculator.ensureBusinessDay(prevEndDate, unavailableDates);
                    } else {
                        newStartDate = businessDayCalculator.getNextBusinessDay(prevEndDate, unavailableDates);
                    }
                } else if (!queueStartDateUsed && queueStartDate != null) {
                    // 첫 번째 TODO 태스크이고, 앞에 비-TODO 태스크가 없는 경우: queueStartDate 사용
                    newStartDate = businessDayCalculator.ensureBusinessDay(queueStartDate, unavailableDates);
                } else {
                    // 이전 태스크도 없고 queueStartDate도 없으면 현재 시작일 유지
                    newStartDate = task.getStartDate();
                }

                queueStartDateUsed = true;
                task.setStartDate(newStartDate);

                if (newStartDate != null && task.getManDays() != null && task.getManDays().compareTo(BigDecimal.ZERO) > 0) {
                    task.setEndDate(businessDayCalculator.calculateEndDate(
                            newStartDate, task.getManDays(), capacity, unavailableDates));
                }

                // 다음 태스크 계산을 위한 기준 업데이트
                prevEndDate = task.getEndDate();
                prevIsFractional = businessDayCalculator.isFractionalMd(task.getManDays());
                // endDate가 null이면 후속 태스크 시작일 계산 불가 -> 체인 중단
                if (prevEndDate == null) break;
            } else {
                // IN_PROGRESS / COMPLETED 태스크: 날짜 불변, 기준으로만 사용
                if (i == 0 && queueStartDate != null) {
                    // 첫 번째 태스크가 비-TODO이면 queueStartDate는 사용하지 않고,
                    // 이 태스크의 기존 endDate를 기준으로 사용
                    queueStartDateUsed = true;
                }
                prevEndDate = task.getEndDate();
                prevIsFractional = businessDayCalculator.isFractionalMd(task.getManDays());
                // endDate가 null이면 후속 태스크 시작일 계산 불가 -> 체인 중단
                if (prevEndDate == null) break;
            }
        }

        taskRepository.saveAllAndFlush(orderedTasks);
        log.info("큐 날짜 TODO 재계산 완료: assigneeId={}, orderedTasks={}", assigneeId, orderedTasks.size());
    }

    // ---- 링크 전용 API 메서드 ----

    /**
     * 태스크 링크 목록 조회
     */
    public List<TaskDto.TaskLinkResponse> getTaskLinks(Long taskId) {
        if (!taskRepository.existsById(taskId)) {
            throw new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId);
        }
        return taskLinkRepository.findByTaskIdOrderByCreatedAtAsc(taskId).stream()
                .map(TaskDto.TaskLinkResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 태스크 링크 단건 추가
     */
    @Transactional
    public TaskDto.TaskLinkResponse addTaskLink(Long taskId, TaskDto.TaskLinkRequest request) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId));

        long currentCount = taskLinkRepository.countByTaskId(taskId);
        if (currentCount >= 10) {
            throw new IllegalArgumentException("태스크 링크는 최대 10개까지 추가할 수 있습니다.");
        }

        if (request.getUrl() == null || request.getUrl().isBlank()) {
            throw new IllegalArgumentException("링크 URL은 필수입니다.");
        }

        String url = request.getUrl().trim();
        validateLinkUrl(url);

        String label = (request.getLabel() != null && !request.getLabel().isBlank())
                ? request.getLabel().trim()
                : url.substring(0, Math.min(50, url.length()));
        if (label.length() > 200) {
            label = label.substring(0, 200);
        }

        TaskLink link = TaskLink.builder()
                .task(task)
                .url(url)
                .label(label)
                .build();

        TaskLink saved = taskLinkRepository.save(link);
        log.info("태스크 링크 추가: taskId={}, linkId={}, url={}", taskId, saved.getId(), saved.getUrl());
        return TaskDto.TaskLinkResponse.from(saved);
    }

    /**
     * 태스크 링크 단건 삭제
     */
    @Transactional
    public void deleteTaskLink(Long taskId, Long linkId) {
        TaskLink link = taskLinkRepository.findById(linkId)
                .orElseThrow(() -> new EntityNotFoundException("링크를 찾을 수 없습니다. id=" + linkId));

        if (!link.getTask().getId().equals(taskId)) {
            throw new IllegalArgumentException("해당 태스크에 속하지 않는 링크입니다.");
        }

        taskLinkRepository.delete(link);
        log.info("태스크 링크 삭제: taskId={}, linkId={}", taskId, linkId);
    }

    // ---- 자동 날짜 계산 Private 메서드 ----

    /**
     * 자동 시작일 계산 (비가용일 미반영 하위호환 오버로드)
     */
    private LocalDate calculateAutoStartDate(Long projectId, Long assigneeId,
                                              List<Long> dependsOnTaskIds, Long excludeTaskId) {
        return calculateAutoStartDate(projectId, assigneeId, dependsOnTaskIds, excludeTaskId, null);
    }

    /**
     * 자동 시작일 계산 (Phase 2 개선 - 비가용일 반영)
     * 1. 선행 태스크(의존관계)의 종료일 중 최댓값 조회 — HOLD/CANCELLED 제외 (GAP-14)
     * 2. 동일 담당자의 전체 프로젝트 SEQUENTIAL 태스크 중 종료일이 가장 늦은 것 조회 (GAP-07 전역 큐)
     * 3. 두 값 중 더 늦은 날짜를 후보 기준일로 결정
     * 4. Same-Day Rule 적용 (GAP-06): 선행 MD가 fractional이면 당일 시작
     * 5. 아니면 후보 기준일의 다음 영업일을 최종 시작일로 반환
     * 6. 비가용일(공휴일/회사휴무/개인휴무) 반영 (GAP-A)
     */
    private LocalDate calculateAutoStartDate(Long projectId, Long assigneeId,
                                              List<Long> dependsOnTaskIds, Long excludeTaskId,
                                              Set<LocalDate> unavailableDates) {
        LocalDate latestEndDate = null;
        boolean latestIsFractional = false;

        // 1. 선행 태스크들의 종료일 중 최댓값 (HOLD/CANCELLED 제외)
        if (dependsOnTaskIds != null && !dependsOnTaskIds.isEmpty()) {
            List<Task> depTasks = taskRepository.findAllById(dependsOnTaskIds);
            for (Task depTask : depTasks) {
                if (depTask.getEndDate() == null) {
                    continue;
                }
                // GAP-14: Hold/Cancelled 상태 태스크는 의존관계 계산에서 제외
                if (INACTIVE_STATUSES.contains(depTask.getStatus())) {
                    continue;
                }
                if (latestEndDate == null || depTask.getEndDate().isAfter(latestEndDate)) {
                    latestEndDate = depTask.getEndDate();
                    latestIsFractional = businessDayCalculator.isFractionalMd(depTask.getManDays());
                }
            }
        }

        // 2. 동일 담당자의 전체 프로젝트 SEQUENTIAL 태스크 중 종료일이 가장 늦은 것 (GAP-07 전역 큐)
        if (assigneeId != null) {
            List<Task> latestTasks = taskRepository.findLatestSequentialTaskByAssigneeGlobal(
                    assigneeId, TaskExecutionMode.SEQUENTIAL, INACTIVE_STATUSES, excludeTaskId);
            if (!latestTasks.isEmpty()) {
                Task assigneeLatestTask = latestTasks.get(0);
                LocalDate assigneeLatest = assigneeLatestTask.getEndDate();
                if (assigneeLatest != null && (latestEndDate == null || assigneeLatest.isAfter(latestEndDate))) {
                    latestEndDate = assigneeLatest;
                    latestIsFractional = businessDayCalculator.isFractionalMd(assigneeLatestTask.getManDays());
                }
            }
        }

        // 3. Same-Day Rule (GAP-06) + 다음 영업일 결정 (비가용일 반영)
        if (latestEndDate != null) {
            if (latestIsFractional) {
                // 선행 태스크가 fractional MD로 끝나면 같은 날 시작 가능
                return businessDayCalculator.ensureBusinessDay(latestEndDate, unavailableDates);
            } else {
                // full-day로 끝나면 다음 영업일
                return businessDayCalculator.getNextBusinessDay(latestEndDate, unavailableDates);
            }
        }

        // 선행 태스크도 없고 동일 담당자 태스크도 없으면 오늘 기준 다음 영업일
        return businessDayCalculator.ensureBusinessDay(LocalDate.now(), unavailableDates);
    }

    /**
     * 후속 태스크 연쇄 재계산 (BFS)
     * - 해당 태스크를 선행으로 가지는 모든 후속 SEQUENTIAL 태스크를 순회하며 날짜 재계산
     * - HOLD/CANCELLED 상태 태스크는 건너뜀 (GAP-14)
     * - 방문 추적(Set)으로 순환 방지
     * - capacity 반영
     * - 동일 @Transactional 내에서 호출
     */
    private void recalculateDependentTasks(Long taskId) {
        Set<Long> visited = new HashSet<>();
        Queue<Long> queue = new LinkedList<>();
        queue.add(taskId);
        visited.add(taskId);

        int maxIterations = 1000;
        int iteration = 0;

        while (!queue.isEmpty()) {
            if (++iteration > maxIterations) {
                log.warn("연쇄 재계산 최대 반복 횟수({}) 초과. 순환 의존관계 의심. 시작 taskId={}", maxIterations, taskId);
                break;
            }
            Long currentTaskId = queue.poll();

            // 현재 태스크를 선행(dependsOnTask)으로 가지는 후속 태스크 조회
            List<TaskDependency> dependents = taskDependencyRepository.findByDependsOnTaskIdWithTask(currentTaskId);

            for (TaskDependency td : dependents) {
                Task dependentTask = td.getTask();
                Long dependentTaskId = dependentTask.getId();

                // 순환 방지
                if (visited.contains(dependentTaskId)) {
                    continue;
                }
                visited.add(dependentTaskId);

                // SEQUENTIAL 모드인 경우에만 재계산
                if (dependentTask.getExecutionMode() != TaskExecutionMode.SEQUENTIAL) {
                    continue;
                }

                // 상세 정보 로드 (assignee 등)
                Task fullTask = taskRepository.findByIdWithDetails(dependentTaskId).orElse(null);
                if (fullTask == null) {
                    continue;
                }

                // GAP-14: HOLD/CANCELLED 상태 태스크는 재계산 건너뜀
                if (INACTIVE_STATUSES.contains(fullTask.getStatus())) {
                    // 그래도 이 태스크의 후속 태스크는 큐에 추가 (chain은 유지)
                    queue.add(dependentTaskId);
                    continue;
                }

                // 현재 태스크의 의존관계 조회
                List<Long> depTaskIds = taskDependencyRepository.findByTaskIdWithDependsOnTask(dependentTaskId).stream()
                        .map(dep -> dep.getDependsOnTask().getId())
                        .collect(Collectors.toList());

                Long assigneeId = fullTask.getAssignee() != null ? fullTask.getAssignee().getId() : null;
                Long projectIdForCalc = fullTask.getProject().getId();

                // 비가용일 조회
                Set<LocalDate> taskUnavailableDates = getUnavailableDates(assigneeId);

                // 시작일 재계산 (비가용일 반영)
                LocalDate newStartDate = calculateAutoStartDate(
                        projectIdForCalc, assigneeId, depTaskIds, dependentTaskId, taskUnavailableDates);

                // 종료일 재계산 (capacity + 비가용일 반영)
                LocalDate newEndDate = fullTask.getEndDate();
                if (fullTask.getManDays() != null && fullTask.getManDays().compareTo(BigDecimal.ZERO) > 0) {
                    BigDecimal capacity = BigDecimal.ONE;
                    if (fullTask.getAssignee() != null && fullTask.getAssignee().getCapacity() != null) {
                        capacity = fullTask.getAssignee().getCapacity();
                    }
                    newEndDate = businessDayCalculator.calculateEndDate(newStartDate, fullTask.getManDays(), capacity, taskUnavailableDates);
                }

                // 변경이 있을 때만 저장 (불필요한 UPDATE 방지)
                boolean startChanged = (newStartDate != null && !newStartDate.equals(fullTask.getStartDate()));
                boolean endChanged = (newEndDate != null && !newEndDate.equals(fullTask.getEndDate()));
                if (startChanged || endChanged) {
                    fullTask.setStartDate(newStartDate);
                    fullTask.setEndDate(newEndDate);
                    taskRepository.saveAndFlush(fullTask);
                    log.info("연쇄 재계산: taskId={}, name={}, newStartDate={}, newEndDate={}",
                            dependentTaskId, fullTask.getName(), newStartDate, newEndDate);
                }

                // 이 태스크의 후속 태스크도 큐에 추가
                queue.add(dependentTaskId);
            }
        }
    }

    // ---- 비가용일 조회 Private 메서드 ----

    /**
     * 비가용일 Set 조회 (공휴일 + 회사휴무 + 개인휴무)
     * - 넓은 범위로 미리 조회하여 BusinessDayCalculator에 전달
     */
    private Set<LocalDate> getUnavailableDates(Long assigneeId) {
        // 넓은 범위로 조회 (현재 날짜 기준 -1년 ~ +3년)
        LocalDate rangeStart = LocalDate.now().minusYears(1);
        LocalDate rangeEnd = LocalDate.now().plusYears(3);

        Set<LocalDate> unavailableDates = new HashSet<>();

        // 공휴일 + 회사휴무
        Set<LocalDate> holidays = holidayService.getHolidayDatesBetween(rangeStart, rangeEnd);
        unavailableDates.addAll(holidays);

        // 개인휴무
        if (assigneeId != null) {
            Set<LocalDate> leaves = memberLeaveService.getMemberLeaveDatesBetween(assigneeId, rangeStart, rangeEnd);
            unavailableDates.addAll(leaves);
        }

        return unavailableDates;
    }

    // ---- Other Private 메서드 ----

    /**
     * 담당자 일정 충돌 검증
     * - SEQUENTIAL 모드인 기존 태스크만 충돌 대상으로 조회
     * - 같은 담당자의 기존 SEQUENTIAL 태스크와 날짜가 하루라도 겹치면 예외 발생
     */
    private void validateAssigneeConflict(Member assignee,
                                           LocalDate startDate,
                                           LocalDate endDate,
                                           Long excludeTaskId) {
        List<Task> overlapping = taskRepository.findOverlappingTasks(
                assignee.getId(), startDate, endDate, excludeTaskId,
                TaskExecutionMode.SEQUENTIAL, CONFLICT_EXCLUDE_STATUSES);

        if (!overlapping.isEmpty()) {
            Task conflict = overlapping.get(0);
            throw new AssigneeConflictException(
                    String.format("%s님은 %s ~ %s 기간에 이미 [%s] '%s' 태스크가 배정되어 있습니다.",
                            assignee.getName(),
                            conflict.getStartDate(),
                            conflict.getEndDate(),
                            conflict.getProject().getName(),
                            conflict.getName()));
        }
    }

    /**
     * PARALLEL 태스크 날짜 범위 검증
     * - 담당자 착수 가능일(queueStartDate) 이후인지
     * - 프로젝트 론치일(endDate) 이전인지
     */
    private void validateParallelTaskDateRange(Member assignee, Project project,
                                                LocalDate startDate, LocalDate endDate) {
        if (startDate == null || endDate == null) return;

        // 담당자 착수 가능일 검증
        if (assignee.getQueueStartDate() != null && startDate.isBefore(assignee.getQueueStartDate())) {
            throw new IllegalArgumentException(
                    String.format("%s님의 착수 가능일(%s) 이전에는 태스크를 배치할 수 없습니다.",
                            assignee.getName(), assignee.getQueueStartDate()));
        }

        // 프로젝트 론치일 검증
        if (project.getEndDate() != null && endDate.isAfter(project.getEndDate())) {
            throw new IllegalArgumentException(
                    String.format("프로젝트 론치일(%s) 이후에는 태스크를 배치할 수 없습니다.",
                            project.getEndDate()));
        }
    }

    /**
     * 태스크 링크 목록 저장
     */
    private List<TaskLink> saveTaskLinks(Task task, List<TaskDto.TaskLinkRequest> linkRequests) {
        if (linkRequests == null || linkRequests.isEmpty()) {
            return List.of();
        }

        List<TaskDto.TaskLinkRequest> validLinks = linkRequests.stream()
                .filter(lr -> lr.getUrl() != null && !lr.getUrl().isBlank())
                .collect(Collectors.toList());

        if (validLinks.size() > 10) {
            throw new IllegalArgumentException("태스크 링크는 최대 10개까지 추가할 수 있습니다.");
        }

        List<TaskLink> saved = new ArrayList<>();
        for (TaskDto.TaskLinkRequest lr : validLinks) {
            String url = lr.getUrl().trim();
            validateLinkUrl(url);

            String label = (lr.getLabel() != null && !lr.getLabel().isBlank())
                    ? lr.getLabel().trim()
                    : url.substring(0, Math.min(50, url.length()));
            if (label.length() > 200) {
                label = label.substring(0, 200);
            }

            TaskLink link = TaskLink.builder()
                    .task(task)
                    .url(url)
                    .label(label)
                    .build();
            saved.add(taskLinkRepository.save(link));
        }
        return saved;
    }

    /**
     * Jira Key 검증 및 정규화 (DB column: VARCHAR(50))
     * 형식: 영숫자, 하이픈, 언더스코어만 허용 (예: PROJ-123)
     */
    private String validateJiraKey(String jiraKey) {
        if (jiraKey == null) return null;
        String trimmed = jiraKey.trim();
        if (trimmed.isEmpty()) return null;
        if (trimmed.length() > 50) {
            throw new IllegalArgumentException("Jira 티켓 번호는 50자를 초과할 수 없습니다.");
        }
        if (!trimmed.matches("^[A-Za-z0-9_\\-]+$")) {
            throw new IllegalArgumentException("Jira 티켓 번호는 영숫자, 하이픈, 언더스코어만 허용됩니다.");
        }
        return trimmed;
    }

    /**
     * 링크 URL 검증
     */
    private void validateLinkUrl(String url) {
        if (url.length() > 2000) {
            throw new IllegalArgumentException("링크 URL은 2000자를 초과할 수 없습니다.");
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw new IllegalArgumentException("링크 URL은 http:// 또는 https://로 시작해야 합니다.");
        }
    }
}
