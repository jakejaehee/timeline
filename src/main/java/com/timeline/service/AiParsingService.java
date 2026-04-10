package com.timeline.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.timeline.config.ClaudeCliProperties;
import com.timeline.domain.entity.*;
import com.timeline.domain.repository.*;
import com.timeline.dto.ParsedTaskDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * AI 파싱 서비스
 * - free-text를 Claude CLI로 파싱하여 태스크 정보 추출
 * - 파싱 결과를 DB에 저장
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AiParsingService {

    private final ClaudeCliProperties claudeCliProperties;
    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectDomainSystemRepository projectDomainSystemRepository;
    private final DomainSystemRepository domainSystemRepository;
    private final MemberRepository memberRepository;
    private final TaskRepository taskRepository;
    private final TaskDependencyRepository taskDependencyRepository;
    private final ObjectMapper objectMapper;

    /**
     * free-text에서 태스크 정보를 파싱 (미리보기용)
     *
     * @param freeText  사용자가 입력한 자유 형식 텍스트
     * @param projectId 프로젝트 ID
     * @return 파싱된 태스크 DTO
     */
    public ParsedTaskDto parseTasksFromText(String freeText, Long projectId) {
        // 1. 프로젝트 정보, 멤버 목록, 도메인 시스템 목록 조회
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + projectId));

        List<Member> members = projectMemberRepository.findByProjectIdWithMember(projectId).stream()
                .map(ProjectMember::getMember)
                .collect(Collectors.toList());

        List<DomainSystem> domainSystems = projectDomainSystemRepository.findByProjectIdWithDomainSystem(projectId).stream()
                .map(ProjectDomainSystem::getDomainSystem)
                .collect(Collectors.toList());

        // 2. 시스템 프롬프트 구성
        String systemPrompt = buildSystemPrompt(project, members, domainSystems);

        // 3. Claude CLI 호출
        String aiResponse = callClaudeCli(systemPrompt, freeText);
        log.debug("AI 응답: {}", aiResponse);

        // 4. JSON 응답 파싱
        ParsedTaskDto parsedResult = parseAiResponse(aiResponse);

        // 5. domainSystemMatched, assigneeMatched 검증
        validateMatching(parsedResult, members, domainSystems);

        return parsedResult;
    }

    /**
     * 파싱된 태스크를 DB에 저장
     *
     * @param projectId  프로젝트 ID
     * @param parsedData 파싱된 태스크 데이터
     * @return 저장된 Task ID 목록
     */
    @Transactional
    public List<Long> saveParsedTasks(Long projectId, ParsedTaskDto parsedData) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new EntityNotFoundException("프로젝트를 찾을 수 없습니다. id=" + projectId));

        // 프로젝트 멤버 목록 조회
        List<Member> projectMembers = projectMemberRepository.findByProjectIdWithMember(projectId).stream()
                .map(ProjectMember::getMember)
                .collect(Collectors.toList());

        // 프로젝트 도메인 시스템 목록 조회
        List<DomainSystem> projectDomainSystems = projectDomainSystemRepository
                .findByProjectIdWithDomainSystem(projectId).stream()
                .map(ProjectDomainSystem::getDomainSystem)
                .collect(Collectors.toList());

        // 기준 시작일 결정
        LocalDate baseStartDate = project.getStartDate() != null ? project.getStartDate() : LocalDate.now();

        // 담당자별 마지막 종료일 추적 (같은 담당자의 태스크가 겹치지 않도록)
        Map<Long, LocalDate> assigneeLastEndDate = new HashMap<>();

        // 기존 태스크들의 담당자별 마지막 종료일 초기화
        List<Task> existingTasks = taskRepository.findByProjectIdWithDetails(projectId);
        for (Task existingTask : existingTasks) {
            if (existingTask.getAssignee() != null) {
                Long assigneeId = existingTask.getAssignee().getId();
                LocalDate currentLast = assigneeLastEndDate.get(assigneeId);
                if (currentLast == null || existingTask.getEndDate().isAfter(currentLast)) {
                    assigneeLastEndDate.put(assigneeId, existingTask.getEndDate());
                }
            }
        }

        // 태스크명 -> 저장된 Task 매핑 (의존관계 설정용)
        Map<String, Task> savedTasksByName = new LinkedHashMap<>();
        List<Long> savedTaskIds = new ArrayList<>();
        int sortOrderCounter = existingTasks.size() + 1;

        for (ParsedTaskDto.DomainSystemParsed dsParsed : parsedData.getDomainSystems()) {
            // 도메인 시스템 매칭
            DomainSystem domainSystem = matchDomainSystem(dsParsed.getName(), projectDomainSystems);
            if (domainSystem == null) {
                log.warn("도메인 시스템을 찾을 수 없습니다: {}", dsParsed.getName());
                continue;
            }

            if (dsParsed.getTasks() == null) continue;

            for (ParsedTaskDto.TaskParsed taskParsed : dsParsed.getTasks()) {
                // 담당자 매칭
                Member assignee = matchMember(taskParsed.getAssigneeName(), projectMembers);

                // 공수 (manDays)
                BigDecimal manDays = taskParsed.getManDays();

                // 시작일 계산
                LocalDate taskStartDate = calculateStartDate(
                        baseStartDate, taskParsed, assignee, assigneeLastEndDate, savedTasksByName);

                // 종료일 계산
                LocalDate taskEndDate;
                if (manDays != null && manDays.compareTo(BigDecimal.ZERO) > 0) {
                    taskEndDate = calculateEndDate(taskStartDate, manDays);
                } else {
                    // 공수가 없으면 시작일과 같은 날로 설정
                    taskEndDate = taskStartDate;
                }

                // Task 엔티티 생성 및 저장
                Task task = Task.builder()
                        .project(project)
                        .domainSystem(domainSystem)
                        .assignee(assignee)
                        .name(taskParsed.getName())
                        .startDate(taskStartDate)
                        .endDate(taskEndDate)
                        .manDays(manDays)
                        .sortOrder(sortOrderCounter++)
                        .build();

                Task savedTask = taskRepository.save(task);
                savedTasksByName.put(taskParsed.getName(), savedTask);
                savedTaskIds.add(savedTask.getId());

                // 담당자의 마지막 종료일 갱신
                if (assignee != null) {
                    LocalDate currentLast = assigneeLastEndDate.get(assignee.getId());
                    if (currentLast == null || taskEndDate.isAfter(currentLast)) {
                        assigneeLastEndDate.put(assignee.getId(), taskEndDate);
                    }
                }

                log.info("태스크 저장: name={}, domain={}, assignee={}, start={}, end={}, manDays={}",
                        task.getName(), domainSystem.getName(),
                        assignee != null ? assignee.getName() : "미지정",
                        taskStartDate, taskEndDate, manDays);
            }
        }

        // 의존관계 설정
        for (ParsedTaskDto.DomainSystemParsed dsParsed : parsedData.getDomainSystems()) {
            if (dsParsed.getTasks() == null) continue;
            for (ParsedTaskDto.TaskParsed taskParsed : dsParsed.getTasks()) {
                if (taskParsed.getDependsOn() != null && !taskParsed.getDependsOn().isEmpty()) {
                    Task currentTask = savedTasksByName.get(taskParsed.getName());
                    if (currentTask == null) continue;

                    for (String depName : taskParsed.getDependsOn()) {
                        Task depTask = savedTasksByName.get(depName);
                        if (depTask != null) {
                            if (!taskDependencyRepository.existsByTaskIdAndDependsOnTaskId(
                                    currentTask.getId(), depTask.getId())) {
                                TaskDependency dependency = TaskDependency.builder()
                                        .task(currentTask)
                                        .dependsOnTask(depTask)
                                        .build();
                                taskDependencyRepository.save(dependency);
                                log.info("의존관계 설정: {} -> {}", currentTask.getName(), depTask.getName());
                            }
                        } else {
                            log.warn("의존관계의 선행 태스크를 찾을 수 없습니다: {}", depName);
                        }
                    }
                }
            }
        }

        log.info("총 {}개의 태스크가 저장되었습니다. projectId={}", savedTaskIds.size(), projectId);
        return savedTaskIds;
    }

    /**
     * 시스템 프롬프트 구성
     */
    private String buildSystemPrompt(Project project, List<Member> members, List<DomainSystem> domainSystems) {
        StringBuilder sb = new StringBuilder();
        sb.append("당신은 프로젝트 관리 태스크 파서입니다.\n");
        sb.append("사용자가 자유 형식으로 입력한 텍스트에서 태스크 정보를 추출하세요.\n\n");

        sb.append("## 현재 프로젝트 컨텍스트\n");
        sb.append("- 프로젝트명: ").append(project.getName()).append("\n");

        // 멤버 목록
        sb.append("- 참여 멤버: ");
        if (members.isEmpty()) {
            sb.append("없음");
        } else {
            sb.append(members.stream()
                    .map(m -> m.getName() + "(" + m.getRole().name() + ")")
                    .collect(Collectors.joining(", ")));
        }
        sb.append("\n");

        // 도메인 시스템 목록
        sb.append("- 도메인 시스템: ");
        if (domainSystems.isEmpty()) {
            sb.append("없음");
        } else {
            sb.append(domainSystems.stream()
                    .map(DomainSystem::getName)
                    .collect(Collectors.joining(", ")));
        }
        sb.append("\n\n");

        sb.append("## 추출 규칙\n");
        sb.append("1. 도메인 시스템: 텍스트에서 도메인 시스템명을 식별합니다\n");
        sb.append("2. 태스크명: 작업 내용을 식별합니다\n");
        sb.append("3. 담당자: 멤버 이름을 매칭합니다 (부분 일치 허용)\n");
        sb.append("4. 공수(MD): 숫자 + \"md\" 또는 \"일\" 패턴을 식별합니다\n");
        sb.append("5. 의존관계: \"→\", \"후\", \"다음\" 등의 키워드로 순서를 식별합니다\n\n");

        sb.append("## 출력 형식 (반드시 JSON만 출력, 다른 텍스트 없이)\n");
        sb.append("{\n");
        sb.append("  \"domainSystems\": [\n");
        sb.append("    {\n");
        sb.append("      \"name\": \"시스템명\",\n");
        sb.append("      \"tasks\": [\n");
        sb.append("        {\n");
        sb.append("          \"name\": \"태스크명\",\n");
        sb.append("          \"assigneeName\": \"담당자명\",\n");
        sb.append("          \"assigneeMatched\": true,\n");
        sb.append("          \"manDays\": 5.0,\n");
        sb.append("          \"dependsOn\": [\"선행 태스크명\"]\n");
        sb.append("        }\n");
        sb.append("      ]\n");
        sb.append("    }\n");
        sb.append("  ]\n");
        sb.append("}\n\n");

        sb.append("주의:\n");
        sb.append("- 멤버 목록에 없는 담당자는 assigneeName에 입력값 그대로 넣고 assigneeMatched: false로 설정\n");
        sb.append("- 멤버 목록에 있는 담당자는 assigneeMatched: true로 설정\n");
        sb.append("- 공수가 명시되지 않은 태스크는 manDays: null로 설정\n");
        sb.append("- 의존관계가 불명확하면 dependsOn을 빈 배열로 설정\n");
        sb.append("- 반드시 유효한 JSON만 출력하세요. 설명이나 마크다운 코드블록 없이 JSON만 출력하세요.\n");

        return sb.toString();
    }

    /**
     * Claude CLI 호출 (claude -p)
     */
    private String callClaudeCli(String systemPrompt, String userMessage) {
        List<String> command = List.of(
                claudeCliProperties.getExecutable(),
                "-p",
                "--output-format", "json",
                "--model", claudeCliProperties.getModel(),
                "--no-session-persistence",
                "--system-prompt", systemPrompt,
                userMessage
        );

        try {
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.redirectErrorStream(false);

            Process process = pb.start();

            String stdout;
            String stderr;
            try (var stdoutStream = process.getInputStream();
                 var stderrStream = process.getErrorStream()) {
                stdout = new String(stdoutStream.readAllBytes(), StandardCharsets.UTF_8);
                stderr = new String(stderrStream.readAllBytes(), StandardCharsets.UTF_8);
            }

            boolean finished = process.waitFor(claudeCliProperties.getTimeoutSeconds(), TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new IllegalStateException("Claude CLI 실행 시간이 초과되었습니다 ("
                        + claudeCliProperties.getTimeoutSeconds() + "초).");
            }

            int exitCode = process.exitValue();
            if (exitCode != 0) {
                log.error("Claude CLI 오류 (exit {}): {}", exitCode, stderr);
                throw new IllegalStateException("Claude CLI 실행 실패 (exit " + exitCode + "): " + stderr.trim());
            }

            return extractResultFromCliOutput(stdout.trim());

        } catch (IOException e) {
            throw new IllegalStateException("Claude CLI를 실행할 수 없습니다. "
                    + "CLI가 설치되어 있고 PATH에 포함되어 있는지 확인하세요: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Claude CLI 실행이 인터럽트되었습니다.", e);
        }
    }

    /**
     * CLI JSON 출력에서 result 필드 추출
     * --output-format json 사용 시 {"type":"result","result":"...","...} 형태
     */
    private String extractResultFromCliOutput(String cliOutput) {
        try {
            JsonNode root = objectMapper.readTree(cliOutput);
            JsonNode resultNode = root.get("result");
            if (resultNode != null && resultNode.isTextual()) {
                return resultNode.asText();
            }
            // result 필드가 없으면 전체 출력을 그대로 반환
            log.warn("CLI 출력에서 result 필드를 찾을 수 없습니다. 전체 출력 사용.");
            return cliOutput;
        } catch (JsonProcessingException e) {
            // JSON 파싱 실패 시 raw 출력 반환
            log.warn("CLI 출력이 JSON 형식이 아닙니다. 전체 출력 사용.");
            return cliOutput;
        }
    }

    /**
     * AI 응답 JSON 파싱
     */
    private ParsedTaskDto parseAiResponse(String aiResponse) {
        try {
            // JSON 블록 추출 (마크다운 코드블록으로 감싸져 있을 수 있음)
            String jsonStr = extractJson(aiResponse);

            JsonNode root = objectMapper.readTree(jsonStr);
            JsonNode domainSystemsNode = root.get("domainSystems");

            if (domainSystemsNode == null || !domainSystemsNode.isArray()) {
                throw new IllegalStateException("AI 응답에서 domainSystems 배열을 찾을 수 없습니다.");
            }

            List<ParsedTaskDto.DomainSystemParsed> domainSystems = new ArrayList<>();

            for (JsonNode dsNode : domainSystemsNode) {
                JsonNode dsNameNode = dsNode.get("name");
                String dsName = (dsNameNode != null && !dsNameNode.isNull()) ? dsNameNode.asText() : "Unknown";
                JsonNode tasksNode = dsNode.get("tasks");

                List<ParsedTaskDto.TaskParsed> tasks = new ArrayList<>();
                if (tasksNode != null && tasksNode.isArray()) {
                    for (JsonNode taskNode : tasksNode) {
                        List<String> dependsOn = new ArrayList<>();
                        JsonNode dependsOnNode = taskNode.get("dependsOn");
                        if (dependsOnNode != null && dependsOnNode.isArray()) {
                            for (JsonNode dep : dependsOnNode) {
                                dependsOn.add(dep.asText());
                            }
                        }

                        BigDecimal manDays = null;
                        JsonNode manDaysNode = taskNode.get("manDays");
                        if (manDaysNode != null && !manDaysNode.isNull()) {
                            manDays = BigDecimal.valueOf(manDaysNode.asDouble());
                        }

                        Boolean assigneeMatched = null;
                        JsonNode matchedNode = taskNode.get("assigneeMatched");
                        if (matchedNode != null && !matchedNode.isNull()) {
                            assigneeMatched = matchedNode.asBoolean();
                        }

                        JsonNode taskNameNode = taskNode.get("name");
                        String taskName = (taskNameNode != null && !taskNameNode.isNull()) ? taskNameNode.asText() : "Unknown";

                        tasks.add(ParsedTaskDto.TaskParsed.builder()
                                .name(taskName)
                                .assigneeName(taskNode.has("assigneeName") && !taskNode.get("assigneeName").isNull()
                                        ? taskNode.get("assigneeName").asText() : null)
                                .assigneeMatched(assigneeMatched)
                                .manDays(manDays)
                                .dependsOn(dependsOn)
                                .build());
                    }
                }

                domainSystems.add(ParsedTaskDto.DomainSystemParsed.builder()
                        .name(dsName)
                        .domainSystemMatched(null) // 서버에서 검증
                        .tasks(tasks)
                        .build());
            }

            return ParsedTaskDto.builder()
                    .domainSystems(domainSystems)
                    .build();

        } catch (JsonProcessingException e) {
            log.error("AI 응답 JSON 파싱 실패: {}", aiResponse, e);
            throw new IllegalStateException("AI 응답을 파싱할 수 없습니다: " + e.getMessage());
        }
    }

    /**
     * JSON 문자열 추출 (마크다운 코드블록 제거)
     */
    private String extractJson(String text) {
        String trimmed = text.trim();

        // 마크다운 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
        if (trimmed.startsWith("```")) {
            int firstNewline = trimmed.indexOf('\n');
            if (firstNewline != -1) {
                trimmed = trimmed.substring(firstNewline + 1);
            }
            if (trimmed.endsWith("```")) {
                trimmed = trimmed.substring(0, trimmed.length() - 3);
            }
            trimmed = trimmed.trim();
        }

        return trimmed;
    }

    /**
     * 매칭 검증: domainSystemMatched, assigneeMatched를 서버에서 다시 검증
     */
    private void validateMatching(ParsedTaskDto parsedResult,
                                   List<Member> members,
                                   List<DomainSystem> domainSystems) {
        Set<String> memberNames = members.stream()
                .map(Member::getName)
                .collect(Collectors.toSet());

        Set<String> dsNames = domainSystems.stream()
                .map(DomainSystem::getName)
                .collect(Collectors.toSet());

        for (ParsedTaskDto.DomainSystemParsed ds : parsedResult.getDomainSystems()) {
            // 도메인 시스템 매칭 검증
            ds.setDomainSystemMatched(dsNames.contains(ds.getName()));

            for (ParsedTaskDto.TaskParsed task : ds.getTasks()) {
                // 담당자 매칭 검증 (이름 포함 여부로 확인)
                if (task.getAssigneeName() != null) {
                    boolean matched = memberNames.stream()
                            .anyMatch(name -> name.equals(task.getAssigneeName())
                                    || name.contains(task.getAssigneeName())
                                    || task.getAssigneeName().contains(name));
                    task.setAssigneeMatched(matched);
                } else {
                    task.setAssigneeMatched(false);
                }
            }
        }
    }

    /**
     * 도메인 시스템 이름으로 매칭
     */
    private DomainSystem matchDomainSystem(String name, List<DomainSystem> domainSystems) {
        if (name == null) return null;

        // exact match 먼저
        for (DomainSystem ds : domainSystems) {
            if (ds.getName().equals(name)) {
                return ds;
            }
        }

        // case-insensitive match
        for (DomainSystem ds : domainSystems) {
            if (ds.getName().equalsIgnoreCase(name)) {
                return ds;
            }
        }

        // 부분 일치
        for (DomainSystem ds : domainSystems) {
            if (ds.getName().contains(name) || name.contains(ds.getName())) {
                return ds;
            }
        }

        // DB에서 직접 조회
        return domainSystemRepository.findByName(name).orElse(null);
    }

    /**
     * 멤버 이름으로 매칭
     */
    private Member matchMember(String assigneeName, List<Member> members) {
        if (assigneeName == null || assigneeName.isBlank()) return null;

        // exact match 먼저
        for (Member m : members) {
            if (m.getName().equals(assigneeName)) {
                return m;
            }
        }

        // 부분 일치 (이름 포함)
        for (Member m : members) {
            if (m.getName().contains(assigneeName) || assigneeName.contains(m.getName())) {
                return m;
            }
        }

        return null;
    }

    /**
     * 태스크 시작일 계산
     * - 의존관계가 있으면 선행 태스크 종료일 다음 영업일
     * - 같은 담당자의 태스크가 겹치지 않도록 순차 배치
     */
    private LocalDate calculateStartDate(LocalDate baseStartDate,
                                          ParsedTaskDto.TaskParsed taskParsed,
                                          Member assignee,
                                          Map<Long, LocalDate> assigneeLastEndDate,
                                          Map<String, Task> savedTasksByName) {
        LocalDate startDate = baseStartDate;

        // 의존관계가 있는 경우: 선행 태스크 종료일 다음 영업일부터 시작
        if (taskParsed.getDependsOn() != null && !taskParsed.getDependsOn().isEmpty()) {
            for (String depName : taskParsed.getDependsOn()) {
                Task depTask = savedTasksByName.get(depName);
                if (depTask != null) {
                    LocalDate nextBusinessDay = getNextBusinessDay(depTask.getEndDate());
                    if (nextBusinessDay.isAfter(startDate)) {
                        startDate = nextBusinessDay;
                    }
                }
            }
        }

        // 같은 담당자의 이전 태스크가 있으면 겹치지 않도록
        if (assignee != null) {
            LocalDate lastEnd = assigneeLastEndDate.get(assignee.getId());
            if (lastEnd != null) {
                LocalDate nextBusinessDay = getNextBusinessDay(lastEnd);
                if (nextBusinessDay.isAfter(startDate)) {
                    startDate = nextBusinessDay;
                }
            }
        }

        // 시작일이 주말이면 다음 월요일로 조정
        startDate = ensureBusinessDay(startDate);

        return startDate;
    }

    /**
     * 종료일 계산 (공수 기반, 주말 제외)
     *
     * @param startDate 시작일
     * @param manDays   공수 (영업일 수)
     * @return 종료일
     */
    private LocalDate calculateEndDate(LocalDate startDate, BigDecimal manDays) {
        int businessDays = manDays.intValue();
        if (businessDays <= 0) {
            return startDate;
        }

        // 소수점이 있으면 올림 (0.5일 → 1일)
        if (manDays.remainder(BigDecimal.ONE).compareTo(BigDecimal.ZERO) > 0) {
            businessDays = businessDays + 1;
        }

        LocalDate endDate = startDate;
        int daysAdded = 1; // 시작일도 영업일 1일로 카운트

        while (daysAdded < businessDays) {
            endDate = endDate.plusDays(1);
            if (isBusinessDay(endDate)) {
                daysAdded++;
            }
        }

        return endDate;
    }

    /**
     * 다음 영업일 반환
     */
    private LocalDate getNextBusinessDay(LocalDate date) {
        LocalDate next = date.plusDays(1);
        return ensureBusinessDay(next);
    }

    /**
     * 주어진 날짜가 영업일이 아니면 다음 영업일 반환
     */
    private LocalDate ensureBusinessDay(LocalDate date) {
        while (!isBusinessDay(date)) {
            date = date.plusDays(1);
        }
        return date;
    }

    /**
     * 영업일 여부 확인 (토/일 제외)
     */
    private boolean isBusinessDay(LocalDate date) {
        DayOfWeek dow = date.getDayOfWeek();
        return dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY;
    }
}
