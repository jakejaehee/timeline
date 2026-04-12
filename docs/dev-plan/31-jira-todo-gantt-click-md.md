# 개발 계획서: Jira To Do 필터 버그 수정, 간트차트 클릭 동작 변경, Jira 공수 0 버그 수정

## 1. 개요

- **기능 설명**: 3가지 독립적인 버그 수정 작업
  1. Jira Import 시 "To Do" 상태 필터가 동작하지 않는 문제
  2. 간트차트 태스크 클릭 시 조회 모달 대신 수정 모달로 직접 이동
  3. Jira Import 시 story points가 0MD로 저장되는 문제
- **개발 배경**: Plan 30에서 statusFilter 수정을 진행했으나 여전히 동작하지 않음. 간트차트 UX 개선 요구. story points 필드 매핑 문제 지속.
- **작성일**: 2026-04-13

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: Jira Import 시 "To Do" 체크박스만 선택하면 To Do 상태 이슈만 가져와야 한다
- FR-002: 간트차트에서 태스크 바 클릭 시 조회 모달(taskDetailModal) 대신 수정 모달(taskModal)이 열려야 한다
- FR-003: 조회 전용 모달(taskDetailModal)과 showTaskDetail() 함수는 간트차트 클릭 경로에서 제거한다. showTaskDetail()은 app.js line 4932의 resolveWarning() default case에서 참조하므로 함수 본체와 taskDetailModal HTML은 삭제하지 않는다
- FR-004: Jira Import 시 story points 값이 있을 경우 올바른 MD로 저장되어야 한다 (현재는 커스텀 필드 ID 불일치로 null이 저장되고 UI에서 0으로 표시됨)
- FR-005: story points를 저장하는 커스텀 필드를 사용자의 Jira 인스턴스에서 동적으로 탐지할 수 있어야 한다

### 2.2 비기능 요구사항

- NFR-001: 기존 동작 중인 기능(경고 시스템의 showTaskDetail, 다른 섹션의 태스크 조회 등)에 영향 없어야 한다
- NFR-002: story points 필드 탐지 로그는 INFO 레벨로 출력되어야 한다

### 2.3 가정 사항

- Jira Cloud에서 `story_points` 필드명은 유효하지 않으므로 추가하지 않는다
- `customfield_10016`, `customfield_10028` 외에도 다양한 커스텀 필드명이 사용될 수 있다
- taskDetailModal은 간트차트 클릭 외에도 사용되므로 완전 삭제하지 않는다

### 2.4 제외 범위

- taskDetailModal HTML 완전 삭제 (다른 진입점에서 사용 가능성 있음)
- 간트차트 외 영역(프로젝트 상세 태스크 목록, 경고 목록 등)의 클릭 동작 변경

---

## 3. 버그 원인 분석

### 3.1 버그 1: Jira To Do 필터 오동작

**코드 탐색 결과 - 실제 버그 원인**

`app.js` `startJiraPreview()` (line 5301~5312) 흐름:

```javascript
var statusFilter = [];
var allCheck = document.getElementById('jira-filter-status-all');
if (!allCheck.checked) {
    ['jira-filter-status-todo', 'jira-filter-status-inprogress', 'jira-filter-status-done']
        .forEach(function(id) {
            var cb = document.getElementById(id);
            if (cb && cb.checked) statusFilter.push(cb.value);
        });
    if (statusFilter.length === 0) statusFilter = ['To Do'];
}
jiraPreviewStatusFilter = statusFilter;
```

`executeJiraImport()` (line 5407~5408):

```javascript
if (jiraPreviewStatusFilter && jiraPreviewStatusFilter.length > 0) {
    importBody.statusFilter = jiraPreviewStatusFilter;
}
```

**프론트엔드 로직 자체는 정상**. "To Do" 체크박스의 `value="To Do"`(index.html line 1155)로 올바르게 설정되어 있고, `statusFilter = ['To Do']`가 `body.statusFilter`에 담겨 POST로 전송된다.

**백엔드 `buildJql()` 로직도 정상** (line 257~275). `status in ("To Do")` JQL이 생성된다.

**실제 문제**: Board API(`/rest/agile/1.0/board/{boardId}/issue`)는 JQL의 `status` 필터를 무시하거나 지원하지 않는 Jira 인스턴스가 있다. 이때 `HttpClientErrorException.BadRequest`가 발생하면 Search API로 폴백되어야 하는데, **Board API가 400이 아닌 200을 반환하면서 status 필터를 무시하고 전체 이슈를 반환**하는 경우가 있다.

이 경우 클라이언트 사이드 재필터링(line 154~165)이 방어적으로 동작해야 하는데, `parseIssue()`에서 추출된 `issue.getStatus()` 값이 Jira 원본 상태명과 대소문자나 공백이 다를 수 있다.

**추가 의심 포인트**: `BOARD_FIELDS` (line 41)에 `status`가 포함되어 있으므로 status 파싱은 정상. `ALLOWED_STATUS_VALUES`에는 `"To Do"`, 한글 상태명 등이 포함되어 있으므로 `buildJql()`에서 `"To Do"` 자체가 safe에서 탈락하지는 않는다. 다만 클라이언트 사이드 재필터링(line 157)의 `safe.contains(issue.getStatus())`가 **대소문자 완전 일치 비교**이므로, Jira 인스턴스가 `"To do"`, `"TO DO"` 등 대소문자가 다른 형태로 상태명을 반환할 경우 필터 조건이 일치하지 않아 탈락된다.

**결론**: 가장 가능성 높은 원인은 **Board API가 200을 반환하면서 JQL status 필터를 무시**하는 케이스이다. 이때 클라이언트 사이드 재필터링이 최후 방어선이 되는데, line 161의 `safe.contains(issue.getStatus())`가 대소문자 완전 일치 비교라서 Jira 인스턴스가 반환하는 상태명의 대소문자가 체크박스 `value="To Do"`와 정확히 일치하지 않으면 모든 이슈가 필터링되어 0건이 된다.

**수정 방향**:
1. `fetchAllBoardIssues()` 내 클라이언트 사이드 재필터링 로직 강화: `ALLOWED_STATUS_VALUES` 검증을 제거하고, 전달받은 `statusFilter` 값 그대로 대소문자 무시 비교로 필터링
2. 클라이언트 사이드 재필터링 시 상태명 비교를 대소문자 무시 + trim() 처리
3. `buildJql()` JQL 생성 시 로그 출력을 INFO 레벨로 격상

### 3.2 버그 2: 간트차트 클릭 동작

**코드 탐색 결과**

`renderGantt()` (line 2429~2497)에 두 곳에서 `showTaskDetail()` 호출:
- `on_click` 콜백 (line 2450~2452): frappe-gantt 내부 클릭
- `bar-wrapper` clone click 핸들러 (line 2469~2474): 드래그 비활성화를 위해 bar를 clone하고 click 이벤트 직접 바인딩

전체 프로젝트 간트 (`loadAllProjectsGantt()`)의 `ganttInstance` 생성 (line 2035~2038)과 `bar-wrapper` 핸들러 (line 2064~2071)에서도 동일하게 `showTaskDetail()` 호출.

`showTaskDetail()` (line 2993~)은 별도 조회 모달(`taskDetailModal`)을 열고, 그 안의 "수정" 버튼 클릭 시 `showTaskModal()`로 이동.

`taskDetailModal`은 index.html line 1083~1103에 정의. `showTaskDetail()`의 현재 호출 위치:
- renderGantt() on_click (line 2451) — **이번에 showTaskModal로 교체**
- renderGantt() bar-wrapper (line 2473) — **이번에 showTaskModal로 교체**
- loadAllProjectsGantt() on_click (line 2037) — **이번에 showTaskModal로 교체**
- loadAllProjectsGantt() bar-wrapper (line 2070) — **이번에 showTaskModal로 교체**
- resolveWarning() default case (line 4932) — **유지** (현재 정의된 8가지 WarningType은 모두 각 case에서 처리되므로 default는 미래 확장용 폴백 역할)

**수정 방향**:
- `renderGantt()`의 `on_click` 콜백과 `bar-wrapper` 핸들러에서 `showTaskDetail()` → `showTaskModal()` 로 직접 변경
- `loadAllProjectsGantt()`의 동일한 두 곳도 변경
- `showTaskDetail()` 함수와 `taskDetailModal` HTML은 경고 시스템(line 4932)에서 사용하므로 유지

### 3.3 버그 3: Jira 공수(MD) 0 버그

**코드 탐색 결과**

`extractStoryPoints()` (line 420~452):
- `candidates = ["customfield_10016", "customfield_10028"]` 만 시도
- 최초 이슈 파싱 시 `fields.keySet()` INFO 로그 출력 (volatile boolean)
- 값이 없으면 `null` 반환 → `manDays = null`로 저장 (0이 아닌 null)

`importIssues()`에서 `issue.getStoryPoints() == null`이면 CREATE 시 `manDays = null`, UPDATE 시 기존 값 유지.

**실제 0 표시 경위**: `extractStoryPoints()`가 `null`을 반환하면 `manDays = null`로 저장된다. UI(app.js)에서 `task.manDays || '-'` 패턴으로 표시하므로 null이면 "-"로 보여야 하지만, 일부 UI 경로에서 `0`으로 렌더링될 수 있다. 근본 원인은 특정 Jira 인스턴스에서 story points가 `customfield_10016`, `customfield_10028` 이외의 필드명에 저장되어 있어 `extractStoryPoints()`가 null을 반환하는 것이다.

**Jira Cloud 주요 story points 필드**:
- `customfield_10016`: Jira Cloud 기본 Story Points (가장 일반적)
- `customfield_10028`: Story point estimate (일부 버전)
- `customfield_10014`: Epic Link (story points 아님)
- `customfield_10024`: Sprint (story points 아님)
- `story_points`: Jira Cloud에서 유효하지 않음 (요구사항에서 명시적으로 제외)

**로그에서 `fields.keySet()`이 출력되었다면 실제 story points 커스텀 필드 이름을 확인 가능**. 로그를 보지 않고도 동작하게 하려면 **모든 `customfield_XXXXX` 필드 중 숫자(Number)인 것을 탐지하는 휴리스틱**을 추가하거나, **후보 필드를 더 추가** 해야 한다.

**수정 방향**:
1. Story points 후보 필드 확장: `customfield_10016`, `customfield_10028`, `customfield_10004`, `customfield_10025` 추가 (일부 Jira 인스턴스에서 사용)
2. 필드 디버그 로그 강화: 모든 `customfield_XXXXX` 키 중 Number 타입인 것을 INFO로 출력 (어떤 필드가 story points인지 사용자가 확인할 수 있도록)
3. `BOARD_FIELDS`에 추가 후보 필드 포함
4. `storyPoints = null`인 경우 `manDays = null`이 아닌 기본값 사용 여부는 현재 정책 유지 (null로 저장)

---

## 4. 시스템 설계

### 4.1 데이터 모델

변경 없음.

### 4.2 API 설계

변경 없음.

### 4.3 서비스 계층 변경

#### JiraApiClient.java

**변경 1: BOARD_FIELDS 확장**

```java
// 기존
private static final String BOARD_FIELDS =
    "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,dueDate,description,resolutiondate,issuelinks";

// 변경 후
private static final String BOARD_FIELDS =
    "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,customfield_10004,customfield_10025,dueDate,description,resolutiondate,issuelinks";
```

**변경 2: extractStoryPoints() 후보 필드 확장 + 디버그 로그 강화**

```java
private BigDecimal extractStoryPoints(Map<String, Object> fields) {
    if (!storyPointsFieldsLogged) {
        storyPointsFieldsLogged = true;
        // 모든 customfield 중 Number 타입인 것만 출력 (story points 탐지용)
        // 기존 "첫 번째 이슈의 fields 키 목록" 로그를 아래 두 줄로 교체한다
        Map<String, Object> numberCustomFields = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : fields.entrySet()) {
            if (entry.getKey().startsWith("customfield_") && entry.getValue() instanceof Number) {
                numberCustomFields.put(entry.getKey(), entry.getValue());
            }
        }
        log.info("[Jira Debug] 첫 번째 이슈의 Number 타입 customfield 목록 (story points 후보): {}", numberCustomFields);
        log.info("[Jira Debug] 첫 번째 이슈의 전체 fields 키 목록: {}", fields.keySet());
    }

    // story_points는 Jira Cloud에서 유효하지 않으므로 제외
    String[] candidates = {
        "customfield_10016",  // Jira Cloud 기본 Story Points
        "customfield_10028",  // Story point estimate
        "customfield_10004",  // 일부 Jira 인스턴스
        "customfield_10025"   // 일부 Jira 인스턴스
    };
    // ... 기존 파싱 로직 유지
}
```

**변경 3: fetchAllBoardIssues() 클라이언트 사이드 재필터링 강화**

```java
// 기존: ALLOWED_STATUS_VALUES 허용 목록으로 검증 후 contains 비교
if (!safe.isEmpty()) {
    allIssues = allIssues.stream()
        .filter(issue -> issue.getStatus() != null && safe.contains(issue.getStatus()))
        .collect(Collectors.toList());
}

// 변경 후: 대소문자 무시 + trim() 비교 (허용 목록 검증은 JQL 생성 시에만 적용)
List<String> lowerFilter = statusFilter.stream()
    .filter(s -> s != null && !s.isBlank())
    .map(s -> s.toLowerCase().trim())
    .toList();
if (!lowerFilter.isEmpty()) {
    allIssues = allIssues.stream()
        .filter(issue -> issue.getStatus() != null
            && lowerFilter.contains(issue.getStatus().toLowerCase().trim()))
        .collect(Collectors.toList());
    log.info("클라이언트 사이드 status 재필터링 적용: filter={} → {}건", statusFilter, allIssues.size());
}
```

**변경 4: buildJql() 로그 INFO 격상**

```java
private String buildJql(LocalDate createdAfter, List<String> statusFilter) {
    // ... 기존 로직
    String jql = conditions.isEmpty() ? null : String.join(" AND ", conditions);
    if (jql != null) {
        log.info("[Jira Debug] 생성된 JQL: {}", jql);
    }
    return jql;
}
```

### 4.4 프론트엔드 변경

#### app.js

**변경 1: renderGantt() - on_click 콜백 변경**

```javascript
// 기존 (line 2450~2452)
on_click: function(task) {
    showTaskDetail(task._taskId, { projectId: currentProjectId });
},

// 변경 후
// 참고: convertToGanttTasks()에서 _taskId는 항상 정수값으로 설정되므로 null guard는 옵션이지만
//       방어적 코딩을 위해 유지한다
on_click: function(task) {
    if (task._taskId) {
        showTaskModal(task._taskId, currentProjectId);
    }
},
```

**변경 2: renderGantt() - bar-wrapper 클릭 핸들러 변경**

```javascript
// 기존 (line 2469~2474)
clone.addEventListener('click', function() {
    var taskId = clone.getAttribute('data-id');
    if (taskId && taskId.startsWith('task-')) {
        var id = parseInt(taskId.replace('task-', ''));
        showTaskDetail(id, { projectId: currentProjectId });
    }
});

// 변경 후
clone.addEventListener('click', function() {
    var taskId = clone.getAttribute('data-id');
    if (taskId && taskId.startsWith('task-')) {
        var id = parseInt(taskId.replace('task-', ''));
        showTaskModal(id, currentProjectId);
    }
});
```

**변경 3: loadAllProjectsGantt() - on_click 콜백 변경**

```javascript
// 기존 (line 2035~2038)
on_click: function(task) {
    if (task._taskId) {
        showTaskDetail(task._taskId, { projectId: task._projectId });
    }
},

// 변경 후
// 참고: task._projectId는 convertToGanttTasks() 호출 시 res.data.project.id로 설정.
//       _projectId가 null이면 showTaskModal() 내부에서 currentProjectId로 폴백되지만
//       전체 간트 모드의 currentProjectId는 특정 프로젝트가 아니므로 null일 수 있다.
//       따라서 _projectId 확보가 올바른 동작의 전제이며, convertToGanttTasks에서 이를 보장한다.
on_click: function(task) {
    if (task._taskId) {
        showTaskModal(task._taskId, task._projectId);
    }
},
```

**변경 4: loadAllProjectsGantt() - bar-wrapper 클릭 핸들러 변경**

```javascript
// 기존 (line 2064~2071)
clone.addEventListener('click', function() {
    var taskId = clone.getAttribute('data-id');
    if (taskId && taskId.startsWith('task-')) {
        var id = parseInt(taskId.replace('task-', ''));
        // 참고: allTasks[i].id는 'task-123' 문자열, taskId도 'task-123' 문자열이므로 === 타입 일치
        var found = allTasks.find(function(t) { return t.id === taskId; });
        showTaskDetail(id, { projectId: found ? found._projectId : null });
    }
});

// 변경 후
clone.addEventListener('click', function() {
    var taskId = clone.getAttribute('data-id');
    if (taskId && taskId.startsWith('task-')) {
        var id = parseInt(taskId.replace('task-', ''));
        var found = allTasks.find(function(t) { return t.id === taskId; });
        showTaskModal(id, found ? found._projectId : null);
    }
});
```

**유지**: `showTaskDetail()` 함수와 `taskDetailModal` HTML은 `resolveWarning()` default case (line 4932)에서 참조하므로 삭제하지 않는다. 간트차트 진입점 4곳(on_click × 2, bar-wrapper × 2)만 교체 대상이다.

---

## 5. 구현 계획

### 5.1 작업 분해

| # | 작업 | 설명 | 복잡도 | 의존성 |
|---|------|------|--------|--------|
| T-01 | JiraApiClient.java - BOARD_FIELDS 확장 | customfield_10004, customfield_10025 추가 | 낮음 | 없음 |
| T-02 | JiraApiClient.java - extractStoryPoints() 개선 | 후보 필드 확장 + 디버그 로그 강화 (Number 타입 customfield 출력) | 낮음 | 없음 (T-01과 독립적으로 수정 가능. 단 BOARD_FIELDS에 없는 필드는 응답에 포함되지 않으므로 T-01과 함께 커밋 권장) |
| T-03 | JiraApiClient.java - fetchAllBoardIssues() 재필터링 강화 | 대소문자 무시 + trim() 비교로 변경 | 낮음 | 없음 |
| T-04 | JiraApiClient.java - buildJql() 로그 격상 | INFO 레벨로 JQL 로그 출력 | 낮음 | 없음 |
| T-05 | app.js - renderGantt() on_click 변경 | showTaskDetail → showTaskModal | 낮음 | 없음 |
| T-06 | app.js - renderGantt() bar-wrapper 핸들러 변경 | showTaskDetail → showTaskModal | 낮음 | 없음 |
| T-07 | app.js - loadAllProjectsGantt() on_click 변경 | showTaskDetail → showTaskModal | 낮음 | 없음 |
| T-08 | app.js - loadAllProjectsGantt() bar-wrapper 핸들러 변경 | showTaskDetail → showTaskModal | 낮음 | 없음 |

### 5.2 구현 순서

1. **Step 1**: T-01 ~ T-04 — `JiraApiClient.java` 수정 (백엔드)
2. **Step 2**: T-05 ~ T-08 — `app.js` 수정 (프론트엔드)

### 5.3 테스트 계획

**버그 1 (Jira To Do 필터)**:
- "To Do"만 체크 후 미리보기 실행 → Preview 목록에 To Do 상태 이슈만 표시되는지 확인
- 서버 로그에서 `[Jira Debug] 생성된 JQL: status in ("To Do")` 로그 확인
- 서버 로그에서 `클라이언트 사이드 status 재필터링 적용: filter=[To Do] → N건` 로그 확인
- "In Progress" 체크 후 테스트 반복

**버그 2 (간트차트 클릭)**:
- 간트차트에서 태스크 바 클릭 → taskModal이 열리는지 확인 (taskDetailModal이 아닌 taskModal)
- 전체 프로젝트 간트에서도 동일 확인
- 경고 목록에서 태스크 클릭 → taskDetailModal이 열리는지 확인 (기존 동작 유지 확인)

**버그 3 (공수 0 버그)**:
- Jira Import 실행 후 서버 로그에서 `[Jira Debug] Number 타입 customfield 목록` 확인
- 로그에 나온 실제 story points 필드명을 candidates에 포함 여부 확인
- Import 후 태스크 MD 값이 올바르게 저장되는지 확인

---

## 6. 변경 파일 목록

| 파일 | 변경 유형 | 변경 내용 |
|------|-----------|-----------|
| `src/main/java/com/timeline/service/JiraApiClient.java` | 수정 | BOARD_FIELDS 확장, extractStoryPoints() 후보 추가 및 로그 강화, fetchAllBoardIssues() 재필터링 강화, buildJql() 로그 INFO 격상 |
| `src/main/resources/static/js/app.js` | 수정 | renderGantt() on_click + bar-wrapper 핸들러, loadAllProjectsGantt() on_click + bar-wrapper 핸들러 변경 |

---

## 7. 리스크 및 고려사항

### 7.1 버그 1 관련

- Board API가 상태 필터를 완전히 무시하는 경우, 클라이언트 사이드 재필터링만으로 올바르게 동작해야 한다
- 상태명 대소문자 무시 비교 도입 시, `ALLOWED_STATUS_VALUES` 검증은 JQL injection 방지 목적이므로 `buildJql()` 내에서는 유지해야 한다
- **클라이언트 사이드 재필터링에서는 허용 목록 검증 없이 전달받은 statusFilter 값 그대로 비교**해야 "To Do"가 올바르게 필터링됨

### 7.2 버그 2 관련

- `showTaskModal(id, projectId)`에서 `projectId`가 `null`인 경우: `resolvedProjectId = projectId || currentProjectId`로 폴백되나, 전체 간트 모드(`loadAllProjectsGantt`)에서는 `currentProjectId`가 특정 프로젝트로 설정되어 있지 않아 `null`일 수 있음
- 전체 간트 모드에서 on_click 경로는 `task._projectId` (= `convertToGanttTasks` 실행 시 설정된 값)를 인자로 전달하므로 정상 동작 보장
- bar-wrapper 경로에서는 `allTasks.find(t => t.id === taskId)`로 `found._projectId`를 추출. `found`가 null인 경우(외부 bar 클릭 등)에만 `null`이 전달될 수 있으므로 허용 범위 내 엣지케이스

### 7.3 버그 3 관련

- `customfield_10004`, `customfield_10025`가 story points가 아닌 다른 필드인 인스턴스에서 오작동 가능성 있음 → 이 경우 로그를 통해 올바른 필드명을 확인 후 수동 조정 필요
- 궁극적 해결책은 사용자가 Jira 설정 UI에서 story points 필드명을 직접 지정하는 것이나, 이번 범위에서는 제외

---

## 8. 참고 사항

- `app.js` renderGantt on_click: line 2450
- `app.js` renderGantt bar-wrapper: line 2466~2476
- `app.js` loadAllProjectsGantt on_click: line 2035
- `app.js` loadAllProjectsGantt bar-wrapper: line 2060~2074
- `app.js` showTaskDetail(): line 2993
- `app.js` showTaskModal(): line 3082
- `index.html` taskDetailModal: line 1083~1103
- `JiraApiClient.java` fetchAllBoardIssues(): line 89
- `JiraApiClient.java` buildJql(): line 257
- `JiraApiClient.java` extractStoryPoints(): line 420
- `JiraApiClient.java` BOARD_FIELDS: line 41
- `JiraApiClient.java` ALLOWED_STATUS_VALUES: line 44
- Jira Cloud story points 커스텀 필드 참고: https://support.atlassian.com/jira-software-cloud/docs/what-is-story-points/
