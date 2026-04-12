# 개발 계획서: Jira Import 기능 대폭 개선

## 1. 개요

### 기능 설명

Jira Import 기능의 UX, 데이터 정확성, 유연성을 전면 개선한다.
주요 변경 사항은 다섯 가지이다.

1. **Import 모달 UX 변경**: 모달 열리자마자 API 호출하던 방식을 필터 설정 화면 → 미리보기 → 실행의 3단계 흐름으로 전환
2. **생성일자 필터**: JQL `created >= "YYYY-MM-DD"` 조건을 적용하여 특정 날짜 이후 생성된 티켓만 가져오기
3. **종료일 필드 개선**: `dueDate` 단일 의존에서 벗어나 `resolutiondate`, Sprint 종료일 등 대안 필드 폴백 적용
4. **태스크에 jiraKey 수동 입력/수정**: 태스크 수정 폼과 미리보기 테이블에서 jiraKey 편집 가능
5. **null 필드 시 기존 값 유지(UPDATE 분기)**: Jira에서 null로 내려오는 필드는 기존 태스크 값을 유지

### 개발 배경 및 목적

- 현재 모달은 열리자마자 Jira API를 호출하여 응답 지연 시 UX가 나쁘고 필요 없는 이슈까지 모두 가져온다.
- `dueDate`만 사용하면 종료일이 시작일과 동일하게 되는 문제가 있어 Sprint 종료일 등 대안 필드가 필요하다.
- 앱에서 수동 생성한 태스크에 Jira 티켓번호를 연결하는 수단이 없다.
- UPDATE 분기에서 Jira의 null 값이 기존 태스크 데이터를 덮어쓰는 문제가 있다(일부 필드에서).

### 작성일

2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: Jira Import 모달을 열면 즉시 API를 호출하지 않고, 필터 조건 설정 화면을 먼저 표시한다.
- **FR-002**: 필터 조건은 "생성일자(이 날짜 이후 생성)" 하나이다. 날짜 미입력 시 전체 이슈를 가져온다.
- **FR-003**: "미리보기" 버튼 클릭 시 필터를 적용하여 Jira API를 호출하고 미리보기 결과를 표시한다.
- **FR-004**: 미리보기 테이블에서 각 행의 jiraKey를 인라인 편집(input 필드)할 수 있다.
- **FR-005**: 미리보기에서 jiraKey를 수정하면 해당 값이 import 시 저장될 jiraKey로 사용된다.
- **FR-006**: 태스크 수정 모달에 jiraKey 입력 필드를 추가하여 수동으로 Jira 티켓번호를 입력/수정할 수 있다.
- **FR-007**: 태스크 수정 저장 시 jiraKey가 전송되어 DB에 반영된다.
- **FR-008**: Jira Board API (`/rest/agile/1.0/board/{boardId}/issue`)가 JQL을 지원하면 `jql` 파라미터로 필터를 적용한다. 지원하지 않으면 Jira Search API (`/rest/api/3/search`)로 대체한다.
- **FR-009**: 종료일(endDate) 결정 로직을 다음 우선순위로 변경한다: `duedate` → `resolutiondate` → Sprint 최소 종료일 → null(기존 값 유지/오늘).
- **FR-010**: UPDATE 분기에서 Jira 응답의 특정 필드가 null/empty인 경우 기존 태스크의 해당 값을 유지한다. 적용 대상: name, description, status, assignee, manDays, startDate, endDate.
- **FR-011**: CREATE 분기는 현재 동작을 유지한다(null이면 null 또는 기존 fallback 적용).

### 2.2 비기능 요구사항

- **NFR-001**: 미리보기 API 호출 중 로딩 인디케이터를 표시하여 사용자가 진행 상황을 인지할 수 있어야 한다.
- **NFR-002**: 생성일자 필터의 날짜 입력은 HTML `<input type="date">`를 사용하여 브라우저 기본 유효성 검증을 활용한다.
- **NFR-003**: 미리보기 테이블의 jiraKey 인라인 편집은 기존 테이블 레이아웃을 크게 변경하지 않는 방향으로 구현한다.

### 2.3 가정 사항

- Jira Board API (`/rest/agile/1.0/board/{boardId}/issue`)는 `jql` 쿼리 파라미터를 지원한다 (Jira Agile REST API 공식 문서 기준). 지원 여부는 구현 중 실제 응답으로 확인한다.
- `resolutiondate`는 Jira 응답의 `fields.resolutiondate` 키에 `"YYYY-MM-DDTHH:MM:SS.sss+ZZZZ"` 형식으로 반환된다.
- Sprint 정보는 `fields.customfield_10020` (Sprint 배열) 안에 `endDate` 필드로 존재한다 (Jira Cloud 기본값).
- 미리보기 테이블에서 jiraKey를 수정하면 import 실행 요청에 해당 수정 내용을 포함하여 전송한다.
- 태스크 수정 폼의 jiraKey는 기존 `PUT /api/v1/tasks/{id}` 엔드포인트를 통해 저장한다(`TaskDto.Request`에 필드 추가).

### 2.4 제외 범위 (Out of Scope)

- Sprint별 그룹핑, Epic별 필터 등 생성일자 이외 추가 필터
- Jira → 앱 양방향 동기화 (현재는 Jira → 앱 단방향 import만)
- Jira 이슈 생성/수정 (앱에서 Jira로 역방향 쓰기)
- Sprint 종료일 외 Sprint 필드(Sprint 이름, Sprint 상태 등) 저장

---

## 3. 시스템 설계

### 3.1 데이터 모델

#### 변경 엔티티: `Task` (`domain/entity/Task.java`)

변경 없음. `jiraKey` 컬럼(`@Column(name = "jira_key", length = 50)`)은 이미 존재한다.

#### 변경 DTO: `TaskDto.Request`

`jiraKey` 필드를 추가한다.

```java
// TaskDto.Request에 추가
private String jiraKey;  // Jira 티켓 번호 (수동 입력용)
```

#### 변경 DTO: `JiraDto`

**`JiraIssue`에 `resolutiondate`, Sprint 종료일 필드 추가:**

```java
// JiraDto.JiraIssue에 추가
private LocalDate resolutionDate;   // resolutiondate 파싱 결과
private LocalDate sprintEndDate;    // Sprint 최소 종료일 파싱 결과
```

**`PreviewItem`에 편집 가능 jiraKey 추가 (이미 존재하나 클라이언트 수정 전송용 필드 확인):**

기존 `PreviewItem.jiraKey`는 Jira에서 가져온 원본 키를 보여주는 용도이다.
미리보기에서 수정된 jiraKey를 import 실행 시 전달하기 위해 `importIssues()` 메서드에 오버라이드 맵을 전달하는 방식을 사용한다.

**새 Request DTO 추가: `JiraDto.ImportRequest`**

```java
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public static class ImportRequest {
    private LocalDate createdAfter;                     // 생성일자 필터 (nullable)
    private Map<String, String> jiraKeyOverrides;       // key: 원본 jiraKey, value: 수정된 jiraKey
}
```

**새 Request DTO 추가: `JiraDto.PreviewRequest`**

```java
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public static class PreviewRequest {
    private LocalDate createdAfter;   // 생성일자 필터 (nullable)
}
```

### 3.2 API 설계

| Method | Endpoint | 설명 | Request Body | Response |
|--------|----------|------|-------------|----------|
| POST | `/api/v1/projects/{projectId}/jira/preview` | 필터 적용 미리보기 | `JiraDto.PreviewRequest` | `{success, data: PreviewResult}` |
| POST | `/api/v1/projects/{projectId}/jira/import` | 필터 + jiraKey 오버라이드 적용 import | `JiraDto.ImportRequest` | `{success, data: ImportResult}` |
| PUT | `/api/v1/tasks/{id}` | (기존) 태스크 수정 — `jiraKey` 필드 추가 | `TaskDto.Request` | `{success, data: TaskDto.Response}` |

**주요 변경점:**

- `GET /api/v1/projects/{projectId}/jira/preview` → `POST`로 변경. 필터 조건이 요청 body에 포함되므로 POST가 적합하다.
- `POST /api/v1/projects/{projectId}/jira/import`는 기존 POST 유지, body에 `ImportRequest` 추가.

### 3.3 서비스 계층

#### `JiraApiClient.java`

**변경: `fetchAllBoardIssues()` → `fetchAllBoardIssues(String baseUrl, String email, String apiToken, String boardId, LocalDate createdAfter)`**

```
createdAfter가 null이 아니면 URL에 &jql=created>="YYYY-MM-DD" 파라미터를 추가한다.
URL 인코딩 처리 필요 (UriComponentsBuilder 사용).

Board API의 &fields= 쿼리 파라미터에 resolutiondate, customfield_10020 을 추가해야
parseIssue()에서 해당 필드를 읽을 수 있다. 현재 fields 목록(기존 코드):
  summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,
  story_points,dueDate,description
변경 후:
  summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,
  story_points,dueDate,description,resolutiondate,customfield_10020

Board API가 JQL을 지원하지 않을 경우를 대비해 HTTP 400 Bad Request
(HttpClientErrorException.BadRequest) 발생 시에만 Search API (/rest/api/3/search)로
폴백한다. 404·403 등 다른 오류는 기존과 동일하게 예외를 그대로 전파한다.
```

**변경: `parseIssue()` — resolutiondate, Sprint 종료일 파싱 추가**

```
fields.resolutiondate -> JiraIssue.resolutionDate (parseLocalDate 재사용)
fields.customfield_10020 (Sprint 배열) -> 활성(active) 또는 가장 늦은 endDate를
  JiraIssue.sprintEndDate로 저장. 이유: 이슈가 여러 Sprint에 속할 때 가장 이른 종료일을
  선택하면 이미 완료된 이전 Sprint가 선택될 위험이 있다.
  구체 로직:
    1) state == "active"인 Sprint의 endDate 우선 사용
    2) active Sprint가 없으면 전체 중 endDate가 가장 늦은 것 사용
    3) endDate 파싱 실패 또는 배열 자체가 null이면 null 반환 (예외 전파 금지)
```

**Search API 폴백 메서드 신규 추가: `fetchIssuesByJql()`**

```java
// /rest/api/3/search 엔드포인트 사용
// jql 파라미터: "project=<boardProject> AND created >= YYYY-MM-DD ORDER BY created ASC"
// 페이지네이션 동일 (maxResults=50, startAt)
// parseIssue()는 동일 구조 재사용
```

#### `JiraImportService.java`

**변경: `preview(Long projectId)` → `preview(Long projectId, JiraDto.PreviewRequest request)`**

```
request.createdAfter를 JiraApiClient에 전달
```

**변경: `importIssues(Long projectId)` → `importIssues(Long projectId, JiraDto.ImportRequest request)`**

```
request.createdAfter를 JiraApiClient에 전달
request.jiraKeyOverrides를 처리: issue.getKey()에 오버라이드가 있으면 해당 값을
  실제 저장 jiraKey로 사용
```

**변경: UPDATE 분기의 null 처리 강화**

현재 코드(일부 필드만 null 보호)를 전체 필드로 확장:

```java
// 현재: name은 무조건 덮어씀
existing.setName(taskName);  // -> null/blank 시 기존 값 유지로 변경

// 현재: assignee는 무조건 덮어씀 (null 포함)
existing.setAssignee(mappedMember);  // -> Jira assignee가 null이면 기존 값 유지

// 현재: manDays는 무조건 덮어씀 (null 포함)
existing.setManDays(issue.getStoryPoints());  // -> null이면 기존 값 유지

// 현재: description은 무조건 덮어씀
existing.setDescription(issue.getDescription());  // -> null이면 기존 값 유지

// 현재: status는 항상 매핑된 값으로 덮어씀 (null이면 mapStatus()가 TODO를 반환하므로
//       실질적으로 기존 값이 TODO로 덮어써지는 문제)
existing.setStatus(mappedStatus);
// -> 변경: Jira status 원문(issue.getStatus())이 null 또는 blank이면 기존 값 유지.
//    mappedStatus가 아닌 issue.getStatus() 기준으로 분기해야 한다.
//    mapStatus()는 null 입력 시 TODO를 반환하므로 mappedStatus만으로는 null 여부 판별 불가.
```

**변경: endDate 폴백 로직 — `resolveDatePair()` 호출 전에 분기 처리**

`resolveDatePair()`는 endDate가 null이면 startDate로 채우는 로직이다. 폴백 4단계("모두
null이면 기존 값 유지")를 구현하려면 `resolveDatePair()` 내부가 아닌 **호출 전** 에 endDate를
결정해야 한다. 두 분기 각각에서 다음 순서로 endDate를 확정한 뒤 `resolveDatePair()`에 전달한다.

```
[UPDATE 분기에서 endDate 결정 순서]
1. issue.getDueDate() 가 null이 아니면 사용
2. null이면 issue.getResolutionDate() 시도
3. null이면 issue.getSprintEndDate() 시도
4. 모두 null이면 기존 existing.getEndDate() 유지
→ 이렇게 결정된 endDate를 resolveDatePair(startDate, endDate, ...) 에 전달

[CREATE 분기에서 endDate 결정 순서]
1. issue.getDueDate() 가 null이 아니면 사용
2. null이면 issue.getResolutionDate() 시도
3. null이면 issue.getSprintEndDate() 시도
4. 모두 null이면 null 그대로 전달 (resolveDatePair가 startDate로 채움)
```

`resolveDatePair()` 자체의 시그니처와 내부 로직 변경은 없다.

#### `TaskService.java`

**변경: `createTask()`, `updateTask()` — jiraKey 필드 처리 추가**

```java
// updateTask: task.setJiraKey(request.getJiraKey()) 추가
// 현재 updateTask()에는 jiraKey 처리 코드가 없다. task.setSortOrder(...) 직후에 추가한다.
// null 전달 시 기존 jiraKey를 지우는 동작이 발생하므로 null 허용 여부를 명확히 한다.
// 본 기획에서는 "null 전달 시 기존 jiraKey를 그대로 유지"를 정책으로 한다:
//   if (request.getJiraKey() != null) {
//       task.setJiraKey(request.getJiraKey().isBlank() ? null : request.getJiraKey().trim());
//   }
// (빈 문자열 전달 시 jiraKey를 지우는 것은 허용)

// createTask: taskBuilder에 .jiraKey(request.getJiraKey()) 추가 (null이면 null 저장)
// 현재 taskBuilder에 jiraKey 필드가 없다. .actualEndDate(...) 직후에 추가한다.
```

### 3.4 프론트엔드

#### Jira Import 모달 (`index.html` + `app.js`)

**3단계 뷰 구조로 변경:**

```
[1단계: 필터 설정] id="jira-import-filter"
  - 생성일자 입력: <input type="date" id="jira-filter-created-after">
  - "미리보기" 버튼: onclick="startJiraPreview()"

[2단계: 로딩] id="jira-import-loading" (기존 재사용)

[3단계: 미리보기 결과] id="jira-import-preview" (기존 재사용, 테이블 수정)
  - 미리보기 테이블에 "Jira Key (편집 가능)" 컬럼 추가
  - 각 행 jiraKey 셀: <input type="text" class="jira-key-override"> 로 변경
  - "다시 필터 설정" 버튼 추가 (1단계로 복귀)
  - "가져오기 실행" 버튼 (기존 jira-import-execute-btn 재사용)

[결과 표시] id="jira-import-result" (기존 재사용)
```

**`showJiraImportModal(projectId)` 변경:**

```
기존: 모달 열리자마자 API 호출
변경: 모달 열리면 1단계(필터 설정) 화면만 표시. API 호출 없음.
```

**신규 함수 `startJiraPreview()`:**

```
1. 날짜 입력값 읽기 (빈 값 허용)
2. createdAfter를 전역 변수(예: jiraPreviewCreatedAfter)에 저장
   → executeJiraImport()에서 body에 포함하기 위해 필요
3. 1단계(jira-import-filter) 숨김, 로딩 화면(jira-import-loading) 표시
   ※ jira-import-filter는 index.html에 신규 추가해야 하는 div id이다
     (기존 HTML에 존재하지 않음)
4. POST /api/v1/projects/{id}/jira/preview, body: {createdAfter: "YYYY-MM-DD" or null}
5. 응답 받으면 미리보기 테이블 렌더링
6. 각 jiraKey 셀을 <input class="jira-key-override" data-original-key="원본키">으로 렌더링
```

**`executeJiraImport()` 변경:**

```
기존: POST /api/v1/projects/{id}/jira/import (body 없음)
변경: 테이블의 <input.jira-key-override> 값을 수집하여
     {createdAfter: ..., jiraKeyOverrides: {"PROJ-1": "APP-1", ...}} body로 전송

jiraKeyOverrides 수집 시 원본 jiraKey는 각 <input>의 data-original-key 속성에서 읽는다.
startJiraPreview()에서 테이블 행을 렌더링할 때 각 <input>에
  data-original-key="<원본 jiraKey>"
를 반드시 기록해두어야 executeJiraImport()에서 키를 식별할 수 있다.
수집 코드 예시:
  var overrides = {};
  document.querySelectorAll('.jira-key-override').forEach(function(input) {
      var orig = input.dataset.originalKey;
      var val = input.value.trim();
      if (orig && val !== orig) { overrides[orig] = val; }
  });
createdAfter는 전역 변수(jiraPreviewCreatedAfter 등)에 저장해두었다가 재사용한다.
```

#### 태스크 수정 모달 (`index.html` + `app.js`)

**`index.html` — 태스크 모달에 jiraKey 입력 필드 추가:**

기존 "실제 완료일" 행(5행) 아래에 jiraKey 필드를 추가한다.

```html
<!-- 6행: Jira 티켓 번호 -->
<div class="row">
    <div class="col-md-4 mb-3">
        <label for="task-jira-key" class="form-label">Jira 티켓 번호</label>
        <input type="text" class="form-control" id="task-jira-key"
               placeholder="예: PROJ-123" maxlength="50">
    </div>
</div>
```

**`app.js` — `showTaskModal()` 에서 jiraKey 필드 초기화/로드:**

```javascript
// 초기화 시
document.getElementById('task-jira-key').value = '';

// 기존 태스크 로드 시
document.getElementById('task-jira-key').value = t.jiraKey || '';
```

**`app.js` — `saveTask()` 에서 jiraKey 포함하여 전송:**

```javascript
var jiraKey = document.getElementById('task-jira-key').value.trim();
// body에 jiraKey 추가
body.jiraKey = jiraKey || null;
```

### 3.5 기존 시스템 연동

**영향 받는 파일:**

| 파일 | 변경 유형 |
|------|---------|
| `JiraApiClient.java` | 메서드 시그니처 변경, parseIssue 확장, fetchIssuesByJql 신규 |
| `JiraImportService.java` | preview/importIssues 시그니처 변경, null 처리 강화, endDate 폴백 |
| `JiraImportController.java` | GET→POST 변경, RequestBody 추가 |
| `JiraDto.java` | JiraIssue 필드 추가, PreviewRequest/ImportRequest 신규 |
| `TaskDto.java` | Request에 jiraKey 필드 추가 |
| `TaskService.java` | createTask/updateTask에서 jiraKey 처리 |
| `index.html` | Jira 모달 HTML 구조 변경, 태스크 모달에 jiraKey 필드 추가 |
| `app.js` | showJiraImportModal, startJiraPreview, executeJiraImport, showTaskModal, saveTask 변경 |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `JiraDto.java` 확장 | PreviewRequest, ImportRequest 추가, JiraIssue에 resolutionDate/sprintEndDate 추가 | 낮음 | - |
| T-02 | `TaskDto.Request`에 jiraKey 추가 | Request 필드 추가 | 낮음 | - |
| T-03 | `JiraApiClient` — createdAfter 파라미터 지원 | fetchAllBoardIssues에 JQL 파라미터 추가 | 중간 | T-01 |
| T-04 | `JiraApiClient` — parseIssue 확장 | resolutiondate, customfield_10020(Sprint) 파싱 | 중간 | T-01 |
| T-05 | `JiraApiClient` — Search API 폴백 | fetchIssuesByJql 구현 | 중간 | T-03 |
| T-06 | `JiraImportService` — preview 시그니처 변경 | PreviewRequest 수신, createdAfter 전달 | 낮음 | T-01, T-03 |
| T-07 | `JiraImportService` — importIssues 변경 | ImportRequest 수신, jiraKeyOverrides 처리 | 중간 | T-01, T-03 |
| T-08 | `JiraImportService` — UPDATE null 처리 강화 | 전 필드 null/empty 시 기존 값 유지 | 낮음 | - |
| T-09 | `JiraImportService` — endDate 폴백 로직 | dueDate → resolutiondate → sprintEndDate 순서 | 낮음 | T-04 |
| T-10 | `JiraImportController` — GET→POST 변경, RequestBody 추가 | 엔드포인트 변경 | 낮음 | T-01, T-06, T-07 |
| T-11 | `TaskService.updateTask` — jiraKey 처리 | request.getJiraKey() 반영 | 낮음 | T-02 |
| T-12 | `index.html` — Jira 모달 HTML 재구성 | 3단계 뷰 구조 | 중간 | - |
| T-13 | `index.html` — 태스크 모달에 jiraKey 필드 추가 | input 필드 추가 | 낮음 | - |
| T-14 | `app.js` — showJiraImportModal 변경 | 즉시 API 호출 제거, 필터 화면 표시 | 낮음 | T-12 |
| T-15 | `app.js` — startJiraPreview 신규 구현 | POST 호출, 테이블 렌더링, jiraKey 인라인 편집 | 중간 | T-10, T-12 |
| T-16 | `app.js` — executeJiraImport 변경 | jiraKeyOverrides 수집 후 POST body로 전송 | 중간 | T-10, T-15 |
| T-17 | `app.js` — showTaskModal/saveTask에 jiraKey 추가 | 기존 로드/저장 로직에 jiraKey 추가 | 낮음 | T-13 |

### 4.2 구현 순서

1. **Step 1: DTO 확장** (T-01, T-02)
   - `JiraDto.PreviewRequest`, `JiraDto.ImportRequest` 추가
   - `JiraDto.JiraIssue`에 `resolutionDate`, `sprintEndDate` 추가
   - `TaskDto.Request`에 `jiraKey` 추가

2. **Step 2: JiraApiClient 확장** (T-03, T-04, T-05)
   - `fetchAllBoardIssues`에 `createdAfter` 파라미터 추가 및 JQL 적용
   - `parseIssue`에서 `resolutiondate`, `customfield_10020` 파싱
   - Board API JQL 미지원 시 Search API 폴백 구현

3. **Step 3: JiraImportService 수정** (T-06, T-07, T-08, T-09)
   - `preview`, `importIssues` 시그니처 변경
   - UPDATE 분기 null 처리 전면 강화
   - endDate 폴백 로직 적용

4. **Step 4: JiraImportController 수정** (T-10)
   - GET → POST 변경, `@RequestBody` 추가

5. **Step 5: TaskService/TaskController jiraKey 처리** (T-11)
   - `updateTask`에서 `request.getJiraKey()` 반영
   - `createTask`에도 동일 적용

6. **Step 6: index.html 수정** (T-12, T-13)
   - Jira Import 모달 HTML 3단계 구조로 재작성
   - 태스크 모달에 jiraKey 입력 필드 추가

7. **Step 7: app.js 수정** (T-14, T-15, T-16, T-17)
   - `showJiraImportModal`, `startJiraPreview`, `executeJiraImport` 구현
   - `showTaskModal`, `saveTask`에 jiraKey 처리 추가

### 4.3 테스트 계획

**단위 테스트 대상:**

- `JiraApiClient.parseIssue()`: resolutiondate, Sprint endDate 파싱 정상/null 케이스
- `JiraImportService.preview()`: createdAfter 조건 적용 확인
- `JiraImportService.importIssues()`: UPDATE 분기의 null 필드 → 기존 값 유지 확인
- `JiraImportService.importIssues()`: jiraKeyOverrides 적용 확인
- `JiraImportService.importIssues()`: endDate 폴백 — dueDate null → resolutionDate → sprintEndDate 순서, resolveDatePair() 호출 전에 결정됨을 확인

**통합 테스트 시나리오:**

1. 생성일자 필터 없이 미리보기 → 전체 이슈 반환 확인
2. 생성일자 필터 적용 미리보기 → 해당 날짜 이후 이슈만 반환 확인
3. 미리보기에서 jiraKey 수정 후 import → 수정된 jiraKey로 저장 확인
4. import 후 기존 태스크 name/assignee null → 기존 값 유지 확인
5. 태스크 수정 모달에서 jiraKey 입력 후 저장 → DB 반영 확인
6. dueDate null, resolutionDate 존재 → resolutionDate가 endDate로 사용 확인

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

**R-01: Board API의 JQL 지원 여부 불확실**
- Jira Agile REST API 문서상 `/rest/agile/1.0/board/{boardId}/issue`는 `jql` 파라미터를 지원한다고 명시되어 있다.
- 그러나 일부 Jira Cloud 버전/플랜에서는 무시될 수 있다.
- 대응: Board API에 JQL 파라미터를 추가하여 시도하고, 필터가 적용되지 않는 경우 Search API 폴백을 사용한다.

**R-02: Search API 사용 시 프로젝트 범위 특정 어려움**
- `/rest/api/3/search`는 프로젝트 키를 JQL에 포함해야 한다 (`project = PROJ-KEY`).
- Board와 연결된 프로젝트 키를 별도로 조회해야 할 수 있다.
- 대응: 폴백 구현 시 Board 메타데이터 API (`/rest/agile/1.0/board/{boardId}`)를 먼저 호출하여 프로젝트 키를 확인한다.

**R-03: Sprint 필드(customfield_10020) 구조 가변성**
- Jira Cloud 인스턴스마다 Sprint 필드 번호 또는 구조가 다를 수 있다.
- 대응: Sprint 파싱 실패 시 `sprintEndDate = null`로 처리하고 다음 폴백으로 이동한다. 예외를 전파하지 않는다.

**R-04: GET → POST 변경으로 기존 호출 코드 깨짐**
- 프론트엔드에서 `GET /api/v1/projects/{id}/jira/preview`를 직접 사용하는 곳이 있다면 변경 필요.
- 대응: `app.js` 내 `apiCall('/api/v1/projects/.../jira/preview')` 호출을 모두 POST로 변경. 현재 호출 지점이 `showJiraImportModal` 하나뿐이므로 범위가 좁다.

### 5.2 UX 고려사항

- 미리보기 테이블의 jiraKey 인라인 편집: 셀이 좁으면 입력이 불편하다. `<input style="min-width:80px; max-width:120px;">` 수준으로 너비를 제한한다.
- "다시 필터 설정" 버튼 클릭 시 기존 미리보기 결과 초기화 여부: 1단계 화면으로 돌아가면 미리보기 결과를 유지하여 날짜만 바꾸고 재조회할 수 있도록 한다.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 역할 |
|------|------|
| `src/main/java/com/timeline/service/JiraApiClient.java` | Jira REST API 호출, 이슈 파싱 |
| `src/main/java/com/timeline/service/JiraImportService.java` | Import/Preview 비즈니스 로직 |
| `src/main/java/com/timeline/controller/JiraImportController.java` | REST 엔드포인트 |
| `src/main/java/com/timeline/dto/JiraDto.java` | Jira 관련 DTO 모음 |
| `src/main/java/com/timeline/dto/TaskDto.java` | Task Request/Response DTO |
| `src/main/java/com/timeline/service/TaskService.java` | `updateTask()` (jiraKey 저장) |
| `src/main/resources/static/index.html` | Jira 모달 (#jiraImportModal), 태스크 모달 (#taskModal) |
| `src/main/resources/static/js/app.js` | `showJiraImportModal()`, `executeJiraImport()`, `showTaskModal()`, `saveTask()` |

### 참고 API 링크

- [Jira Agile REST API — Get issues for board](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-agile-1-0-board-boardid-issue-get) — `jql` 쿼리 파라미터 지원 여부 확인
- [Jira REST API v3 — Search for issues using JQL](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-post) — Search API 폴백용
- [Jira REST API v3 — Get board](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-agile-1-0-board-boardid-get) — Board 메타데이터(프로젝트 키) 조회

### 기존 계획서 참고

- `docs/dev-plan/19-jira-integration.md` — Jira 연동 초기 설계
- `docs/dev-plan/20-jira-import-bug-fixes.md` — 상태 매핑 한글 추가, end_date NOT NULL 버그 수정 (이미 구현 완료 가정)
