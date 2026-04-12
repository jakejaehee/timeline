package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.repository.MemberRepository;
import com.timeline.domain.repository.ProjectDomainSystemRepository;
import com.timeline.domain.repository.ProjectRepository;
import com.timeline.domain.repository.TaskLinkRepository;
import com.timeline.domain.repository.TaskRepository;
import com.timeline.dto.JiraDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final ProjectDomainSystemRepository projectDomainSystemRepository;

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
        validateBoardId(project);

        LocalDate createdAfter = (request != null) ? request.getCreatedAfter() : null;
        List<String> statusFilter = (request != null) ? request.getStatusFilter() : null;

        // Story Points 필드 ID 동적 탐지
        String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
                config.getBaseUrl(), config.getEmail(), config.getApiToken());

        // Jira 이슈 수집
        List<JiraDto.JiraIssue> issues = jiraApiClient.fetchAllBoardIssues(
                config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                project.getJiraBoardId(), createdAfter, statusFilter, storyPointsFieldId);

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
     * Import 실행: Jira Board 이슈를 가져와 Task를 생성/업데이트
     */
    @Transactional
    public JiraDto.ImportResult importIssues(Long projectId, JiraDto.ImportRequest request) {
        // 설정 + 프로젝트 검증
        JiraConfig config = getValidConfig();
        Project project = getValidProject(projectId);
        validateBoardId(project);

        LocalDate createdAfter = (request != null) ? request.getCreatedAfter() : null;
        List<String> statusFilter = (request != null) ? request.getStatusFilter() : null;

        // 프로젝트에 연결된 첫 번째 domainSystem (필수)
        DomainSystem defaultDomainSystem = getDefaultDomainSystem(projectId);

        // Story Points 필드 ID 동적 탐지
        String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
                config.getBaseUrl(), config.getEmail(), config.getApiToken());

        // Jira 이슈 수집
        List<JiraDto.JiraIssue> issues = jiraApiClient.fetchAllBoardIssues(
                config.getBaseUrl(), config.getEmail(), config.getApiToken(),
                project.getJiraBoardId(), createdAfter, statusFilter, storyPointsFieldId);

        // 기존 태스크 jiraKey 맵
        Map<String, Task> existingTaskMap = buildExistingTaskMap(projectId);

        // 멤버 맵 (이름 + 이메일)
        MemberMaps memberMaps = buildMemberMaps();

        int created = 0, updated = 0, skipped = 0;
        List<JiraDto.ImportError> errors = new ArrayList<>();
        List<Task> tasksToSave = new ArrayList<>();

        for (JiraDto.JiraIssue issue : issues) {
            try {
                // jiraKey 길이 검증 (DB column: VARCHAR(50))
                String jiraKey = issue.getKey();
                if (jiraKey != null && jiraKey.length() > 50) {
                    jiraKey = jiraKey.substring(0, 50);
                    log.warn("Jira 이슈 {} 의 jiraKey가 50자를 초과하여 잘림: {}", issue.getKey(), jiraKey);
                }

                Task existing = existingTaskMap.get(issue.getKey());
                Member mappedMember = resolveMember(issue, memberMaps);

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

                    LocalDate[] resolved = resolveDatePair(startDate, endDate, issue.getKey());
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
                            issue.getStartDate(), endDate, issue.getKey());

                    Task newTask = Task.builder()
                            .project(project)
                            .domainSystem(defaultDomainSystem)
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
     * Board ID 검증
     */
    private void validateBoardId(Project project) {
        if (project.getJiraBoardId() == null || project.getJiraBoardId().isBlank()) {
            throw new IllegalArgumentException("프로젝트에 Jira Board ID가 설정되어 있지 않습니다. 프로젝트 수정에서 Board ID를 입력해주세요.");
        }
    }

    /**
     * 프로젝트에 연결된 첫 번째 도메인 시스템 조회
     */
    private DomainSystem getDefaultDomainSystem(Long projectId) {
        List<ProjectDomainSystem> pdsList = projectDomainSystemRepository.findByProjectIdWithDomainSystem(projectId);
        if (pdsList.isEmpty()) {
            throw new IllegalStateException("프로젝트에 도메인 시스템이 등록되어 있지 않습니다. 프로젝트에 도메인 시스템을 먼저 추가해주세요.");
        }
        // ID 오름차순 기준 첫 번째
        pdsList.sort(Comparator.comparingLong(ProjectDomainSystem::getId));
        return pdsList.get(0).getDomainSystem();
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
    private LocalDate[] resolveDatePair(LocalDate startDate, LocalDate endDate, String jiraKey) {
        if (startDate == null && endDate == null) {
            LocalDate today = LocalDate.now();
            log.warn("Jira 이슈 {} 의 startDate, endDate 가 모두 null이어서 오늘 날짜({})로 대체합니다.",
                    jiraKey, today);
            return new LocalDate[]{today, today};
        }
        if (startDate == null) {
            log.warn("Jira 이슈 {} 의 startDate 가 null이어서 endDate({})로 대체합니다.",
                    jiraKey, endDate);
            startDate = endDate;
        }
        if (endDate == null) {
            log.warn("Jira 이슈 {} 의 endDate 가 null이어서 startDate({})로 대체합니다.",
                    jiraKey, startDate);
            endDate = startDate;
        }
        if (endDate.isBefore(startDate)) {
            log.warn("Jira 이슈 {} 의 endDate({})가 startDate({}) 이전이어서 startDate로 보정합니다.",
                    jiraKey, endDate, startDate);
            endDate = startDate;
        }
        return new LocalDate[]{startDate, endDate};
    }

    /**
     * 문자열 truncate
     */
    private String truncate(String s, int maxLen) {
        if (s == null) return null;
        return s.length() > maxLen ? s.substring(0, maxLen) : s;
    }
}
