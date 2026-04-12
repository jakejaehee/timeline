# 개발 계획서: 배치 삭제 Chunk 처리, 태스크 상태 필터, Jira Import 상태 필터

## 1. 개요

- **기능 설명**: 세 가지 독립적인 개선 사항을 묶어 구현한다.
  1. 배치 삭제의 200개 수량 제한을 제거하고, 백엔드에서 chunk 단위 루프 삭제로 전환
  2. 프로젝트 태스크 목록과 멤버별 스케줄 화면에 상태 필터 추가 (기본값: TODO)
  3. Jira Import 모달에 상태 필터 추가 (기본값: "To Do", JQL 조건으로 서버 필터링)
- **개발 배경**: 대량 태스크 삭제 시 200개 제한에 걸리는 불편함, 태스크 목록에서 완료/취소 태스크가 노출되어 가독성 저하, Jira에서 완료 이슈까지 불필요하게 가져오는 문제를 해결
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: `TaskController.batchDelete()`의 200개 제한 검사 코드를 제거한다.
- **FR-002**: `TaskService.deleteTasksBatch()`가 내부적으로 100개씩 chunk를 나눠 삭제한다.
- **FR-003**: 프론트엔드 `batchDeleteSelectedProjectTasks()` / `batchDeleteSelectedTasks()`에서 200개 제한 관련 코드를 제거한다. (현재 두 함수 모두 제한 코드가 없음 — 컨트롤러만 제거하면 됨)
- **FR-004**: 프로젝트 태스크 목록(`loadProjectTasks`)에 상태 필터 UI를 추가한다.
  - 필터 옵션: TODO / IN_PROGRESS / COMPLETED / HOLD / CANCELLED / 전체
  - 기본값: TODO
  - 필터링은 프론트엔드에서 이미 로드된 데이터로 처리 (추가 API 호출 없음)
- **FR-005**: 멤버별 스케줄 화면(`selectScheduleMember`)에도 동일한 상태 필터를 추가한다.
- **FR-006**: `showJiraImportModal` / `startJiraPreview` / `executeJiraImport`에 Jira 상태 필터 UI를 추가한다.
  - 기본값: "To Do"만 선택
  - 옵션: To Do / In Progress / Done / 전체(필터 없음)
  - 체크박스 또는 멀티 셀렉트로 구현
- **FR-007**: `JiraDto.PreviewRequest`와 `JiraDto.ImportRequest`에 `statusFilter` 필드를 추가한다.
- **FR-008**: `JiraApiClient`의 `fetchAllBoardIssues()` / `fetchIssuesByJql()`의 JQL 조건에 status 필터를 추가한다.
- **FR-009**: `JiraImportService.preview()` / `importIssues()`에서 `statusFilter`를 `JiraApiClient`로 전달한다.

### 2.2 비기능 요구사항

- **NFR-001**: chunk 삭제 시 트랜잭션은 chunk 단위가 아닌 전체 호출 단위로 유지한다. (현재 `@Transactional` 메서드 내에서 루프 처리)
- **NFR-002**: 상태 필터 상태는 페이지 내 JS 전역 변수로 관리하며, 화면 재로드(`loadProjectTasks` 재호출) 시에도 유지된다.
- **NFR-003**: Jira 상태 필터는 JQL injection을 방지하기 위해 허용 목록(allowlist) 기반으로 검증한다.

### 2.3 가정 사항

- 현재 프론트엔드 `batchDeleteSelectedProjectTasks()` / `batchDeleteSelectedTasks()`에는 200개 제한 코드가 없다. 제한은 컨트롤러(`TaskController.batchDelete()`)에만 존재한다.
- 상태 필터는 서버 API를 변경하지 않고 프론트엔드 순수 필터링으로 처리한다.
- 멤버별 스케줄 화면에서 사용하는 데이터는 `GET /api/v1/members/{assigneeId}/ordered-tasks`로 수집하며, 해당 응답에 status 필드가 포함되어 있다고 가정한다.
- Jira 상태 필터는 영문 상태명 기준으로 JQL에 추가한다 (Jira Cloud 기본 워크플로 기준).

### 2.4 제외 범위 (Out of Scope)

- 태스크 상태 필터의 서버사이드 API 변경 (프론트엔드 전용 처리)
- chunk 삭제 시 chunk별 별도 트랜잭션 분리 (단일 트랜잭션 내 루프 처리로 충분)
- Jira 상태 필터의 커스텀 상태명 입력 (허용 목록 외 상태는 이번 범위 밖)

---

## 3. 시스템 설계

### 3.1 AS-IS / TO-BE 비교

#### 3.1.1 배치 삭제 200개 제한

**AS-IS** (`TaskController.batchDelete()`, line 122-127):

```java
if (taskIdRaw.size() > 200) {
    return ResponseEntity.badRequest().body(Map.of(
            "success", false,
            "message", "한 번에 최대 200개까지 삭제할 수 있습니다."
    ));
}
```

**AS-IS** (`TaskService.deleteTasksBatch()`):
- `taskRepository.findAllById(taskIds)` — 단일 IN 쿼리로 전체 조회
- `taskDependencyRepository.deleteByTaskIdIn(existingIds)` — 의존관계(태스크가 선행인 경우) 전체 삭제
- `taskDependencyRepository.deleteByDependsOnTaskIdIn(existingIds)` — 의존관계(태스크가 후행인 경우) 전체 삭제
- `taskLinkRepository.deleteByTaskIdIn(existingIds)` — 링크 전체 삭제
- `taskRepository.deleteAll(existingTasks)` — 단일 배치 삭제

**TO-BE** (컨트롤러): 200개 제한 검사 블록 제거. 빈 배열 검사는 유지.

**TO-BE** (서비스): `deleteTasksBatch()` 내부에서 `existingIds`를 100개씩 chunk로 나눠 루프 처리:

```
chunk 1: findAllById(ids[0..99]) → deleteByTaskIdIn → deleteByDependsOnTaskIdIn → deleteByTaskIdIn(links) → deleteAll
chunk 2: findAllById(ids[100..199]) → deleteByTaskIdIn → deleteByDependsOnTaskIdIn → deleteByTaskIdIn(links) → deleteAll
...
```

#### 3.1.2 태스크 목록 상태 필터

**AS-IS**: `loadProjectTasks()`는 HOLD/CANCELLED 여부로만 `allTasks` / `inactiveTasks`로 분리. 별도 필터 없음.

**TO-BE**:
- `projectTaskStatusFilter` 전역 변수 추가 (기본값: `'TODO'`)
- 필터 UI 버튼 그룹을 토글 버튼 영역 옆에 추가
- 필터링 적용 시점: `allTasks`를 렌더링하기 직전에 `filter()` 적용

```
전체 → allTasks 필터 없이 전체 렌더 + inactiveTasks 비활성 섹션 표시
TODO → allTasks 중 status === 'TODO'만 렌더 + inactiveTasks 섹션 숨김
IN_PROGRESS → allTasks 중 status === 'IN_PROGRESS'만 렌더 + inactiveTasks 섹션 숨김
COMPLETED → allTasks 중 status === 'COMPLETED'만 렌더 + inactiveTasks 섹션 숨김
HOLD → allTasks 렌더 없음 + inactiveTasks 중 status === 'HOLD'만 렌더 (비활성 섹션 표시)
CANCELLED → allTasks 렌더 없음 + inactiveTasks 중 status === 'CANCELLED'만 렌더 (비활성 섹션 표시)
```

> 근거: 현재 `loadProjectTasks()`는 파싱 단계에서 HOLD/CANCELLED를 `inactiveTasks`로, 나머지를 `allTasks`로 분리한다. 따라서 `applyProjectStatusFilter(allTasks)`는 HOLD/CANCELLED에 접근할 수 없다. HOLD/CANCELLED 필터 선택 시에는 `allTasks` 렌더를 빈 배열로 처리하고 `inactiveTasks`를 해당 status로 추가 필터링하여 별도 렌더해야 한다. `inactiveTasks` 섹션(비활성 카드)은 `projectTaskStatusFilter`가 `'HOLD'`, `'CANCELLED'`, 또는 `'ALL'`일 때만 표시한다.

**AS-IS**: `selectScheduleMember()` 스케줄 화면도 필터 없음.

**TO-BE**:
- `scheduleTaskStatusFilter` 전역 변수 추가 (기본값: `'TODO'`)
- 스케줄 큐 패널 상단에 동일 필터 UI 추가
- `selectScheduleMember()` 내 태스크 목록 렌더 시 필터 적용

#### 3.1.3 Jira Import 상태 필터

**AS-IS** (`JiraDto.PreviewRequest`):
```java
public static class PreviewRequest {
    private LocalDate createdAfter;
}
```

**AS-IS** (`JiraApiClient.fetchAllBoardIssues()`):
```java
String jql = null;
if (createdAfter != null) {
    jql = "created>=\"" + createdAfter.format(DateTimeFormatter.ISO_LOCAL_DATE) + "\"";
}
```

**AS-IS** (`JiraApiClient.fetchIssuesByJql()` 폴백):
```java
jqlBuilder.append("project=\"").append(projectKey).append("\"");
if (createdAfter != null) { jqlBuilder.append(" AND created>=\"...\""); }
jqlBuilder.append(" ORDER BY created ASC");
```

**TO-BE** (`JiraDto.PreviewRequest` / `JiraDto.ImportRequest`):
```java
public static class PreviewRequest {
    private LocalDate createdAfter;
    private List<String> statusFilter;   // null 또는 빈 리스트 = 전체
}
```

**TO-BE** (`JiraApiClient`): `statusFilter`를 파라미터로 받아 JQL에 추가:

```
// statusFilter = ["To Do"] 인 경우
status in ("To Do")

// statusFilter = ["To Do", "In Progress"] 인 경우
status in ("To Do","In Progress")

// statusFilter = null 또는 빈 리스트 인 경우
조건 추가 없음 (전체 가져오기)
```

### 3.2 API 설계

배치 삭제 API의 시그니처는 유지된다. 내부 동작만 변경.

| Method | Endpoint | 설명 | Request 변경 | Response 변경 |
|--------|----------|------|-------------|--------------|
| POST | `/api/v1/tasks/batch-delete` | 배치 삭제 | 200개 제한 제거 (필드 변경 없음) | 없음 |
| POST | `/api/v1/projects/{id}/jira/preview` | Jira 미리보기 | `PreviewRequest`에 `statusFilter` 추가 | 없음 |
| POST | `/api/v1/projects/{id}/jira/import` | Jira Import | `ImportRequest`에 `statusFilter` 추가 | 없음 |

### 3.3 서비스 계층

#### TaskService.deleteTasksBatch() — chunk 처리 추가

```java
private static final int DELETE_CHUNK_SIZE = 100;

@Transactional
public int deleteTasksBatch(List<Long> taskIds) {
    if (taskIds == null || taskIds.isEmpty()) return 0;

    int totalDeleted = 0;
    // 100개씩 chunk 분할
    for (int i = 0; i < taskIds.size(); i += DELETE_CHUNK_SIZE) {
        List<Long> chunk = taskIds.subList(i, Math.min(i + DELETE_CHUNK_SIZE, taskIds.size()));

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

    log.info("배치 삭제 완료: 요청={}건, 삭제={}건", taskIds.size(), totalDeleted);
    return totalDeleted;
}
```

#### JiraApiClient — statusFilter 파라미터 추가

```java
// fetchAllBoardIssues 시그니처 변경
public List<JiraDto.JiraIssue> fetchAllBoardIssues(
    String baseUrl, String email, String apiToken,
    String boardId, LocalDate createdAfter, List<String> statusFilter)

// JQL 구성
String jql = buildJql(createdAfter, statusFilter);

// buildJql private 메서드 신규 추가
private String buildJql(LocalDate createdAfter, List<String> statusFilter) {
    List<String> conditions = new ArrayList<>();
    if (createdAfter != null) {
        conditions.add("created>=\"" + createdAfter.format(DateTimeFormatter.ISO_LOCAL_DATE) + "\"");
    }
    if (statusFilter != null && !statusFilter.isEmpty()) {
        // allowlist 검증
        List<String> safe = statusFilter.stream()
            .filter(ALLOWED_STATUS_VALUES::contains)
            .toList();
        if (!safe.isEmpty()) {
            String inClause = safe.stream()
                .map(s -> "\"" + s + "\"")
                .collect(Collectors.joining(","));
            conditions.add("status in (" + inClause + ")");
        }
    }
    return conditions.isEmpty() ? null : String.join(" AND ", conditions);
}

// allowlist (injection 방지)
private static final Set<String> ALLOWED_STATUS_VALUES = Set.of(
    "To Do", "In Progress", "Done", "In Review",
    "Open", "Closed", "Resolved", "Backlog", "On Hold", "Blocked", "Cancelled"
);
```

`fetchIssuesByJql()` 폴백에도 동일하게 `statusFilter`를 파라미터로 추가하고, JQL에 status 조건을 적용한다.

#### JiraImportService — statusFilter 전달

```java
// preview()
LocalDate createdAfter = (request != null) ? request.getCreatedAfter() : null;
List<String> statusFilter = (request != null) ? request.getStatusFilter() : null;

List<JiraDto.JiraIssue> issues = jiraApiClient.fetchAllBoardIssues(
        config.getBaseUrl(), config.getEmail(), config.getApiToken(),
        project.getJiraBoardId(), createdAfter, statusFilter);

// importIssues() 동일 패턴
```

### 3.4 프론트엔드

#### 3.4.1 배치 삭제 제한 제거

`TaskController.batchDelete()`에서 컨트롤러 측 제한만 제거하므로, 프론트엔드 코드 변경 없음. (현재 `batchDeleteSelectedProjectTasks()`, `batchDeleteSelectedTasks()` 양쪽 모두 200개 제한 로직이 없음을 확인함.)

#### 3.4.2 태스크 목록 상태 필터 UI — 프로젝트 태스크 화면

**전역 변수 추가**:
```javascript
var projectTaskStatusFilter = 'TODO';  // 기본값: TODO만 표시
```

**필터 UI HTML** (토글 버튼 그룹 우측에 추가):

이 UI는 `index.html`에 정적으로 추가하지 않는다. `loadProjectTasks` 내부에서 `toggleHtml` 문자열 연결로 동적 생성한다. `{projectId}`는 JS 문자열 연결 시 실제 값으로 대체된다.

```javascript
// toggleHtml 내부에 추가 (JS 문자열 연결)
var activeFilter = projectTaskStatusFilter;
var filterHtml = '<div class="btn-group btn-group-sm ms-2" id="project-status-filter-group">'
  + '<button type="button" class="btn btn-sm ' + (activeFilter==='TODO' ? 'btn-warning' : 'btn-outline-warning') + '" onclick="setProjectStatusFilter(\'TODO\',' + projectId + ')">TODO</button>'
  + '<button type="button" class="btn btn-sm ' + (activeFilter==='IN_PROGRESS' ? 'btn-primary' : 'btn-outline-primary') + '" onclick="setProjectStatusFilter(\'IN_PROGRESS\',' + projectId + ')">진행중</button>'
  + '<button type="button" class="btn btn-sm ' + (activeFilter==='COMPLETED' ? 'btn-success' : 'btn-outline-success') + '" onclick="setProjectStatusFilter(\'COMPLETED\',' + projectId + ')">완료</button>'
  + '<button type="button" class="btn btn-sm ' + (activeFilter==='HOLD' ? 'btn-secondary' : 'btn-outline-secondary') + '" onclick="setProjectStatusFilter(\'HOLD\',' + projectId + ')">홀드</button>'
  + '<button type="button" class="btn btn-sm ' + (activeFilter==='CANCELLED' ? 'btn-danger' : 'btn-outline-danger') + '" onclick="setProjectStatusFilter(\'CANCELLED\',' + projectId + ')">취소</button>'
  + '<button type="button" class="btn btn-sm ' + (activeFilter==='ALL' ? 'btn-dark' : 'btn-outline-dark') + '" onclick="setProjectStatusFilter(\'ALL\',' + projectId + ')">전체</button>'
  + '</div>';
```

**필터링 로직** (`loadProjectTasks` 내부, 렌더링 직전):

```javascript
function applyProjectStatusFilter(tasks) {
    if (projectTaskStatusFilter === 'ALL') return tasks;
    return tasks.filter(function(t) { return t.status === projectTaskStatusFilter; });
}
```

- `flat` 뷰: `allTasks`에 `applyProjectStatusFilter()` 적용 후 렌더
- `grouped` 뷰: 멤버별 그룹화 후 각 그룹의 `tasks` 배열에 `applyProjectStatusFilter()` 적용 후 렌더
- HOLD/CANCELLED 비활성 섹션: `projectTaskStatusFilter`가 `'HOLD'`, `'CANCELLED'`, 또는 `'ALL'`일 때만 표시. HOLD/CANCELLED 선택 시 `inactiveTasks`도 해당 status로 추가 필터링하여 렌더링한다.

> 주의: `applyProjectStatusFilter(tasks)`는 `allTasks`에만 적용한다. 현재 코드에서 HOLD/CANCELLED 태스크는 파싱 시점에 `inactiveTasks`로 분리되어 `allTasks`에 포함되지 않으므로, `applyProjectStatusFilter`로 걸러낼 대상이 없다. HOLD/CANCELLED 필터는 `inactiveTasks` 렌더링 제어(표시/숨김 + 추가 status 필터)로 별도 처리한다.

**`setProjectStatusFilter()` 함수**:
```javascript
function setProjectStatusFilter(status, projectId) {
    projectTaskStatusFilter = status;
    loadProjectTasks(projectId);
}
```

필터 버튼의 active 클래스는 `loadProjectTasks` 렌더링 시 현재 `projectTaskStatusFilter` 값에 맞게 동적으로 생성한다.

#### 3.4.3 태스크 목록 상태 필터 UI — 스케줄 화면

**전역 변수 추가**:
```javascript
var scheduleTaskStatusFilter = 'TODO';  // 기본값: TODO만 표시
```

**필터 UI HTML** (스케줄 큐 패널 상단, 배치 삭제 툴바 위):
- 프로젝트 태스크 화면과 동일한 버튼 그룹 구조
- 버튼 onclick: `setScheduleStatusFilter(status, memberId)` 호출

**필터링 로직**:

```javascript
function applyScheduleStatusFilter(tasks) {
    if (scheduleTaskStatusFilter === 'ALL') return tasks;
    return tasks.filter(function(t) { return t.status === scheduleTaskStatusFilter; });
}
```

`renderScheduleQueue(tasks)` 함수 진입부에서 `tasks`에 `applyScheduleStatusFilter()`를 적용한 후 `ordered` / `unordered` / `parallelTasks` / `inactiveTasks` 분기를 수행한다.

> 근거: `selectScheduleMember()`는 API 응답을 `renderScheduleQueue(res.data)`로 위임한다. `ordered`/`unordered`/`parallelTasks`/`inactiveTasks` 분기 로직은 `renderScheduleQueue()` 내부에 있으므로, 필터는 `renderScheduleQueue()` 진입부에서 적용해야 한다. `selectScheduleMember()` 레벨에서 직접 분기하는 코드는 없다.

스케줄 화면도 HOLD/CANCELLED 구조는 프로젝트 화면과 동일하게 처리한다: `scheduleTaskStatusFilter`가 `'HOLD'`, `'CANCELLED'`, `'ALL'`일 때만 `inactiveTasks` 섹션을 표시한다.

#### 3.4.4 Jira Import 상태 필터 UI

**필터 UI HTML** (index.html의 `jira-import-filter` div 내 createdAfter 아래에 추가):
```html
<div class="mb-3">
  <label class="form-label">
    상태 필터 <small class="text-muted">(가져올 이슈의 Jira 상태를 선택하세요)</small>
  </label>
  <div>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="jira-filter-status-todo"
             value="To Do" checked>
      <label class="form-check-label" for="jira-filter-status-todo">To Do</label>
    </div>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="jira-filter-status-inprogress"
             value="In Progress">
      <label class="form-check-label" for="jira-filter-status-inprogress">In Progress</label>
    </div>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="jira-filter-status-done"
             value="Done">
      <label class="form-check-label" for="jira-filter-status-done">Done</label>
    </div>
    <div class="form-check form-check-inline">
      <input class="form-check-input" type="checkbox" id="jira-filter-status-all"
             value="ALL">
      <label class="form-check-label" for="jira-filter-status-all">전체 (필터 없음)</label>
    </div>
  </div>
  <small class="text-muted">아무것도 선택하지 않으면 "To Do"만 가져옵니다.</small>
</div>
```

**체크박스 "전체" 선택 시 동작**: "전체(필터 없음)"를 체크하면 다른 체크박스를 모두 비활성화/해제하고, `statusFilter`를 빈 리스트로 전달한다.

**`startJiraPreview()` 변경**:

```javascript
// 필터 값 읽기
var statusFilter = [];
var allCheck = document.getElementById('jira-filter-status-all');
if (!allCheck.checked) {
    ['jira-filter-status-todo', 'jira-filter-status-inprogress', 'jira-filter-status-done']
        .forEach(function(id) {
            var cb = document.getElementById(id);
            if (cb && cb.checked) statusFilter.push(cb.value);
        });
    // 아무것도 체크 안 하면 기본값 "To Do"
    if (statusFilter.length === 0) statusFilter = ['To Do'];
}
// executeJiraImport()에서 재사용하기 위해 전역 변수에 저장
jiraPreviewStatusFilter = statusFilter;  // [] = 전체, ['To Do'] 등 = 필터 있음

var body = {};
if (jiraPreviewCreatedAfter) body.createdAfter = jiraPreviewCreatedAfter;
if (statusFilter.length > 0) body.statusFilter = statusFilter;
// allCheck.checked이면 statusFilter를 body에 포함하지 않음 (전체 가져오기)
```

`executeJiraImport()`도 동일하게 `statusFilter`를 body에 포함한다. `startJiraPreview()`에서 `jiraPreviewStatusFilter`에 저장했으므로 재사용한다.

전역 변수 선언 위치: `jiraPreviewCreatedAfter` 선언 바로 아래(app.js 상단 전역 변수 영역).

```javascript
var jiraPreviewStatusFilter = [];  // Jira Import 미리보기에서 사용한 상태 필터
```

**`showJiraImportModal()` 초기화**:

```javascript
// 상태 필터 초기화: "To Do"만 체크
jiraPreviewStatusFilter = [];  // 전역 변수도 함께 초기화
document.getElementById('jira-filter-status-todo').checked = true;
document.getElementById('jira-filter-status-inprogress').checked = false;
document.getElementById('jira-filter-status-done').checked = false;
document.getElementById('jira-filter-status-all').checked = false;
```

**`executeJiraImport()` body 구성 변경** (기존 `importBody.createdAfter` 줄 바로 아래에 추가):

```javascript
// 기존 코드 (유지)
if (jiraPreviewCreatedAfter) {
    importBody.createdAfter = jiraPreviewCreatedAfter;
}
// 추가: statusFilter 전달
if (jiraPreviewStatusFilter && jiraPreviewStatusFilter.length > 0) {
    importBody.statusFilter = jiraPreviewStatusFilter;
}
// jiraPreviewStatusFilter가 빈 배열([])이면 body에 포함하지 않음 (전체 가져오기)
```

**`showJiraFilterStep()` 초기화** (미리보기 → 필터 화면 돌아가기 시에도 상태 필터 UI 유지됨 — 별도 초기화 불필요).

### 3.5 기존 시스템 연동

- 영향받는 기존 코드 요약:

| 파일 | 변경 유형 | 변경 내용 |
|------|-----------|-----------|
| `TaskController.java` | 수정 | 200개 제한 블록 제거 |
| `TaskService.java` | 수정 | `deleteTasksBatch()`에 chunk 루프 추가 |
| `JiraDto.java` | 수정 | `PreviewRequest`, `ImportRequest`에 `statusFilter` 필드 추가 |
| `JiraApiClient.java` | 수정 | `fetchAllBoardIssues()`, `fetchIssuesByJql()` 시그니처 변경, `buildJql()` 추가 |
| `JiraImportService.java` | 수정 | `preview()`, `importIssues()`에서 `statusFilter` 추출 후 전달 |
| `index.html` | 수정 | Jira Import 모달 상태 필터 체크박스 UI 추가 |
| `app.js` | 수정 | 전역 변수 3개 추가(`projectTaskStatusFilter`, `scheduleTaskStatusFilter`, `jiraPreviewStatusFilter`), 필터 함수 2개 추가(`applyProjectStatusFilter`, `applyScheduleStatusFilter`), `setProjectStatusFilter`/`setScheduleStatusFilter` 함수 추가, `loadProjectTasks` 렌더 로직 변경, `renderScheduleQueue` 렌더 로직 변경, Jira 관련 3개 함수 변경 |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | 컨트롤러 200개 제한 제거 | `TaskController.batchDelete()` 검사 블록 3줄 삭제 | 낮음 | 없음 |
| T2 | 서비스 chunk 삭제 구현 | `deleteTasksBatch()`에 `DELETE_CHUNK_SIZE = 100` 상수 및 루프 추가 | 낮음 | T1 |
| T3 | `JiraDto` statusFilter 필드 추가 | `PreviewRequest`, `ImportRequest`에 `List<String> statusFilter` 필드 추가 | 낮음 | 없음 |
| T4 | `JiraApiClient` JQL 개선 | `buildJql()` private 메서드 추가, allowlist 검증, 시그니처 변경 | 중간 | T3 |
| T5 | `JiraImportService` statusFilter 연결 | `preview()`, `importIssues()`에서 statusFilter 추출 및 전달 | 낮음 | T3, T4 |
| T6 | Jira Import 모달 필터 UI 추가 | index.html 체크박스 3개+전체 추가 | 낮음 | 없음 |
| T7 | Jira Import JS 로직 변경 | `showJiraImportModal`, `startJiraPreview`, `executeJiraImport` 수정 | 중간 | T3, T6 |
| T8 | 프로젝트 태스크 상태 필터 (JS) | `projectTaskStatusFilter` 전역 변수, `applyProjectStatusFilter()`, 필터 UI HTML 생성, `loadProjectTasks` 렌더 로직 수정 | 중간 | 없음 |
| T9 | 스케줄 태스크 상태 필터 (JS) | `scheduleTaskStatusFilter` 전역 변수, `applyScheduleStatusFilter()`, 필터 UI HTML 생성, `renderScheduleQueue` 진입부 필터 적용 | 중간 | 없음 |

### 4.2 구현 순서

1. **Step 1 (백엔드 배치 삭제)**: T1 → T2. 컨트롤러 제한 제거 후 서비스 chunk 처리 추가.
2. **Step 2 (백엔드 Jira 상태 필터)**: T3 → T4 → T5. DTO 먼저, JQL 로직, 서비스 연결 순으로.
3. **Step 3 (프론트엔드 Jira 모달)**: T6 → T7. HTML 추가 후 JS 변경.
4. **Step 4 (프론트엔드 상태 필터)**: T8 → T9. 프로젝트 화면 먼저, 스케줄 화면 순으로.

### 4.3 테스트 계획

**단위 테스트 대상**:

- `TaskService.deleteTasksBatch()`
  - 100개 이하 단건 chunk 동작
  - 101개 이상 다중 chunk 분할 동작
  - 500개 이상 대량 삭제 동작
  - 빈 리스트 입력 시 0 반환

- `JiraApiClient.buildJql()`
  - createdAfter + statusFilter 조합 JQL 문자열 검증
  - statusFilter null / 빈 리스트 → 조건 미추가
  - allowlist 외 값 → 해당 값 제외
  - 허용 값만 포함 → 정상 생성

**통합 테스트 시나리오**:

1. 배치 삭제: 250개 태스크를 batch-delete 요청 → 200 OK, 250개 모두 삭제됨
2. Jira Import: `statusFilter: ["To Do"]`로 preview 호출 → 반환된 이슈 status가 모두 "To Do"
3. Jira Import: `statusFilter`를 body에서 제외 → 전체 이슈 반환
4. 프론트엔드 상태 필터: TODO 필터 선택 시 `IN_PROGRESS` 태스크가 목록에서 사라짐
5. 프론트엔드 상태 필터: 전체 선택 시 모든 status 태스크가 표시됨

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

- **chunk 삭제 중 부분 실패**: 단일 `@Transactional` 내에서 루프를 처리하므로, 중간에 예외 발생 시 이미 처리된 chunk도 롤백된다. 부분 커밋을 원한다면 `@Transactional(propagation = REQUIRES_NEW)`를 각 chunk에 적용해야 하지만, 현재 요구사항에서는 전체 롤백이 안전하다고 판단하여 단일 트랜잭션을 유지한다.

- **JQL injection**: statusFilter의 값이 외부 입력이므로 ALLOWED_STATUS_VALUES allowlist로 검증한다. 검증 통과 값만 JQL에 삽입한다.

- **Jira 서버 타임아웃**: statusFilter 추가로 이슈 수가 줄어들어 오히려 성능이 개선된다.

### 5.2 의존성 리스크

- `fetchAllBoardIssues()` 시그니처 변경 → `JiraImportService`를 포함한 모든 호출 지점을 함께 수정해야 한다. 현재 호출 지점은 `JiraImportService.preview()`, `importIssues()` 두 곳뿐이므로 범위가 명확하다.

### 5.3 대안

- **체크박스 대신 select 멀티셀렉트**: UX 단순화를 위해 체크박스를 선택. Bootstrap의 `form-check-inline`으로 한 줄 배치.
- **상태 필터 서버사이드 처리**: 현재 간트 데이터 전체를 받아오므로 프론트엔드 필터로 충분. 태스크가 수천 개 이상이 되면 서버사이드 필터로 전환 고려.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 |
|------|------|
| TaskController | `src/main/java/com/timeline/controller/TaskController.java` |
| TaskService | `src/main/java/com/timeline/service/TaskService.java` |
| JiraDto | `src/main/java/com/timeline/dto/JiraDto.java` |
| JiraApiClient | `src/main/java/com/timeline/service/JiraApiClient.java` |
| JiraImportService | `src/main/java/com/timeline/service/JiraImportService.java` |
| index.html (Jira 모달) | `src/main/resources/static/index.html` (line 1136~1210) |
| app.js (batchDelete) | `src/main/resources/static/js/app.js` (line 1354, 3965) |
| app.js (loadProjectTasks) | `src/main/resources/static/js/app.js` (line 968) |
| app.js (selectScheduleMember) | `src/main/resources/static/js/app.js` (line 3541) |
| app.js (showJiraImportModal) | `src/main/resources/static/js/app.js` (line 4995) |
| app.js (startJiraPreview) | `src/main/resources/static/js/app.js` (line 5027) |
| app.js (executeJiraImport) | `src/main/resources/static/js/app.js` (line 5107) |

### 핵심 확인 사항

- `batchDeleteSelectedProjectTasks()` (line 1354), `batchDeleteSelectedTasks()` (line 3965) — 두 함수 모두 프론트엔드에 200개 제한 코드 없음. 컨트롤러 측 제거만으로 충분.
- `deleteTasksBatch()` 현재 구현은 `findAllById`, `deleteByTaskIdIn`, `deleteAll` 세 쿼리를 단일 호출로 처리. chunk 분리 시 세 쿼리 세트가 chunk 수만큼 반복됨.
- `fetchAllBoardIssues()`는 BadRequest 발생 시 `fetchIssuesByJql()`로 폴백하므로, 두 메서드 모두 `statusFilter` 파라미터를 동일하게 추가해야 한다.
