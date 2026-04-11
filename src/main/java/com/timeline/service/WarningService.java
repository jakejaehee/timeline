package com.timeline.service;

import com.timeline.domain.entity.Project;
import com.timeline.domain.entity.Task;
import com.timeline.domain.entity.TaskDependency;
import com.timeline.domain.enums.*;
import com.timeline.domain.repository.*;
import com.timeline.dto.WarningDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Warning 시스템 서비스
 * - 프로젝트/전체 단위 경고 탐지
 * - 8가지 경고 유형 지원
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WarningService {

    private final TaskRepository taskRepository;
    private final TaskDependencyRepository taskDependencyRepository;
    private final ProjectRepository projectRepository;
    private final HolidayService holidayService;
    private final MemberLeaveService memberLeaveService;
    private final BusinessDayCalculator businessDayCalculator;

    /** Hold/Cancelled 상태 목록 */
    private static final List<TaskStatus> INACTIVE_STATUSES = List.of(TaskStatus.HOLD, TaskStatus.CANCELLED);

    /**
     * 프로젝트별 경고 탐지
     */
    public WarningDto.ProjectWarningsResponse detectProjectWarnings(Long projectId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + projectId));

        List<Task> tasks = taskRepository.findByProjectIdWithDetails(projectId);
        List<TaskDependency> allDeps = taskDependencyRepository.findByProjectIdWithDetails(projectId);

        List<WarningDto.Warning> warnings = new ArrayList<>();

        // 비가용일 조회 (넓은 범위)
        LocalDate rangeStart = LocalDate.now().minusYears(1);
        LocalDate rangeEnd = LocalDate.now().plusYears(3);
        Set<LocalDate> holidayDates = holidayService.getHolidayDatesBetween(rangeStart, rangeEnd);

        // 멤버별 개인 휴무 캐시 (N+1 쿼리 방지)
        Map<Long, Set<LocalDate>> memberLeavesCache = new HashMap<>();

        for (Task task : tasks) {
            // 비활성 상태 태스크는 일부 경고만 적용
            boolean isInactive = INACTIVE_STATUSES.contains(task.getStatus());

            // 1. UNORDERED_TASK: 순서 미지정 (assigneeOrder null, SEQUENTIAL, 활성 상태)
            if (!isInactive && task.getExecutionMode() == TaskExecutionMode.SEQUENTIAL
                    && task.getAssignee() != null && task.getAssigneeOrder() == null) {
                warnings.add(buildWarning(WarningType.UNORDERED_TASK, task, project,
                        "순서 미지정: '" + task.getName() + "' 태스크의 실행 순서(assigneeOrder)가 설정되지 않았습니다."));
            }

            // 2. MISSING_START_DATE: 시작일 누락
            if (!isInactive && task.getStartDate() == null) {
                warnings.add(buildWarning(WarningType.MISSING_START_DATE, task, project,
                        "시작일 누락: '" + task.getName() + "' 태스크의 시작일이 설정되지 않았습니다."));
            }

            // 6. ORPHAN_TASK: 담당자 없는 SEQUENTIAL 태스크
            if (!isInactive && task.getExecutionMode() == TaskExecutionMode.SEQUENTIAL
                    && task.getAssignee() == null) {
                warnings.add(buildWarning(WarningType.ORPHAN_TASK, task, project,
                        "담당자 미지정: '" + task.getName() + "' SEQUENTIAL 태스크에 담당자가 없습니다."));
            }

            // 7. DEPENDENCY_REMOVED: Hold/Cancelled 선행 태스크로 인한 의존관계 제거
            if (!isInactive) {
                List<TaskDependency> taskDeps = allDeps.stream()
                        .filter(td -> td.getTask().getId().equals(task.getId()))
                        .collect(Collectors.toList());
                for (TaskDependency dep : taskDeps) {
                    Task depTask = dep.getDependsOnTask();
                    if (INACTIVE_STATUSES.contains(depTask.getStatus())) {
                        warnings.add(buildWarning(WarningType.DEPENDENCY_REMOVED, task, project,
                                "의존성 비활성: '" + task.getName() + "'의 선행 태스크 '" + depTask.getName()
                                        + "'이(가) " + depTask.getStatus() + " 상태입니다."));
                    }
                }
            }

            // 8. UNAVAILABLE_DATE: 비가용일 충돌 (가용 영업일 < 공수인 경우만 경고)
            if (!isInactive && task.getStartDate() != null && task.getEndDate() != null
                    && task.getManDays() != null && task.getManDays().signum() > 0) {
                Set<LocalDate> memberLeaves = new HashSet<>();
                if (task.getAssignee() != null) {
                    Long assigneeId = task.getAssignee().getId();
                    Set<LocalDate> allMemberLeaves = memberLeavesCache.computeIfAbsent(assigneeId,
                            id -> memberLeaveService.getMemberLeaveDatesBetween(id, rangeStart, rangeEnd));
                    for (LocalDate ld : allMemberLeaves) {
                        if (!ld.isBefore(task.getStartDate()) && !ld.isAfter(task.getEndDate())) {
                            memberLeaves.add(ld);
                        }
                    }
                }
                Set<LocalDate> taskUnavailable = new HashSet<>();
                for (LocalDate hd : holidayDates) {
                    if (!hd.isBefore(task.getStartDate()) && !hd.isAfter(task.getEndDate())) {
                        taskUnavailable.add(hd);
                    }
                }
                taskUnavailable.addAll(memberLeaves);

                // 태스크 기간 내 가용 영업일 수 계산
                int availableBusinessDays = 0;
                int unavailableCount = 0;
                LocalDate d = task.getStartDate();
                while (!d.isAfter(task.getEndDate())) {
                    if (businessDayCalculator.isBusinessDay(d)) {
                        if (taskUnavailable.contains(d)) {
                            unavailableCount++;
                        } else {
                            availableBusinessDays++;
                        }
                    }
                    d = d.plusDays(1);
                }

                // 가용 영업일이 공수(MD)보다 적을 때만 경고
                if (unavailableCount > 0 && availableBusinessDays < task.getManDays().intValue()) {
                    String assigneeName = task.getAssignee() != null ? task.getAssignee().getName() : "미지정";
                    warnings.add(buildWarning(WarningType.UNAVAILABLE_DATE, task, project,
                            "'" + task.getName() + "' (" + task.getStartDate() + " ~ " + task.getEndDate()
                                    + ") — " + assigneeName + ", 비가용일 " + unavailableCount
                                    + "일, 가용일 " + availableBusinessDays + "일 < 공수 "
                                    + task.getManDays() + "MD"));
                }
            }
        }

        // 3. SCHEDULE_CONFLICT: 담당자별 일정 겹침 검사
        Map<Long, List<Task>> tasksByAssignee = tasks.stream()
                .filter(t -> t.getAssignee() != null && !INACTIVE_STATUSES.contains(t.getStatus())
                        && t.getStartDate() != null && t.getEndDate() != null
                        && t.getExecutionMode() == TaskExecutionMode.SEQUENTIAL)
                .collect(Collectors.groupingBy(t -> t.getAssignee().getId()));

        for (Map.Entry<Long, List<Task>> entry : tasksByAssignee.entrySet()) {
            List<Task> memberTasks = entry.getValue();
            memberTasks.sort(Comparator.comparing(Task::getStartDate));
            for (int i = 0; i < memberTasks.size(); i++) {
                for (int j = i + 1; j < memberTasks.size(); j++) {
                    Task t1 = memberTasks.get(i);
                    Task t2 = memberTasks.get(j);
                    // t2.startDate가 t1.endDate 이후이면, j 이후의 태스크도 겹치지 않음 (정렬됨)
                    if (t1.getEndDate().compareTo(t2.getStartDate()) < 0) {
                        break;
                    }
                    warnings.add(buildWarning(WarningType.SCHEDULE_CONFLICT, t2, project,
                            "일정 충돌: '" + t1.getName() + "'(" + t1.getStartDate() + "~" + t1.getEndDate()
                                    + ")과 '" + t2.getName() + "'(" + t2.getStartDate() + "~" + t2.getEndDate()
                                    + ")의 일정이 겹칩니다."));
                }
            }
        }

        // 4. DEPENDENCY_ISSUE: 선행 태스크 미완료인데 후속 태스크 진행 중
        for (TaskDependency dep : allDeps) {
            Task task = dep.getTask();
            Task depTask = dep.getDependsOnTask();
            if (INACTIVE_STATUSES.contains(task.getStatus())) continue;
            if (INACTIVE_STATUSES.contains(depTask.getStatus())) continue;

            if (task.getStatus() == TaskStatus.IN_PROGRESS
                    && depTask.getStatus() != TaskStatus.COMPLETED) {
                warnings.add(buildWarning(WarningType.DEPENDENCY_ISSUE, task, project,
                        "의존성 문제: '" + task.getName() + "'이(가) 진행 중이지만 선행 태스크 '"
                                + depTask.getName() + "'이(가) 아직 완료되지 않았습니다."));
            }
        }

        // 5. DEADLINE_EXCEEDED: 프로젝트 마감 지연
        if (project.getEndDate() != null) {
            LocalDate maxEndDate = taskRepository.findMaxEndDateByProjectId(projectId, INACTIVE_STATUSES);
            if (maxEndDate != null && maxEndDate.isAfter(project.getEndDate())) {
                warnings.add(WarningDto.Warning.builder()
                        .type(WarningType.DEADLINE_EXCEEDED)
                        .projectId(project.getId())
                        .projectName(project.getName())
                        .message("마감 지연: 프로젝트 '" + project.getName()
                                + "'의 예상 종료일(" + maxEndDate + ")이 종료일(" + project.getEndDate() + ")을 초과합니다.")
                        .build());
            }
        }

        return WarningDto.ProjectWarningsResponse.builder()
                .projectId(project.getId())
                .projectName(project.getName())
                .warnings(warnings)
                .build();
    }

    /**
     * 전체 경고 요약
     */
    public WarningDto.SummaryResponse getWarningSummary() {
        List<Project> projects = projectRepository.findAll();
        List<WarningDto.Warning> allWarnings = new ArrayList<>();

        for (Project project : projects) {
            try {
                WarningDto.ProjectWarningsResponse resp = detectProjectWarnings(project.getId());
                allWarnings.addAll(resp.getWarnings());
            } catch (Exception e) {
                log.warn("프로젝트 {} 경고 탐지 중 오류: {}", project.getId(), e.getMessage());
            }
        }

        // 유형별 카운트
        Map<WarningType, Long> counts = allWarnings.stream()
                .collect(Collectors.groupingBy(WarningDto.Warning::getType, Collectors.counting()));

        return WarningDto.SummaryResponse.builder()
                .totalWarnings(allWarnings.size())
                .unorderedCount(counts.getOrDefault(WarningType.UNORDERED_TASK, 0L).intValue())
                .missingStartDateCount(counts.getOrDefault(WarningType.MISSING_START_DATE, 0L).intValue())
                .scheduleConflictCount(counts.getOrDefault(WarningType.SCHEDULE_CONFLICT, 0L).intValue())
                .dependencyIssueCount(counts.getOrDefault(WarningType.DEPENDENCY_ISSUE, 0L).intValue())
                .deadlineExceededCount(counts.getOrDefault(WarningType.DEADLINE_EXCEEDED, 0L).intValue())
                .orphanTaskCount(counts.getOrDefault(WarningType.ORPHAN_TASK, 0L).intValue())
                .dependencyRemovedCount(counts.getOrDefault(WarningType.DEPENDENCY_REMOVED, 0L).intValue())
                .unavailableDateCount(counts.getOrDefault(WarningType.UNAVAILABLE_DATE, 0L).intValue())
                .warnings(allWarnings)
                .build();
    }

    private WarningDto.Warning buildWarning(WarningType type, Task task, Project project, String message) {
        return WarningDto.Warning.builder()
                .type(type)
                .taskId(task.getId())
                .taskName(task.getName())
                .projectId(project.getId())
                .projectName(project.getName())
                .message(message)
                .assigneeId(task.getAssignee() != null ? task.getAssignee().getId() : null)
                .assigneeName(task.getAssignee() != null ? task.getAssignee().getName() : null)
                .build();
    }
}
