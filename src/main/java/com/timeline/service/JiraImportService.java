package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.repository.MemberRepository;
import com.timeline.domain.repository.ProjectRepository;
import com.timeline.domain.repository.TaskLinkRepository;
import com.timeline.domain.repository.TaskRepository;
import com.timeline.dto.JiraDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * Jira 이슈 Import/Sync 서비스
 * - JiraApiClient로 Board 이슈 수집
 * - Jira 이슈 -> Task 필드 매핑 (상태, 담당자, story_points)
 * - 프로젝트 내 기존 jiraKey 확인 후 CREATE / UPDATE 분기
 * - Preview 모드 지원 (DB 저장 없이 결과만 반환)
 *
 * 중요: TaskService를 경유하지 않고 TaskRepository를 직접 사용한다.
 * executionMode는 SEQUENTIAL로 고정한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class JiraImportService {

    private final JiraApiClient jiraApiClient;
    private final JiraConfigService jiraConfigService;
    private final TaskRepository taskRepository;
    private final TaskLinkRepository taskLinkRepository;
    private final ProjectRepository projectRepository;
    private final MemberRepository memberRepository;

    /** Jira 상태 -> TaskStatus 매핑 */
    private static final Map<String, TaskStatus> STATUS_MAP = Map.ofEntries(
            // 영문 상태명
            Map.entry("to do",       TaskStatus.TODO),
            Map.entry("open",        TaskStatus.TODO),
            Map.entry("backlog",     TaskStatus.TODO),
            Map.entry("in progress", TaskStatus.IN_PROGRESS),
            Map.entry("in review",   TaskStatus.IN_PROGRESS),
            Map.entry("done",        TaskStatus.COMPLETED),
            Map.entry("resolved",    TaskStatus.COMPLETED),
            Map.entry("closed",      TaskStatus.COMPLETED),
            Map.entry("hold",        TaskStatus.HOLD),
            Map.entry("on hold",     TaskStatus.HOLD),
            Map.entry("blocked",     TaskStatus.HOLD),
            Map.entry("cancelled",   TaskStatus.CANCELLED),
            Map.entry("won't do",    TaskStatus.CANCELLED),
            // 한글 상태명 (Jira Cloud 한국어 기본 워크플로)
            Map.entry("할 일",        TaskStatus.TODO),
            Map.entry("열려 있음",     TaskStatus.TODO),
            Map.entry("백로그",       TaskStatus.TODO),
            Map.entry("진행 중",      TaskStatus.IN_PROGRESS),
            Map.entry("검토 중",      TaskStatus.IN_PROGRESS),
            Map.entry("완료",         TaskStatus.COMPLETED),
            Map.entry("해결됨",       TaskStatus.COMPLETED),
            Map.entry("닫힘",         TaskStatus.COMPLETED),
            Map.entry("보류",         TaskStatus.HOLD),
            Map.entry("차단됨",       TaskStatus.HOLD),
            Map.entry("취소됨",       TaskStatus.CANCELLED),
            Map.entry("하지 않음",    TaskStatus.CANCELLED)
    );

    /**
     * Import Preview: DB 저장 없이 결과만 반환
     */
    @Transactional(readOnly = true)
    public JiraDto.PreviewResult preview(Long projectId, JiraDto.PreviewRequest request) {
        // 설정 + 프로젝트 검증
        JiraConfig config = getValidConfig();
        Project project = getValidProject(projectId);
        String boardId = resolveBoardId(
                (request != null) ? request.getJiraBoardId() : null, project);

        LocalDate createdAfter = (request != null) ? request.getCreatedAfter() : null;
        List<String> statusFilter = (request != null) ? request.getStatusFilter() : null;

        // Story Points 필드 ID 동적 탐지
        String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
                config.getBaseUrl(), config.getEmail(), config.getApiToken());

        // Jira 이슈 수집
        List<JiraDto.JiraIssue> issues = jiraApiClient.fetchAllBoardIssues(
                config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                boardId, createdAfter, statusFilter, storyPointsFieldId);

        // 기존 태스크 jiraKey 맵 조회
        Map<String, Task> existingTaskMap = buildExistingTaskMap(projectId);

        // 멤버 맵 (이름 + 이메일)
        MemberMaps memberMaps = buildMemberMaps();

        // Preview 항목 생성
        List<JiraDto.PreviewItem> items = new ArrayList<>();
        int toCreate = 0, toUpdate = 0, toSkip = 0;

        for (JiraDto.JiraIssue issue : issues) {
            String action;
            Task existing = existingTaskMap.get(issue.getKey());
            if (existing != null) {
                action = "UPDATE";
                toUpdate++;
            } else {
                action = "CREATE";
                toCreate++;
            }

            TaskStatus mappedStatus = mapStatus(issue.getStatus(), issue.getStatusCategoryKey());
            Member mappedMember = resolveMember(issue, memberMaps);

            items.add(JiraDto.PreviewItem.builder()
                    .jiraKey(issue.getKey())
                    .summary(issue.getSummary())
                    .jiraStatus(issue.getStatus())
                    .mappedStatus(mappedStatus.name())
                    .jiraAssignee(issue.getAssigneeDisplayName())
                    .mappedAssigneeId(mappedMember != null ? mappedMember.getId() : null)
                    .mappedAssigneeName(mappedMember != null ? mappedMember.getName() : null)
                    .action(action)
                    .existingProjectId(existing != null && existing.getProject() != null ? existing.getProject().getId() : null)
                    .build());
        }

        return JiraDto.PreviewResult.builder()
                .totalIssues(issues.size())
                .toCreate(toCreate)
                .toUpdate(toUpdate)
                .toSkip(toSkip)
                .issues(items)
                .build();
    }

    /**
     * Space Preview: Jira 프로젝트 키 기반 미리보기
     */
    @Transactional(readOnly = true)
    public JiraDto.PreviewResult previewBySpace(JiraDto.PreviewRequest request) {
        JiraConfig config = getValidConfig();
        String projectKey = request.getJiraProjectKey();
        String epicKey = request.getJiraEpicKey();
        if ((projectKey == null || projectKey.isBlank()) && (epicKey == null || epicKey.isBlank())) {
            throw new IllegalArgumentException("Jira 프로젝트 키 또는 Epic 키를 입력해주세요.");
        }

        String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
                config.getBaseUrl(), config.getEmail(), config.getApiToken());
        List<JiraDto.JiraIssue> issues;
        if (epicKey != null && !epicKey.isBlank()) {
            issues = jiraApiClient.fetchIssuesByEpicKey(
                    config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                    epicKey, request.getCreatedAfter(), request.getStatusFilter(), storyPointsFieldId);
        } else {
            issues = jiraApiClient.fetchIssuesByProjectKey(
                    config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                    projectKey, request.getCreatedAfter(), request.getStatusFilter(), storyPointsFieldId);
        }

        MemberMaps memberMaps = buildMemberMaps();

        // 전체 프로젝트의 기존 jiraKey 수집
        List<Task> allTasks = taskRepository.findAll();
        Map<String, Task> globalTaskMap = new HashMap<>();
        for (Task t : allTasks) {
            if (t.getJiraKey() != null && !t.getJiraKey().isBlank()) {
                globalTaskMap.put(t.getJiraKey(), t);
            }
        }

        List<JiraDto.PreviewItem> items = new ArrayList<>();
        int toCreate = 0, toUpdate = 0, toSkip = 0;
        for (JiraDto.JiraIssue issue : issues) {
            String action;
            Task existing = globalTaskMap.get(issue.getKey());
            if (existing != null) { action = "UPDATE"; toUpdate++; }
            else { action = "CREATE"; toCreate++; }

            TaskStatus mappedStatus = mapStatus(issue.getStatus(), issue.getStatusCategoryKey());
            Member mappedMember = resolveMember(issue, memberMaps);

            items.add(JiraDto.PreviewItem.builder()
                    .jiraKey(issue.getKey())
                    .summary(issue.getSummary())
                    .jiraStatus(issue.getStatus())
                    .mappedStatus(mappedStatus.name())
                    .jiraAssignee(issue.getAssigneeDisplayName())
                    .mappedAssigneeId(mappedMember != null ? mappedMember.getId() : null)
                    .mappedAssigneeName(mappedMember != null ? mappedMember.getName() : null)
                    .action(action)
                    .existingProjectId(existing != null && existing.getProject() != null ? existing.getProject().getId() : null)
                    .build());
        }

        return JiraDto.PreviewResult.builder()
                .totalIssues(issues.size())
                .toCreate(toCreate)
                .toUpdate(toUpdate)
                .toSkip(toSkip)
                .issues(items)
                .build();
    }

    /**
     * Space Import: Jira 프로젝트 키 기반 가져오기
     */
    @Transactional
    public JiraDto.ImportResult importBySpace(JiraDto.ImportRequest request) {
        JiraConfig config = getValidConfig();
        String projectKey = request.getJiraProjectKey();
        String epicKey = request.getJiraEpicKey();
        if ((projectKey == null || projectKey.isBlank()) && (epicKey == null || epicKey.isBlank())) {
            throw new IllegalArgumentException("Jira 프로젝트 키 또는 Epic 키를 입력해주세요.");
        }
        Long defaultProjectId = request.getDefaultProjectId();
        if (defaultProjectId == null) {
            defaultProjectId = getOrCreateUncategorizedProject();
        }

        String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
                config.getBaseUrl(), config.getEmail(), config.getApiToken());
        List<JiraDto.JiraIssue> issues;
        if (epicKey != null && !epicKey.isBlank()) {
            issues = jiraApiClient.fetchIssuesByEpicKey(
                    config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                    epicKey, request.getCreatedAfter(), request.getStatusFilter(), storyPointsFieldId);
        } else {
            issues = jiraApiClient.fetchIssuesByProjectKey(
                    config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                    projectKey, request.getCreatedAfter(), request.getStatusFilter(), storyPointsFieldId);
        }

        List<String> selectedKeys = request.getSelectedKeys();
        Map<String, Long> issueProjectMap = request.getIssueProjectMap();
        Set<String> selectedKeySet = (selectedKeys != null && !selectedKeys.isEmpty())
                ? new HashSet<>(selectedKeys) : null;

        Project defaultProject = getValidProject(defaultProjectId);
        Map<Long, Project> projectCache = new HashMap<>();
        projectCache.put(defaultProjectId, defaultProject);

        MemberMaps memberMaps = buildMemberMaps();

        int created = 0, updated = 0, skipped = 0;
        List<JiraDto.ImportError> errors = new ArrayList<>();
        List<Task> tasksToSave = new ArrayList<>();
        Set<Long> affectedProjectIds = new HashSet<>();
        affectedProjectIds.add(defaultProjectId);
        Map<Long, Map<String, Task>> existingTaskMapCache = new HashMap<>();

        for (JiraDto.JiraIssue issue : issues) {
            try {
                String jiraKey = issue.getKey();
                if (selectedKeySet != null && !selectedKeySet.contains(jiraKey)) {
                    skipped++;
                    continue;
                }
                if (jiraKey != null && jiraKey.length() > 50) {
                    jiraKey = jiraKey.substring(0, 50);
                }

                Long issueProjectId = (issueProjectMap != null && issueProjectMap.containsKey(jiraKey)
                        && issueProjectMap.get(jiraKey) != null)
                        ? issueProjectMap.get(jiraKey) : defaultProjectId;
                if (issueProjectId == null) {
                    skipped++;
                    continue;
                }
                Project issueProject = projectCache.computeIfAbsent(issueProjectId, this::getValidProject);
                affectedProjectIds.add(issueProjectId);

                Map<String, Task> existingTaskMap = existingTaskMapCache.computeIfAbsent(
                        issueProjectId, this::buildExistingTaskMap);
                Task existing = existingTaskMap.get(issue.getKey());
                Member mappedMember = resolveMember(issue, memberMaps);

                // Epic 이슈 처리: 새로 생성하지 않고, 기존 태스크가 있으면 공수 0으로
                if (isEpicIssue(issue)) {
                    if (existing != null) {
                        existing.setManDays(BigDecimal.ZERO);
                        existing.setJiraKey(jiraKey);
                        tasksToSave.add(existing);
                        updated++;
                    } else {
                        skipped++;
                    }
                    continue;
                }

                String taskName = truncate(issue.getSummary(), 300);
                if (taskName == null || taskName.isBlank()) {
                    taskName = issue.getKey();
                }

                if (existing != null) {
                    if (taskName != null && !taskName.isBlank()) existing.setName(taskName);
                    if (issue.getStatus() != null && !issue.getStatus().isBlank()) {
                        existing.setStatus(mapStatus(issue.getStatus(), issue.getStatusCategoryKey()));
                    }
                    if (mappedMember != null) existing.setAssignee(mappedMember);
                    if (issue.getStoryPoints() != null) existing.setManDays(issue.getStoryPoints());
                    if (issue.getDescription() != null) existing.setDescription(issue.getDescription());
                    existing.setJiraKey(jiraKey);
                    tasksToSave.add(existing);
                    updated++;
                } else {
                    TaskStatus mappedStatus = mapStatus(issue.getStatus(), issue.getStatusCategoryKey());
                    LocalDate endDate = resolveEndDateForCreate(issue);
                    LocalDate[] resolved = resolveDatePair(
                            issue.getStartDate(), endDate, issue.getKey(), issue.getStoryPoints());

                    Task newTask = Task.builder()
                            .project(issueProject)
                            .domainSystem(null)
                            .assignee(mappedMember)
                            .name(taskName)
                            .description(issue.getDescription())
                            .status(mappedStatus)
                            .executionMode(TaskExecutionMode.SEQUENTIAL)
                            .manDays(issue.getStoryPoints())
                            .startDate(resolved[0])
                            .endDate(resolved[1])
                            .jiraKey(jiraKey)
                            .build();
                    tasksToSave.add(newTask);
                    created++;
                }
            } catch (Exception e) {
                errors.add(JiraDto.ImportError.builder()
                        .jiraKey(issue.getKey())
                        .reason(e.getMessage())
                        .build());
            }
        }

        if (!tasksToSave.isEmpty()) {
            taskRepository.saveAllAndFlush(tasksToSave);
        }
        for (Long pid : affectedProjectIds) {
            assignOrderByStartDate(pid);
        }

        return JiraDto.ImportResult.builder()
                .created(created)
                .updated(updated)
                .skipped(skipped)
                .errors(errors)
                .build();
    }

    /**
     * Import 실행: Jira Board 이슈를 가져와 Task를 생성/업데이트
     */
    @Transactional
    public JiraDto.ImportResult importIssues(Long projectId, JiraDto.ImportRequest request) {
        // 설정 + 프로젝트 검증
        JiraConfig config = getValidConfig();
        Project project = getValidProject(projectId);
        String boardId = resolveBoardId(
                (request != null) ? request.getJiraBoardId() : null, project);

        LocalDate createdAfter = (request != null) ? request.getCreatedAfter() : null;
        List<String> statusFilter = (request != null) ? request.getStatusFilter() : null;
        List<String> selectedKeys = (request != null) ? request.getSelectedKeys() : null;
        Map<String, Long> issueProjectMap = (request != null) ? request.getIssueProjectMap() : null;
        Set<String> selectedKeySet = (selectedKeys != null && !selectedKeys.isEmpty())
                ? new HashSet<>(selectedKeys) : null;

        // Story Points 필드 ID 동적 탐지
        String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
                config.getBaseUrl(), config.getEmail(), config.getApiToken());

        // Jira 이슈 수집
        List<JiraDto.JiraIssue> issues = jiraApiClient.fetchAllBoardIssues(
                config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                boardId, createdAfter, statusFilter, storyPointsFieldId);

        // 프로젝트 캐시 (이슈별 프로젝트 지정 시)
        Map<Long, Project> projectCache = new HashMap<>();
        projectCache.put(projectId, project);

        // 멤버 맵 (이름 + 이메일)
        MemberMaps memberMaps = buildMemberMaps();

        int created = 0, updated = 0, skipped = 0;
        List<JiraDto.ImportError> errors = new ArrayList<>();
        List<Task> tasksToSave = new ArrayList<>();
        Set<Long> affectedProjectIds = new HashSet<>();
        affectedProjectIds.add(projectId);
        Map<Long, Map<String, Task>> existingTaskMapCache = new HashMap<>();

        for (JiraDto.JiraIssue issue : issues) {
            try {
                // jiraKey 길이 검증 (DB column: VARCHAR(50))
                String jiraKey = issue.getKey();

                // 선택된 이슈만 처리 (selectedKeys가 있으면 해당 키만)
                if (selectedKeySet != null && !selectedKeySet.contains(jiraKey)) {
                    skipped++;
                    continue;
                }

                if (jiraKey != null && jiraKey.length() > 50) {
                    jiraKey = jiraKey.substring(0, 50);
                    log.warn("Jira 이슈 {} 의 jiraKey가 50자를 초과하여 잘림: {}", issue.getKey(), jiraKey);
                }

                // 이슈별 프로젝트 결정
                Long issueProjectId = (issueProjectMap != null && issueProjectMap.containsKey(jiraKey))
                        ? issueProjectMap.get(jiraKey) : projectId;
                Project issueProject = projectCache.computeIfAbsent(issueProjectId, this::getValidProject);
                affectedProjectIds.add(issueProjectId);

                // 해당 프로젝트의 기존 태스크 맵 조회 (캐시)
                Map<String, Task> existingTaskMap = existingTaskMapCache.computeIfAbsent(
                        issueProjectId, this::buildExistingTaskMap);
                Task existing = existingTaskMap.get(issue.getKey());
                Member mappedMember = resolveMember(issue, memberMaps);

                // Epic 이슈 처리: 새로 생성하지 않고, 기존 태스크가 있으면 공수 0으로
                if (isEpicIssue(issue)) {
                    if (existing != null) {
                        existing.setManDays(BigDecimal.ZERO);
                        existing.setJiraKey(jiraKey);
                        tasksToSave.add(existing);
                        updated++;
                        log.debug("Epic 이슈 공수 0으로 업데이트: {}", issue.getKey());
                    } else {
                        skipped++;
                        log.debug("Epic 이슈 스킵 (신규 생성 안 함): {}", issue.getKey());
                    }
                    continue;
                }

                String taskName = truncate(issue.getSummary(), 300);
                if (taskName == null || taskName.isBlank()) {
                    taskName = issue.getKey(); // summary가 없으면 Jira Key를 이름으로 사용
                }

                if (existing != null) {
                    // ---- UPDATE 분기: null/empty 필드는 기존 태스크 값 유지 ----

                    // name: null/blank이면 기존 값 유지
                    if (taskName != null && !taskName.isBlank()) {
                        existing.setName(taskName);
                    }

                    // status: Jira status 원문이 null/blank이면 기존 값 유지
                    if (issue.getStatus() != null && !issue.getStatus().isBlank()) {
                        existing.setStatus(mapStatus(issue.getStatus(), issue.getStatusCategoryKey()));
                    }

                    // assignee: Jira assignee가 null이면 기존 값 유지
                    // displayName 또는 email 중 하나라도 있으면 담당자가 배정된 것으로 간주
                    if (issue.getAssigneeDisplayName() != null || issue.getAssigneeEmail() != null) {
                        existing.setAssignee(mappedMember);
                    }

                    // manDays: null이면 기존 값 유지
                    if (issue.getStoryPoints() != null) {
                        existing.setManDays(issue.getStoryPoints());
                    }

                    // description: null이면 기존 값 유지
                    if (issue.getDescription() != null) {
                        existing.setDescription(issue.getDescription());
                    }

                    // startDate: null이면 기존 값 유지
                    LocalDate startDate = issue.getStartDate() != null
                            ? issue.getStartDate() : existing.getStartDate();

                    // endDate 폴백: dueDate -> resolutionDate -> 기존 값 유지
                    LocalDate endDate = resolveEndDateForUpdate(issue, existing);

                    LocalDate[] resolved = resolveDatePair(startDate, endDate, issue.getKey(), issue.getStoryPoints());
                    existing.setStartDate(resolved[0]);
                    existing.setEndDate(resolved[1]);

                    existing.setJiraKey(jiraKey);

                    // executionMode는 기존 값 유지 (이미 설정된 모드를 덮어쓰지 않음)
                    tasksToSave.add(existing);
                    updated++;
                    log.debug("Jira 이슈 업데이트: {} -> taskId={}", issue.getKey(), existing.getId());
                } else {
                    // ---- CREATE 분기: null이면 null 또는 기존 fallback 적용 ----
                    TaskStatus mappedStatus = mapStatus(issue.getStatus(), issue.getStatusCategoryKey());

                    // endDate 폴백: dueDate -> resolutionDate -> null
                    LocalDate endDate = resolveEndDateForCreate(issue);

                    LocalDate[] resolved = resolveDatePair(
                            issue.getStartDate(), endDate, issue.getKey(), issue.getStoryPoints());

                    Task newTask = Task.builder()
                            .project(issueProject)
                            .domainSystem(null)
                            .assignee(mappedMember)
                            .name(taskName)
                            .description(issue.getDescription())
                            .status(mappedStatus)
                            .executionMode(TaskExecutionMode.SEQUENTIAL)
                            .manDays(issue.getStoryPoints())
                            .startDate(resolved[0])
                            .endDate(resolved[1])
                            .jiraKey(jiraKey)
                            .build();
                    tasksToSave.add(newTask);
                    created++;
                    log.debug("Jira 이슈 신규 생성: {}", issue.getKey());
                }
            } catch (Exception e) {
                errors.add(JiraDto.ImportError.builder()
                        .jiraKey(issue.getKey())
                        .reason(e.getMessage())
                        .build());
                log.warn("Jira 이슈 Import 실패: {}, 오류: {}", issue.getKey(), e.getMessage());
            }
        }

        // 배치 저장 (flush 필수: 후속 saveIssueLinks에서 신규 태스크의 ID가 필요)
        if (!tasksToSave.isEmpty()) {
            taskRepository.saveAllAndFlush(tasksToSave);
        }

        // 담당자별 assigneeOrder 자동 부여 (시작일 기준 정렬) — 영향받은 모든 프로젝트
        for (Long pid : affectedProjectIds) {
            assignOrderByStartDate(pid);
        }

        // issuelinks -> TaskLink 저장 (FR-007)
        int issueLinksCreated = saveIssueLinks(tasksToSave, issues, config);

        log.info("Jira Import 완료: projectId={}, created={}, updated={}, skipped={}, errors={}, issueLinksCreated={}",
                projectId, created, updated, skipped, errors.size(), issueLinksCreated);

        return JiraDto.ImportResult.builder()
                .created(created)
                .updated(updated)
                .skipped(skipped)
                .issueLinksCreated(issueLinksCreated)
                .errors(errors)
                .build();
    }

    // ---- issuelinks -> TaskLink 저장 (FR-007) ----

    /**
     * 저장된 태스크와 대응하는 Jira 이슈의 issueLinks를 TaskLink로 변환하여 저장한다.
     * - 재import 시 중복 방지: 해당 태스크의 기존 TaskLink를 모두 삭제 후 재등록
     * - 태스크당 최대 10개 제한, 초과 시 경고 로그
     * - 저장 실패는 개별 처리 (전체 Import 롤백 안 함)
     */
    private int saveIssueLinks(List<Task> savedTasks, List<JiraDto.JiraIssue> issues, JiraConfig config) {
        // jiraKey -> Task 맵 구성 (savedTasks 기준)
        Map<String, Task> savedTaskMap = new HashMap<>();
        for (Task task : savedTasks) {
            if (task.getJiraKey() != null && !task.getJiraKey().isBlank()) {
                savedTaskMap.put(task.getJiraKey(), task);
            }
        }

        // 삭제 대상 taskId 수집 (issueLinks가 있는 태스크만)
        List<Long> taskIdsToDelete = new ArrayList<>();
        for (JiraDto.JiraIssue issue : issues) {
            if (issue.getIssueLinks() == null || issue.getIssueLinks().isEmpty()) continue;
            Task task = savedTaskMap.get(issue.getKey());
            if (task != null && task.getId() != null) {
                taskIdsToDelete.add(task.getId());
            }
        }

        // 기존 TaskLink 일괄 삭제 + flush (후속 insert와 충돌 방지)
        if (!taskIdsToDelete.isEmpty()) {
            taskLinkRepository.deleteByTaskIdIn(taskIdsToDelete);
            taskLinkRepository.flush();
        }

        // 새 TaskLink 일괄 수집
        List<TaskLink> linksToSave = new ArrayList<>();

        for (JiraDto.JiraIssue issue : issues) {
            if (issue.getIssueLinks() == null || issue.getIssueLinks().isEmpty()) continue;

            Task task = savedTaskMap.get(issue.getKey());
            if (task == null || task.getId() == null) continue;

            int linkCount = 0;
            for (JiraDto.JiraIssueLink issueLink : issue.getIssueLinks()) {
                if (linkCount >= 10) {
                    log.warn("태스크 {} (jiraKey={}) issuelinks 10개 초과, 이후 링크 skip", task.getId(), issue.getKey());
                    break;
                }
                try {
                    // linkedKey 검증: Jira 키 형식(영숫자, 하이픈, 언더스코어)만 허용
                    String linkedKey = issueLink.getLinkedKey();
                    if (linkedKey == null || !linkedKey.matches("^[A-Za-z0-9_\\-]+$")) {
                        log.warn("유효하지 않은 linkedKey (skip): taskId={}, linkedKey={}", task.getId(), linkedKey);
                        continue;
                    }

                    String url = config.getBaseUrl() + "/browse/" + linkedKey;
                    String linkType = (issueLink.getType() != null && !issueLink.getType().isBlank())
                            ? issueLink.getType() : "relates to";
                    String label = truncate(linkType + " " + linkedKey, 200);

                    linksToSave.add(TaskLink.builder()
                            .task(task)
                            .url(url)
                            .label(label)
                            .build());
                    linkCount++;
                } catch (Exception e) {
                    log.warn("TaskLink 생성 실패 (taskId={}, linkedKey={}): {}",
                            task.getId(), issueLink.getLinkedKey(), e.getMessage());
                }
            }
        }

        // 일괄 저장 (N+1 방지)
        if (!linksToSave.isEmpty()) {
            taskLinkRepository.saveAll(linksToSave);
        }

        return linksToSave.size();
    }

    // ---- endDate 폴백 로직 ----

    /**
     * UPDATE 분기에서 endDate 결정 순서:
     * 1. dueDate가 null이 아니면 사용
     * 2. null이면 resolutionDate 시도
     * 3. 모두 null이면 기존 existing.getEndDate() 유지
     */
    private LocalDate resolveEndDateForUpdate(JiraDto.JiraIssue issue, Task existing) {
        if (issue.getDueDate() != null) {
            return issue.getDueDate();
        }
        if (issue.getResolutionDate() != null) {
            return issue.getResolutionDate();
        }
        return existing.getEndDate();
    }

    /**
     * CREATE 분기에서 endDate 결정 순서:
     * 1. dueDate가 null이 아니면 사용
     * 2. null이면 resolutionDate 시도
     * 3. 모두 null이면 null 그대로 전달 (resolveDatePair가 startDate로 채움)
     */
    private LocalDate resolveEndDateForCreate(JiraDto.JiraIssue issue) {
        if (issue.getDueDate() != null) {
            return issue.getDueDate();
        }
        if (issue.getResolutionDate() != null) {
            return issue.getResolutionDate();
        }
        return null;
    }

    // ---- Private 메서드 ----

    /**
     * Jira 설정 검증 및 반환
     */
    private Long getOrCreateUncategorizedProject() {
        return projectRepository.findAll().stream()
                .filter(p -> "미분류".equals(p.getName()))
                .findFirst()
                .map(Project::getId)
                .orElseGet(() -> {
                    Project p = Project.builder()
                            .name("미분류")
                            .status(com.timeline.domain.enums.ProjectStatus.IN_PROGRESS)
                            .startDate(java.time.LocalDate.now())
                            .endDate(java.time.LocalDate.now().plusMonths(3))
                            .build();
                    return projectRepository.save(p).getId();
                });
    }

    private JiraConfig getValidConfig() {
        return jiraConfigService.getRawConfig()
                .orElseThrow(() -> new IllegalStateException("Jira 설정이 되어있지 않습니다. 설정 > Jira 연동에서 먼저 설정해주세요."));
    }

    /**
     * 프로젝트 조회
     */
    private Project getValidProject(Long projectId) {
        return projectRepository.findById(projectId)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + projectId));
    }

    /**
     * Board ID 해결: 요청 값 우선, 없으면 프로젝트 설정값 사용
     */
    private String resolveBoardId(String requestBoardId, Project project) {
        if (requestBoardId != null && !requestBoardId.isBlank()) {
            return requestBoardId.trim();
        }
        if (project.getJiraBoardId() != null && !project.getJiraBoardId().isBlank()) {
            return project.getJiraBoardId();
        }
        throw new IllegalArgumentException("Jira Board ID를 입력해주세요.");
    }

    /**
     * 프로젝트 내 태스크를 담당자별로 그룹핑하여 시작일 기준 assigneeOrder 부여
     */
    private void assignOrderByStartDate(Long projectId) {
        List<Task> allTasks = taskRepository.findByProjectId(projectId);

        // 담당자별 SEQUENTIAL 활성 태스크 그룹핑
        Map<Long, List<Task>> byAssignee = new LinkedHashMap<>();
        for (Task t : allTasks) {
            if (t.getAssignee() == null) continue;
            if (t.getExecutionMode() != TaskExecutionMode.SEQUENTIAL) continue;
            if (t.getStatus() == TaskStatus.HOLD || t.getStatus() == TaskStatus.CANCELLED) continue;
            byAssignee.computeIfAbsent(t.getAssignee().getId(), k -> new ArrayList<>()).add(t);
        }

        List<Task> toUpdate = new ArrayList<>();
        for (List<Task> tasks : byAssignee.values()) {
            tasks.sort(Comparator.comparing(
                    (Task t) -> t.getStartDate() != null ? t.getStartDate() : LocalDate.MAX)
                    .thenComparing(t -> t.getEndDate() != null ? t.getEndDate() : LocalDate.MAX));
            int order = 1;
            for (Task t : tasks) {
                t.setAssigneeOrder(order++);
                toUpdate.add(t);
            }
        }

        if (!toUpdate.isEmpty()) {
            taskRepository.saveAll(toUpdate);
            log.info("Jira Import 후 assigneeOrder 자동 부여: projectId={}, 대상 태스크={}건", projectId, toUpdate.size());
        }
    }

    /**
     * 프로젝트 내 기존 태스크의 jiraKey 맵 생성
     */
    private Map<String, Task> buildExistingTaskMap(Long projectId) {
        List<Task> existingTasks = taskRepository.findByProjectId(projectId);
        Map<String, Task> map = new HashMap<>();
        for (Task task : existingTasks) {
            if (task.getJiraKey() != null && !task.getJiraKey().isBlank()) {
                map.put(task.getJiraKey(), task);
            }
        }
        return map;
    }

    /**
     * 멤버 이름 맵 (소문자 키)과 이메일 맵을 함께 반환
     */
    private static class MemberMaps {
        final Map<String, Member> byName;
        final Map<String, Member> byEmail;

        MemberMaps(Map<String, Member> byName, Map<String, Member> byEmail) {
            this.byName = byName;
            this.byEmail = byEmail;
        }
    }

    private MemberMaps buildMemberMaps() {
        List<Member> members = memberRepository.findByActiveTrue();
        Map<String, Member> byName = new HashMap<>();
        Map<String, Member> byEmail = new HashMap<>();
        for (Member m : members) {
            if (m.getName() != null) {
                byName.putIfAbsent(m.getName().toLowerCase(), m);
            }
            if (m.getEmail() != null && !m.getEmail().isBlank()) {
                byEmail.putIfAbsent(m.getEmail().toLowerCase(), m);
            }
        }
        return new MemberMaps(byName, byEmail);
    }

    /**
     * displayName -> email 순으로 Member를 찾는다.
     */
    private Member resolveMember(JiraDto.JiraIssue issue, MemberMaps maps) {
        if (issue.getAssigneeDisplayName() != null) {
            Member m = maps.byName.get(issue.getAssigneeDisplayName().toLowerCase());
            if (m != null) return m;
        }
        if (issue.getAssigneeEmail() != null) {
            Member m = maps.byEmail.get(issue.getAssigneeEmail().toLowerCase());
            if (m != null) {
                log.debug("Jira 담당자 이메일로 매핑: displayName='{}', email='{}' -> memberId={}",
                        issue.getAssigneeDisplayName(), issue.getAssigneeEmail(), m.getId());
                return m;
            }
        }
        if (issue.getAssigneeDisplayName() != null || issue.getAssigneeEmail() != null) {
            log.debug("Jira 담당자 매핑 실패: displayName='{}', email='{}'",
                    issue.getAssigneeDisplayName(), issue.getAssigneeEmail());
        }
        return null;
    }

    /** statusCategoryKey -> TaskStatus 폴백 매핑 (커스텀 워크플로 대응) */
    private static final Map<String, TaskStatus> STATUS_CATEGORY_KEY_MAP = Map.of(
            "new",           TaskStatus.TODO,
            "indeterminate", TaskStatus.IN_PROGRESS,
            "done",          TaskStatus.COMPLETED
    );

    /**
     * Jira 상태 -> TaskStatus 매핑
     * 1차: status 이름(STATUS_MAP) 기반 매핑
     * 2차 폴백: statusCategoryKey 기반 매핑 (커스텀 워크플로 대응)
     * 3차 폴백: TODO
     */
    private TaskStatus mapStatus(String jiraStatus, String statusCategoryKey) {
        if (jiraStatus != null && !jiraStatus.isBlank()) {
            TaskStatus mapped = STATUS_MAP.get(jiraStatus.toLowerCase().trim());
            if (mapped != null) {
                return mapped;
            }
        }
        // statusCategoryKey 폴백: 커스텀 상태명이라도 카테고리 기반으로 정확히 매핑
        if (statusCategoryKey != null && !statusCategoryKey.isBlank()) {
            TaskStatus fallback = STATUS_CATEGORY_KEY_MAP.get(statusCategoryKey.toLowerCase().trim());
            if (fallback != null) {
                log.debug("Jira 상태 '{}' 이름 매핑 실패 → statusCategoryKey '{}' 폴백 적용: {}", jiraStatus, statusCategoryKey, fallback);
                return fallback;
            }
        }
        return TaskStatus.TODO;
    }

    /**
     * startDate/endDate 쌍을 함께 resolve하여 일관성을 보장한다.
     * - 둘 다 null: 둘 다 today
     * - startDate만 null: startDate = endDate
     * - endDate만 null: endDate = startDate
     * - endDate < startDate: endDate = startDate (역전 방지)
     * LocalDate.now()는 최대 1회만 호출하여 자정 경계 불일치를 방지한다.
     *
     * @return LocalDate[2] = {startDate, endDate}
     */
    private LocalDate[] resolveDatePair(LocalDate startDate, LocalDate endDate, String jiraKey, BigDecimal manDays) {
        if (startDate == null && endDate == null) {
            LocalDate today = LocalDate.now();
            log.warn("Jira 이슈 {} 의 startDate, endDate 가 모두 null이어서 오늘 날짜({})로 대체합니다.",
                    jiraKey, today);
            startDate = today;
            endDate = today;
        }
        if (startDate == null) {
            startDate = endDate;
        }
        if (endDate == null) {
            endDate = startDate;
        }
        if (endDate.isBefore(startDate)) {
            endDate = startDate;
        }
        // startDate == endDate이고 manDays > 1이면 영업일 기준으로 endDate 보정
        if (startDate.equals(endDate) && manDays != null && manDays.intValue() > 1) {
            endDate = addBusinessDays(startDate, manDays.intValue() - 1);
        }
        return new LocalDate[]{startDate, endDate};
    }

    /**
     * 영업일(평일) 기준 날짜 더하기
     */
    private LocalDate addBusinessDays(LocalDate from, int days) {
        LocalDate d = from;
        int added = 0;
        while (added < days) {
            d = d.plusDays(1);
            if (d.getDayOfWeek() != java.time.DayOfWeek.SATURDAY
                    && d.getDayOfWeek() != java.time.DayOfWeek.SUNDAY) {
                added++;
            }
        }
        return d;
    }

    /**
     * Epic 이슈 여부 판별
     */
    private boolean isEpicIssue(JiraDto.JiraIssue issue) {
        return issue.getIssueType() != null && issue.getIssueType().equalsIgnoreCase("Epic");
    }

    /**
     * 문자열 truncate
     */
    private String truncate(String s, int maxLen) {
        if (s == null) return null;
        return s.length() > maxLen ? s.substring(0, maxLen) : s;
    }
}
