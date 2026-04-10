package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.repository.*;
import com.timeline.dto.GanttDataDto;
import com.timeline.dto.TaskDto;
import com.timeline.exception.AssigneeConflictException;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 태스크 CRUD + 의존관계 + 간트차트 데이터 + 담당자 충돌 검증 + 링크 관리 서비스
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
    private final DomainSystemRepository domainSystemRepository;
    private final MemberRepository memberRepository;

    /**
     * 간트차트용 프로젝트 태스크 조회 (도메인 시스템별 그룹핑)
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

        // 도메인 시스템별 그룹핑 (LinkedHashMap으로 순서 유지)
        Map<Long, List<Task>> groupedByDomainSystem = new LinkedHashMap<>();
        for (Task task : tasks) {
            groupedByDomainSystem
                    .computeIfAbsent(task.getDomainSystem().getId(), k -> new ArrayList<>())
                    .add(task);
        }

        // GanttDataDto 변환
        List<GanttDataDto.DomainSystemGroup> domainSystemGroups = groupedByDomainSystem.entrySet().stream()
                .map(entry -> {
                    Task firstTask = entry.getValue().get(0);
                    DomainSystem ds = firstTask.getDomainSystem();

                    List<GanttDataDto.TaskItem> taskItems = entry.getValue().stream()
                            .map(task -> GanttDataDto.TaskItem.builder()
                                    .id(task.getId())
                                    .name(task.getName())
                                    .assignee(task.getAssignee() != null
                                            ? GanttDataDto.AssigneeSummary.builder()
                                                    .id(task.getAssignee().getId())
                                                    .name(task.getAssignee().getName())
                                                    .role(task.getAssignee().getRole())
                                                    .build()
                                            : null)
                                    .startDate(task.getStartDate())
                                    .endDate(task.getEndDate())
                                    .manDays(task.getManDays())
                                    .status(task.getStatus())
                                    .sortOrder(task.getSortOrder())
                                    .dependencies(dependencyMap.getOrDefault(task.getId(), List.of()))
                                    .executionMode(task.getExecutionMode())
                                    .build())
                            .collect(Collectors.toList());

                    return GanttDataDto.DomainSystemGroup.builder()
                            .id(ds.getId())
                            .name(ds.getName())
                            .color(ds.getColor())
                            .tasks(taskItems)
                            .build();
                })
                .collect(Collectors.toList());

        return GanttDataDto.Response.builder()
                .project(GanttDataDto.ProjectSummary.builder()
                        .id(project.getId())
                        .name(project.getName())
                        .startDate(project.getStartDate())
                        .endDate(project.getEndDate())
                        .build())
                .domainSystems(domainSystemGroups)
                .build();
    }

    /**
     * 태스크 상세 조회 (링크 포함)
     */
    public TaskDto.Response getTask(Long taskId) {
        Task task = taskRepository.findByIdWithDetails(taskId)
                .orElseThrow(() -> new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId));

        List<Long> dependencies = taskDependencyRepository.findByTaskIdWithDependsOnTask(taskId).stream()
                .map(td -> td.getDependsOnTask().getId())
                .collect(Collectors.toList());

        List<TaskLink> links = taskLinkRepository.findByTaskIdOrderByCreatedAtAsc(taskId);

        return TaskDto.Response.from(task, dependencies, links);
    }

    /**
     * 태스크 생성
     */
    @Transactional
    public TaskDto.Response createTask(Long projectId, TaskDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("태스크명은 필수입니다.");
        }
        if (request.getName().length() > 300) {
            throw new IllegalArgumentException("태스크명은 300자를 초과할 수 없습니다.");
        }
        if (request.getDomainSystemId() == null) {
            throw new IllegalArgumentException("도메인 시스템은 필수입니다.");
        }
        if (request.getStartDate() == null || request.getEndDate() == null) {
            throw new IllegalArgumentException("시작일과 종료일은 필수입니다.");
        }
        if (request.getStartDate().isAfter(request.getEndDate())) {
            throw new IllegalArgumentException("시작일은 종료일보다 이후일 수 없습니다.");
        }

        // 실행 모드 결정 (null이면 SEQUENTIAL 기본값)
        TaskExecutionMode executionMode = request.getExecutionMode() != null
                ? request.getExecutionMode() : TaskExecutionMode.SEQUENTIAL;

        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + projectId));

        DomainSystem domainSystem = domainSystemRepository.findById(request.getDomainSystemId())
                .orElseThrow(() -> new EntityNotFoundException(
                        "도메인 시스템을 찾을 수 없습니다. id=" + request.getDomainSystemId()));

        Member assignee = null;
        if (request.getAssigneeId() != null) {
            assignee = memberRepository.findById(request.getAssigneeId())
                    .orElseThrow(() -> new EntityNotFoundException(
                            "멤버를 찾을 수 없습니다. id=" + request.getAssigneeId()));

            // SEQUENTIAL 모드인 경우에만 담당자 일정 충돌 검증
            if (executionMode == TaskExecutionMode.SEQUENTIAL) {
                validateAssigneeConflict(assignee, request.getStartDate(), request.getEndDate(), null);
            }
        }

        Task.TaskBuilder taskBuilder = Task.builder()
                .project(project)
                .domainSystem(domainSystem)
                .assignee(assignee)
                .name(request.getName())
                .description(request.getDescription())
                .startDate(request.getStartDate())
                .endDate(request.getEndDate())
                .manDays(request.getManDays())
                .sortOrder(request.getSortOrder())
                .executionMode(executionMode);

        // status가 null이면 @Builder.Default(PENDING)가 적용됨
        if (request.getStatus() != null) {
            taskBuilder.status(request.getStatus());
        }

        Task task = taskBuilder.build();
        Task saved = taskRepository.save(task);

        // 링크 저장
        List<TaskLink> savedLinks = saveTaskLinks(saved, request.getLinks());

        log.info("태스크 생성 완료: id={}, name={}, projectId={}, executionMode={}",
                saved.getId(), saved.getName(), projectId, executionMode);
        return TaskDto.Response.from(saved, List.of(), savedLinks);
    }

    /**
     * 태스크 수정
     */
    @Transactional
    public TaskDto.Response updateTask(Long taskId, TaskDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("태스크명은 필수입니다.");
        }
        if (request.getName().length() > 300) {
            throw new IllegalArgumentException("태스크명은 300자를 초과할 수 없습니다.");
        }
        if (request.getDomainSystemId() == null) {
            throw new IllegalArgumentException("도메인 시스템은 필수입니다.");
        }
        if (request.getStartDate() == null || request.getEndDate() == null) {
            throw new IllegalArgumentException("시작일과 종료일은 필수입니다.");
        }
        if (request.getStartDate().isAfter(request.getEndDate())) {
            throw new IllegalArgumentException("시작일은 종료일보다 이후일 수 없습니다.");
        }

        // 실행 모드 결정
        TaskExecutionMode executionMode = request.getExecutionMode() != null
                ? request.getExecutionMode() : TaskExecutionMode.SEQUENTIAL;

        Task task = taskRepository.findByIdWithDetails(taskId)
                .orElseThrow(() -> new EntityNotFoundException("태스크를 찾을 수 없습니다. id=" + taskId));

        DomainSystem domainSystem = domainSystemRepository.findById(request.getDomainSystemId())
                .orElseThrow(() -> new EntityNotFoundException(
                        "도메인 시스템을 찾을 수 없습니다. id=" + request.getDomainSystemId()));

        Member assignee = null;
        if (request.getAssigneeId() != null) {
            assignee = memberRepository.findById(request.getAssigneeId())
                    .orElseThrow(() -> new EntityNotFoundException(
                            "멤버를 찾을 수 없습니다. id=" + request.getAssigneeId()));

            // SEQUENTIAL 모드인 경우에만 담당자 일정 충돌 검증 (자기 자신 제외)
            if (executionMode == TaskExecutionMode.SEQUENTIAL) {
                validateAssigneeConflict(assignee, request.getStartDate(), request.getEndDate(), taskId);
            }
        }

        task.setDomainSystem(domainSystem);
        task.setAssignee(assignee);
        task.setName(request.getName());
        task.setDescription(request.getDescription());
        task.setStartDate(request.getStartDate());
        task.setEndDate(request.getEndDate());
        task.setManDays(request.getManDays());
        task.setExecutionMode(executionMode);
        if (request.getStatus() != null) {
            task.setStatus(request.getStatus());
        }
        task.setSortOrder(request.getSortOrder());

        Task updated = taskRepository.save(task);

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

        log.info("태스크 수정 완료: id={}, name={}, executionMode={}", updated.getId(), updated.getName(), executionMode);
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

    // ---- Private 메서드 ----

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
                TaskExecutionMode.SEQUENTIAL);

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
     * 태스크 링크 목록 저장
     * - 개수 제한 검증 (10개)
     * - URL이 비어 있는 항목은 skip
     * - 라벨 미입력 시 URL 앞 50자를 라벨로 자동 설정
     */
    private List<TaskLink> saveTaskLinks(Task task, List<TaskDto.TaskLinkRequest> linkRequests) {
        if (linkRequests == null || linkRequests.isEmpty()) {
            return List.of();
        }

        // URL이 비어 있는 항목 필터링
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
     * 링크 URL 검증
     * - http:// 또는 https:// 프로토콜만 허용 (javascript:, data: 등 방지)
     * - 최대 2000자 제한
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
