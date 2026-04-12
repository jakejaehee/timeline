# 개발 계획서: Jira 연동 기능

## 1. 개요

### 기능 설명
Timeline 프로젝트 관리 시스템에 Jira Cloud 연동 기능을 추가한다. 사용자는 Jira Cloud 인증 정보를 전역 설정에 저장하고, 각 프로젝트에 Jira Board를 연결한 뒤, 이슈를 Timeline 태스크로 가져오거나 기존 연결된 태스크를 동기화할 수 있다.

### 개발 배경 및 목적
- 개발팀이 Jira에서 이슈를 관리하면서 Timeline에서 일정 계획을 수립하는 경우, 이슈를 수동으로 이중 입력하는 불편을 해소한다.
- Jira 이슈 key(예: PROJ-123)를 태스크에 저장해두면 Timeline에서 Jira 티켓 링크로 바로 이동이 가능하다.
- Import/Sync 기능으로 Jira 보드의 최신 상태를 Timeline에 반영할 수 있다.

### 작성일
2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 설정 페이지 "Jira 연동" 탭에서 Jira Cloud URL, 이메일, API Token을 입력·저장·삭제할 수 있다.
- **FR-002**: 설정 저장 시 입력 값으로 Jira API 접속 테스트를 수행하고, 성공/실패 여부를 사용자에게 즉시 알린다.
- **FR-003**: 프로젝트 생성/수정 모달에서 Jira Board ID를 입력할 수 있다.
- **FR-004**: 프로젝트 상세 화면에 "Jira 가져오기" 버튼을 추가한다. 클릭 시 해당 프로젝트에 연결된 Jira Board에서 이슈를 가져온다.
- **FR-005**: 가져오기(Import) 시 이미 `jiraKey`가 동일한 태스크가 존재하면 업데이트(Sync), 없으면 신규 생성한다.
- **FR-006**: 가져오기 완료 후 결과 모달에 생성 N건, 업데이트 N건, 스킵 N건을 표시한다.
- **FR-007**: 태스크 목록(간트차트, 팀 보드)에서 `jiraKey`가 있는 태스크에 Jira 티켓 링크 아이콘을 표시하고, 클릭 시 해당 Jira 이슈 페이지로 이동한다.
- **FR-008**: 필드 매핑 규칙을 적용하여 Jira 이슈 → Timeline 태스크로 변환한다 (아래 2.1.1 참고).

#### 2.1.1 Jira → Timeline 필드 매핑 규칙

| Jira 필드 | Timeline 필드 | 변환 규칙 |
|-----------|--------------|-----------|
| `summary` | `task.name` | 그대로 사용 (최대 300자 truncate) |
| `status.name` | `task.status` | 매핑 테이블 적용 (아래 2.1.2) |
| `assignee.displayName` | `task.assignee` | Member.name 대소문자 무관 일치 검색; 없으면 null |
| `customfield_10016` (story_points) | `task.manDays` | BigDecimal 변환; 없으면 null |
| `customfield_10015` (start_date) | `task.startDate` | Jira Cloud 이슈 레벨 시작일은 표준 필드가 아니며 `customfield_10015`로 제공된다. LocalDate 변환; 없으면 null |
| `dueDate` | `task.endDate` | LocalDate 변환; 없으면 null |
| `description` (plain text) | `task.description` | ADF → plain text 추출; 없으면 null |
| `key` (예: PROJ-123) | `task.jiraKey` | Jira API 응답 최상위 `key` 필드 (`.fields` 하위가 아님). 그대로 저장 |

#### 2.1.2 Jira 상태 → Timeline TaskStatus 기본 매핑

| Jira 상태 (대소문자 무관) | Timeline TaskStatus |
|--------------------------|---------------------|
| To Do, Open, Backlog | TODO |
| In Progress, In Review | IN_PROGRESS |
| Done, Resolved, Closed | COMPLETED |
| On Hold, Blocked | HOLD |
| Cancelled, Won't Do | CANCELLED |
| (그 외 미인식 상태) | TODO (기본값) |

### 2.2 비기능 요구사항

- **NFR-001**: Jira API Token은 평문으로 DB에 저장한다. (향후 암호화 고려 사항으로 명시만 해둠; 현재 단일 사용자·내부 도구 수준이므로 MVP에서는 평문 허용)
- **NFR-002**: Jira API 호출은 `RestTemplate` 또는 `HttpClient`를 사용하며, 타임아웃(connect 5s / read 30s)을 설정한다.
- **NFR-003**: Board에 이슈가 많을 경우 페이지네이션(maxResults 50, startAt 증가)을 통해 전체 이슈를 수집한다.
- **NFR-004**: Jira API 오류(401 인증 실패, 404 Board 없음 등) 발생 시 사용자에게 명확한 에러 메시지를 반환한다.
- **NFR-005**: Import/Sync 작업은 동기 처리하며, 응답이 길어질 수 있으므로 프론트엔드에서 로딩 스피너를 표시한다.

### 2.3 가정 사항

- Jira Cloud(cloud.atlassian.com) 환경만 대상으로 한다. Jira Server/Data Center는 지원하지 않는다.
- Jira 인증 정보는 시스템 전역 단일 설정이다 (프로젝트마다 다른 Jira 계정을 쓰는 경우는 Out of Scope).
- 담당자 매핑은 `Member.name`과 Jira `assignee.displayName`의 정확한 대소문자 무관 일치로만 처리한다. 매칭 실패 시 담당자 없음(null)으로 처리한다.
- Story Points customfield ID는 `customfield_10016`을 기본으로 사용한다. (Jira 인스턴스마다 다를 수 있어 설정 가능성을 고려하나, MVP에서는 하드코딩으로 시작)
- 신규 태스크 생성 시 `domainSystem`은 프로젝트에 연결된 도메인 시스템 중 `ProjectDomainSystem.id` 기준 오름차순 첫 번째를 기본값으로 사용한다. (`projectDomainSystemRepository.findByProjectIdWithDomainSystem(projectId)`의 결과 리스트 첫 번째 항목)
- Import 시 Timeline에서 Jira로의 역방향 동기화(push)는 지원하지 않는다.

### 2.4 제외 범위 (Out of Scope)

- Jira로의 역방향 업데이트 (Timeline → Jira push)
- Jira Server / Data Center 지원
- 멀티 Jira 계정 설정
- Story Points customfield ID 커스터마이징 UI
- Jira Webhook을 통한 실시간 자동 동기화
- Jira 이슈 댓글, 첨부파일 가져오기
- Jira Sprint 정보 가져오기

---

## 3. 시스템 설계

### 3.1 데이터 모델

#### 3.1.1 신규 엔티티: `JiraConfig`

Jira Cloud 전역 설정을 저장하는 엔티티. 단일 레코드(ID=1)로 관리한다.

```java
// com.timeline.domain.entity.JiraConfig
@Entity
@Table(name = "jira_config")
@EntityListeners(AuditingEntityListener.class)
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class JiraConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Jira Cloud 베이스 URL (예: https://yourcompany.atlassian.net) */
    @Column(name = "base_url", length = 500)
    private String baseUrl;

    /** 인증 이메일 */
    @Column(length = 200)
    private String email;

    /** API Token (평문 저장; MVP) */
    @Column(name = "api_token", length = 500)
    private String apiToken;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
```

**테이블명**: `jira_config`
**Hibernate ddl-auto: update**로 자동 생성됨.

#### 3.1.2 기존 엔티티 변경: `Task`

```java
// Task 엔티티에 필드 추가
@Column(name = "jira_key", length = 50)
private String jiraKey;   // 예: "PROJ-123", nullable
```

- 동일 프로젝트 내 `jiraKey` 유니크 제약은 DB 레벨 unique index 대신 서비스 레벨에서 검증한다 (Hibernate update 방식 특성상 index 변경이 번거롭고, 프로젝트 간 동일 jiraKey 허용 필요).

#### 3.1.3 기존 엔티티 변경: `Project`

```java
// Project 엔티티에 필드 추가
@Column(name = "jira_board_id", length = 100)
private String jiraBoardId;   // Jira Board ID (숫자이지만 String으로 저장해 유연성 확보)
```

#### 3.1.4 엔티티 관계 변경 요약

```
JiraConfig (신규, 단일 레코드)
Project    (기존 + jiraBoardId 추가)
Task       (기존 + jiraKey 추가)
```

### 3.2 API 설계

모든 응답은 기존 패턴인 `ResponseEntity<?>` + `Map.of("success", true/false, ...)` 형식을 따른다.

#### 3.2.1 Jira 설정 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/jira/config` | 현재 Jira 설정 조회 (apiToken은 마스킹) |
| PUT | `/api/v1/jira/config` | Jira 설정 저장/갱신 |
| DELETE | `/api/v1/jira/config` | Jira 설정 삭제 |
| POST | `/api/v1/jira/config/test` | 저장 전 연결 테스트 |

**GET `/api/v1/jira/config` Response**
```json
{
  "success": true,
  "data": {
    "baseUrl": "https://yourcompany.atlassian.net",
    "email": "user@example.com",
    "apiTokenMasked": "****-...-****",
    "configured": true
  }
}
```

**PUT `/api/v1/jira/config` Request Body**
```json
{
  "baseUrl": "https://yourcompany.atlassian.net",
  "email": "user@example.com",
  "apiToken": "ATATT3xFfGF0..."
}
```

**POST `/api/v1/jira/config/test` Request Body**
```json
{
  "baseUrl": "https://yourcompany.atlassian.net",
  "email": "user@example.com",
  "apiToken": "ATATT3xFfGF0..."
}
```

**DELETE `/api/v1/jira/config` Response**
```json
{
  "success": true
}
```

설정이 없는 상태에서 DELETE 요청 시에도 `success: true`를 반환한다 (멱등성 보장).

**POST `/api/v1/jira/config/test` Response (성공)**
```json
{
  "success": true,
  "data": { "message": "연결 성공: user@example.com (Jira Cloud)" }
}
```

#### 3.2.2 Jira Import/Sync API

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/projects/{projectId}/jira/import` | Jira Board 이슈 가져오기/동기화 |
| GET | `/api/v1/projects/{projectId}/jira/preview` | Import 전 미리보기 (실제 저장 없음) |

**POST `/api/v1/projects/{projectId}/jira/import` Response**
```json
{
  "success": true,
  "data": {
    "created": 5,
    "updated": 3,
    "skipped": 2,
    "errors": [
      { "jiraKey": "PROJ-99", "reason": "담당자 매핑 실패 (John Doe)" }
    ]
  }
}
```

**GET `/api/v1/projects/{projectId}/jira/preview` Response**
```json
{
  "success": true,
  "data": {
    "totalIssues": 10,
    "toCreate": 5,
    "toUpdate": 3,
    "toSkip": 2,
    "issues": [
      {
        "jiraKey": "PROJ-101",
        "summary": "사용자 로그인 구현",
        "jiraStatus": "In Progress",
        "mappedStatus": "IN_PROGRESS",
        "jiraAssignee": "김철수",
        "mappedAssigneeId": 3,
        "mappedAssigneeName": "김철수",
        "action": "CREATE"
      }
    ]
  }
}
```

#### 3.2.3 Project API 변경

기존 `PUT /api/v1/projects/{id}` 요청 바디에 `jiraBoardId` 필드 추가:

```json
{
  "name": "프로젝트명",
  "jiraBoardId": "123",
  ...
}
```

기존 `GET /api/v1/projects/{id}` 응답에 `jiraBoardId` 필드 추가.

#### 3.2.4 Task API 변경

- 기존 `GET /api/v1/tasks/{id}` 응답에 `jiraKey` 필드 추가.
- 기존 `GET /api/v1/projects/{projectId}/tasks` (간트차트용) 응답의 각 TaskItem에 `jiraKey` 필드 추가.

### 3.3 서비스 계층

#### 3.3.1 신규 클래스: `JiraConfigService`

```
com.timeline.service.JiraConfigService
```

책임:
- `JiraConfigRepository`를 통해 단일 설정 레코드 CRUD
- apiToken 마스킹 처리 (응답 시)
- 설정 존재 여부 확인

#### 3.3.2 신규 클래스: `JiraApiClient`

```
com.timeline.service.JiraApiClient
```

책임:
- Jira Cloud REST API 호출 (Basic Auth)
- `RestTemplate` 기반 HTTP 클라이언트
- Board 이슈 전체 수집 (페이지네이션 자동 처리)
- ADF(Atlassian Document Format) description → plain text 변환

> **설계 결정**: `JiraApiClient`의 메서드는 baseUrl/email/apiToken을 파라미터로 직접 받는다. 이는 연결 테스트(`testConnection`)에서 아직 DB에 저장되지 않은 인증 정보로도 호출할 수 있어야 하기 때문이다. 실제 Import 흐름에서는 `JiraImportService`가 `JiraConfigService.getConfig()`로 설정을 먼저 조회한 뒤 각 파라미터를 추출하여 전달한다.

주요 메서드:
```java
// 연결 테스트: GET {baseUrl}/rest/api/3/myself
JiraUserInfo testConnection(String baseUrl, String email, String apiToken)

// Board 이슈 전체 목록 수집 (페이지네이션)
// 사용 API: GET {baseUrl}/rest/agile/1.0/board/{boardId}/issue
//           ?maxResults=50&startAt={startAt}&fields=summary,status,assignee,customfield_10016,customfield_10015,dueDate,description
//           (customfield_10015: 이슈 시작일, customfield_10016: Story Points)
// 페이지네이션: 응답 total > startAt + maxResults 이면 startAt += maxResults 반복
List<JiraIssue> fetchAllBoardIssues(String baseUrl, String email, String apiToken, String boardId)

// 이슈 단건 상세 조회: GET {baseUrl}/rest/api/3/issue/{issueKey}
JiraIssue fetchIssue(String baseUrl, String email, String apiToken, String issueKey)
```

**내부 DTO (Jira API 응답 파싱용)**:
```
JiraIssue { key, summary, status, assignee, storyPoints, startDate, dueDate, description }
JiraUserInfo { displayName, emailAddress }
```

#### 3.3.3 신규 클래스: `JiraImportService`

```
com.timeline.service.JiraImportService
```

책임:
- `JiraApiClient`로 Board 이슈 수집
- Jira 이슈 → Task 필드 매핑 (상태 매핑, 담당자 매핑, story_points 변환)
- 프로젝트 내 기존 `jiraKey` 확인 후 CREATE / UPDATE 분기
- Import 결과 집계 (`created`, `updated`, `skipped`, `errors`)
- Preview 모드 지원 (DB 저장 없이 결과만 반환)

> **중요 구현 주의**: `JiraImportService`는 `TaskService.createTask()` / `TaskService.updateTask()`를 호출하지 않고, `TaskRepository`를 통해 `Task` 엔티티를 직접 빌드하여 저장한다. `TaskService.createTask()`는 SEQUENTIAL 모드 자동 날짜 계산, 담당자 큐 연쇄 재계산 등을 수행하므로, Jira에서 가져온 날짜 정보를 그대로 보존해야 하는 Import 흐름에 부적합하다. `executionMode`는 Import 시 `PARALLEL`로 고정하여 날짜 자동 계산을 방지한다.

**Jira 상태 → TaskStatus 매핑 로직**:
```java
// Map.of()는 최대 10개 엔트리 제한이 있으므로 Map.ofEntries() 사용
private static final Map<String, TaskStatus> STATUS_MAP = Map.ofEntries(
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
    Map.entry("won't do",    TaskStatus.CANCELLED)
);
// 미인식 상태는 TaskStatus.TODO로 fallback
// 사용: STATUS_MAP.getOrDefault(jiraStatus.toLowerCase(), TaskStatus.TODO)
```

#### 3.3.4 신규 클래스: `JiraConfigController` (컨트롤러 계층)

> 참고: §3.3의 "서비스 계층" 하위 항목이지만 실제로는 컨트롤러 클래스이다.

```
com.timeline.controller.JiraConfigController
@RequestMapping("/api/v1/jira")
```

#### 3.3.5 신규 클래스: `JiraImportController` (컨트롤러 계층)

```
com.timeline.controller.JiraImportController
```

Import 엔드포인트만 담당. `ProjectController`에 추가하지 않고 별도 컨트롤러로 분리하여 단일 책임 원칙 준수.

#### 3.3.6 기존 클래스 변경

| 클래스 | 변경 사항 |
|--------|----------|
| `Task` | `jiraKey` 필드 추가 |
| `Project` | `jiraBoardId` 필드 추가 |
| `TaskDto.Response` | `jiraKey` 필드 추가 |
| `GanttDataDto.TaskItem` | `jiraKey` 필드 추가 |
| `ProjectDto.Request` | `jiraBoardId` 필드 추가 |
| `ProjectDto.Response` | `jiraBoardId` 필드 추가 |
| `ProjectService` | `updateProject` 메서드에서 `jiraBoardId` 반영 |
| `TaskService` | Import 경로는 `TaskService`를 거치지 않음. `createTask`/`updateTask`에 `jiraKey` 반영 불필요 (일반 사용자 태스크 수정에서는 jiraKey 미노출) |

> **주의**: `TaskDto.Request`에 `jiraKey`를 추가하면 일반 사용자가 임의 값을 REST API로 직접 전송할 수 있다. `JiraImportService`는 `JiraApiClient`에서 받은 값으로 `Task` 엔티티를 직접 빌드하므로 `TaskDto.Request`를 경유하지 않는다. `TaskService.createTask/updateTask`에서는 `jiraKey` 세팅 로직을 추가하지 않는다.

### 3.4 프론트엔드

#### 3.4.1 설정 페이지 - "Jira 연동" 탭 추가

`index.html`의 `#settings-tabs`에 탭 항목 추가:
```html
<li class="nav-item">
    <a class="nav-link" data-bs-toggle="tab" href="#settings-jira">Jira 연동</a>
</li>
```

탭 내용 (`#settings-jira` 패널):
```
- Jira Cloud URL 입력 (placeholder: https://yourcompany.atlassian.net)
- 이메일 입력
- API Token 입력 (password 타입)
- [연결 테스트] 버튼 → 성공/실패 badge 표시
- [저장] 버튼
- [설정 삭제] 버튼 (설정이 있을 때만 표시)
- 현재 저장된 설정 요약 표시 (URL, 이메일, 토큰 마스킹)
```

**관련 JS 함수 (app.js 추가)**:
```
loadJiraConfig()          - 현재 설정 로드
saveJiraConfig()          - 설정 저장
testJiraConnection()      - 연결 테스트
deleteJiraConfig()        - 설정 삭제
```

#### 3.4.2 프로젝트 모달 - Jira Board ID 필드 추가

`#projectModal` 내 기존 상태 select 아래에 필드 추가:
```html
<div class="col-md-3 mb-3">
    <label for="project-jira-board-id" class="form-label">Jira Board ID</label>
    <input type="text" class="form-control" id="project-jira-board-id"
           placeholder="예: 123" maxlength="100">
</div>
```

`showProjectModal()`, `saveProject()` 함수에서 `jiraBoardId` 필드 반영.

#### 3.4.3 프로젝트 상세 화면 - "Jira 가져오기" 버튼

프로젝트 상세 뷰에서 `jiraBoardId`가 설정된 경우 버튼 표시. 버튼은 `index.html`에 정적으로 배치하고, `showProjectDetail()` 또는 `renderProjectDetailHeader()` 내에서 `jiraBoardId` 유무에 따라 `display` 제어:
```html
<button class="btn btn-outline-warning btn-sm"
        id="jira-import-btn"
        onclick="showJiraImportModal(currentDetailProjectId)"
        style="display:none;">
    <i class="bi bi-cloud-download"></i> Jira 가져오기
</button>
```

`onclick`에서 `currentDetailProjectId` 전역 변수를 직접 참조한다. `showProjectDetail()`에서 `renderProjectDetailHeader(p)` 호출 시 `p.jiraBoardId`가 있으면 버튼을 표시(`display:''`), 없으면 숨김(`display:'none'`)으로 처리한다.

**관련 JS 함수**:
```
showJiraImportModal(projectId)   - 미리보기 호출 후 결과 모달 표시
executeJiraImport(projectId)     - 실제 Import 실행
```

#### 3.4.4 Jira Import 결과 모달

신규 모달 `#jiraImportResultModal`:
```
- 미리보기 결과 테이블 (jiraKey, summary, action, mappedStatus, mappedAssignee)
- [가져오기 실행] 버튼 → 실행 후 결과(created/updated/skipped/errors) 표시
- 오류 항목이 있으면 경고 표시
```

#### 3.4.5 태스크 목록 - Jira 티켓 링크 아이콘

간트차트 태스크 행 및 팀 보드 카드에 `jiraKey` 있을 때 아이콘 추가:
```html
<!-- 간트차트 커스텀 렌더링 시 -->
<a href="{cachedJiraBaseUrl}/browse/{jiraKey}" target="_blank"
   class="badge bg-info text-decoration-none ms-1"
   title="Jira 티켓 보기">
    <i class="bi bi-link-45deg"></i> {jiraKey}
</a>
```

`cachedJiraBaseUrl`은 전역 변수(`var cachedJiraBaseUrl = null;`)로 관리하며, `loadJiraConfig()` 호출 시 `GET /api/v1/jira/config` 응답의 `baseUrl`로 초기화한다. 링크 렌더링 시 `cachedJiraBaseUrl`이 null이면 아이콘을 표시하지 않는다.

팀 보드 카드(`renderTeamBoardTasks` 함수 또는 현재 코드의 해당 렌더링 함수)에도 동일 패턴 적용.

#### 3.4.6 영향받는 기존 JS 함수

| 함수 | 변경 내용 |
|------|----------|
| `showSection('settings', ...)` | Jira 탭 로드 추가 |
| `loadSettingsSection()` | `loadJiraConfig()` 호출 추가 (실제 함수명: `loadSettingsSection`, `loadSettings()`가 아님) |
| `showProjectModal(project)` | `jiraBoardId` 필드 세팅 |
| `saveProject()` | `jiraBoardId` 포함하여 API 호출 |
| `showProjectDetail(projectId)` | `jiraBoardId` 있으면 Jira 버튼 표시 |
| `renderGanttTasks(...)` | `jiraKey` 있으면 링크 뱃지 렌더링 (현재 미존재 함수 — 간트차트 렌더링 로직에서 `jiraKey` 조건 추가) |
| `renderTeamBoardTasks(...)` | `jiraKey` 있으면 링크 렌더링 (현재 미존재 함수 — 팀 보드 렌더링 로직에서 `jiraKey` 조건 추가) |

### 3.5 기존 시스템 연동

#### 3.5.1 외부 API 연동

- **Jira Cloud REST API v3**: `{baseUrl}/rest/api/3/*`
- **Jira Agile REST API v1**: `{baseUrl}/rest/agile/1.0/*`
- Basic Auth 헤더: `Authorization: Basic base64(email:apiToken)`
- 응답 Content-Type: `application/json`

#### 3.5.2 RestTemplate 빈 설정

기존 `config/` 패키지에 `RestTemplateConfig` 추가:
```java
// com.timeline.config.RestTemplateConfig
@Configuration
public class RestTemplateConfig {
    @Bean
    public RestTemplate jiraRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(30000);
        return new RestTemplate(factory);
    }
}
```

#### 3.5.3 build.gradle 의존성

별도 의존성 추가 불필요. Spring Boot starter-web에 포함된 `RestTemplate` 사용.

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `JiraConfig` 엔티티 + Repository 생성 | 신규 엔티티 클래스, JpaRepository 인터페이스 | 낮음 | - |
| T-02 | `Task.jiraKey` + `Project.jiraBoardId` 필드 추가 | 기존 엔티티 필드 추가, DTO 반영 | 낮음 | - |
| T-03 | `JiraConfigService` 구현 | 설정 CRUD, 마스킹 로직 | 낮음 | T-01 |
| T-04 | `RestTemplateConfig` + `JiraApiClient` 구현 | HTTP 클라이언트, 페이지네이션, ADF 변환 | 높음 | - |
| T-05 | `JiraImportService` 구현 | 필드 매핑, 상태 매핑, CREATE/UPDATE 분기, Preview 모드 | 높음 | T-02, T-03, T-04 |
| T-06 | `JiraConfigController` 구현 | 설정 GET/PUT/DELETE + 연결 테스트 POST | 낮음 | T-03 |
| T-07 | `JiraImportController` 구현 | Import + Preview 엔드포인트 | 낮음 | T-05 |
| T-08 | `ProjectService` + `ProjectDto` 변경 | `jiraBoardId` 필드 반영 | 낮음 | T-02 |
| T-09 | `TaskService` + `TaskDto` + `GanttDataDto` 변경 | `jiraKey` 필드 반영 | 낮음 | T-02 |
| T-10 | 설정 페이지 "Jira 연동" 탭 HTML + JS | 탭 추가, 입력 폼, 저장/테스트 버튼 | 중간 | T-06 |
| T-11 | 프로젝트 모달 `jiraBoardId` 필드 추가 | HTML 필드 추가, JS 함수 수정 | 낮음 | T-08 |
| T-12 | 프로젝트 상세 "Jira 가져오기" 버튼 + Import 결과 모달 | 버튼, 미리보기 테이블, 실행 모달 | 중간 | T-07, T-11 |
| T-13 | 간트차트 + 팀 보드 jiraKey 링크 아이콘 | 렌더링 함수에 아이콘 추가 | 낮음 | T-09 |

### 4.2 구현 순서

1. **Step 1 - 백엔드 기반 작업** (T-01, T-02): 엔티티/DTO 변경. Hibernate ddl-auto: update로 컬럼 자동 추가.
2. **Step 2 - Jira HTTP 클라이언트** (T-04): `JiraApiClient` 구현 및 수동 테스트.
3. **Step 3 - 서비스 계층** (T-03, T-05): `JiraConfigService`, `JiraImportService` 구현.
4. **Step 4 - 기존 서비스/DTO 반영** (T-08, T-09): Project, Task 관련 변경.
5. **Step 5 - 컨트롤러** (T-06, T-07): API 엔드포인트 노출.
6. **Step 6 - 프론트엔드** (T-10, T-11, T-12, T-13): UI 구현.

### 4.3 테스트 계획

#### 단위 테스트 대상

- `JiraApiClient`: Jira API 응답 JSON 파싱, 페이지네이션 로직, ADF → plain text 변환
- `JiraImportService`: 상태 매핑 로직, 담당자 매핑 로직, CREATE/UPDATE/SKIP 분기

#### 통합 테스트 시나리오

1. Jira 설정 저장 → GET으로 조회 → 마스킹 확인
2. 연결 테스트 (유효 토큰 → 성공, 잘못된 토큰 → 실패 응답)
3. Import Preview → 결과 항목 수 확인
4. Import 실행 → 신규 태스크 생성 확인 (jiraKey, name, status 검증)
5. 동일 jiraKey Import 재실행 → 업데이트 확인
6. jiraBoardId 없는 프로젝트에서 Import 요청 → 400 오류 확인
7. Jira 설정 없는 상태에서 Import 요청 → 400 오류 확인

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 리스크 | 설명 | 완화 방안 |
|--------|------|----------|
| Story Points customfield ID 상이 | Jira 인스턴스마다 `customfield_10016`이 아닐 수 있음 | `JiraImportService`에서 여러 후보 필드 순서대로 시도 (`customfield_10016`, `customfield_10028`, `story_points`). 미래 설정 UI 추가 여지 남김 |
| ADF description 파싱 복잡도 | Jira description은 Atlassian Document Format(JSON). 중첩 구조를 plain text로 변환해야 함 | 재귀 text 노드 추출로 처리. 복잡한 블록은 무시 가능 |
| Jira API rate limit | Jira Cloud는 분당 요청 제한 존재 | 이슈 수가 많은 경우 페이지 사이 200ms delay 추가 고려 |
| 인증 정보 보안 | API Token 평문 DB 저장 | 내부 도구 수준 허용(MVP). 향후 AES-256 암호화 + application.yml 키 관리로 개선 가능 |
| domainSystem 자동 배정 | Import 시 domainSystem을 어떻게 결정할지 애매. `Task.domainSystem`은 `nullable=false`이므로 반드시 값이 있어야 함 | 프로젝트에 연결된 첫 번째 domainSystem(`ProjectDomainSystem.id` 오름차순) 사용. domainSystem이 없으면 Import 전체를 즉시 중단하고 400 오류 반환 (이슈 단위 errors 처리가 아님) |

### 5.2 의존성 리스크

- Jira Cloud API 스펙 변경 시 `JiraApiClient` 파싱 로직 수정 필요.
- 현재 `RestTemplate`은 Spring 5부터 유지보수 모드(maintenance mode)에 있으며 deprecated는 아님. WebClient(WebFlux) 또는 Spring 6의 `RestClient`가 권장되나, 단일 스레드 동기 호출 용도로는 계속 사용 가능. 복잡도 최소화 우선.

### 5.3 프론트엔드 고려사항

- Import 작업이 수십 초 걸릴 수 있으므로 버튼 disabled + 로딩 스피너 필수.
- Jira 베이스 URL은 `JiraConfig`에서 가져와야 하며, 프론트엔드가 별도로 저장하지 않는다. 태스크 링크 렌더링 시 `GET /api/v1/jira/config`로 URL을 가져와 캐싱.

---

## 6. 참고 사항

### 6.1 관련 기존 코드 경로

| 항목 | 경로 |
|------|------|
| Task 엔티티 | `src/main/java/com/timeline/domain/entity/Task.java` |
| Project 엔티티 | `src/main/java/com/timeline/domain/entity/Project.java` |
| TaskLink 엔티티 (링크 참조용) | `src/main/java/com/timeline/domain/entity/TaskLink.java` |
| TaskDto | `src/main/java/com/timeline/dto/TaskDto.java` |
| ProjectDto | `src/main/java/com/timeline/dto/ProjectDto.java` |
| GanttDataDto | `src/main/java/com/timeline/dto/GanttDataDto.java` |
| TaskService | `src/main/java/com/timeline/service/TaskService.java` |
| ProjectService | `src/main/java/com/timeline/service/ProjectService.java` |
| GlobalExceptionHandler | `src/main/java/com/timeline/exception/GlobalExceptionHandler.java` |
| ClaudeCliProperties (설정 클래스 참조용) | `src/main/java/com/timeline/config/ClaudeCliProperties.java` |
| application.yml | `src/main/resources/application.yml` |
| 프론트엔드 HTML | `src/main/resources/static/index.html` |
| 프론트엔드 JS | `src/main/resources/static/js/app.js` |

### 6.2 신규 파일 목록 (예상)

```
src/main/java/com/timeline/domain/entity/JiraConfig.java
src/main/java/com/timeline/domain/repository/JiraConfigRepository.java   ← 기존 repository와 동일 패키지
src/main/java/com/timeline/service/JiraConfigService.java
src/main/java/com/timeline/service/JiraApiClient.java
src/main/java/com/timeline/service/JiraImportService.java
src/main/java/com/timeline/controller/JiraConfigController.java
src/main/java/com/timeline/controller/JiraImportController.java
src/main/java/com/timeline/dto/JiraDto.java  (Request/Response inner classes)
src/main/java/com/timeline/config/RestTemplateConfig.java
```

### 6.3 참고 API 문서

- Jira Cloud REST API v3: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- Jira Agile REST API v1: https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
- Basic Auth for Jira Cloud: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
- Atlassian Document Format: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
