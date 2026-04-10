# 개발 계획서: 태스크 기능 확장 (링크 추가, 병렬/순차 설정, Team Board CRUD)

- 작성일: 2026-04-11
- 작성 기준 브랜치: main (bc43fff)

---

## 1. 개요

### 1.1 기능 설명

이번 개발에서는 기존 태스크 시스템에 세 가지 기능을 추가한다.

1. **Team Board CRUD 확장**: 현재 Team Board(전체 프로젝트 뷰)에서 태스크 클릭 시 readOnly 상세보기만 가능한 것을 완전한 CRUD로 확장한다.
2. **태스크 링크 관리**: 태스크에 외부 링크(Jira ticket, Confluence 위키 등)를 여러 개 첨부할 수 있도록 한다.
3. **병렬/순차 실행 모드**: 태스크별로 `parallel` 또는 `sequential` 모드를 설정하여, sequential 태스크는 기존처럼 담당자 날짜 겹침 충돌을 검증하고, parallel 태스크는 동시 병행 작업을 허용한다.

### 1.2 개발 배경 및 목적

- Team Board는 전체 팀의 작업 현황을 파악하는 허브인데, 현재 수정/삭제가 불가능해 운영 중 불편이 발생한다.
- 태스크에 Jira, Confluence 등 외부 참조 링크를 연결할 수 없어 컨텍스트 이동이 불편하다.
- 실무에서는 한 사람이 복수의 업무를 병행하는 경우가 있는데(예: 공통 컴포넌트 작업), 현재 충돌 검증이 이를 허용하지 않아 데이터 입력이 어렵다.

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: Team Board 화면에서 태스크 클릭 시 수정/삭제 버튼을 활성화한다.
- FR-002: Team Board의 태스크 수정 모달에서 도메인 시스템, 담당자(필수), 날짜, 공수(필수), 상태, 설명을 수정할 수 있다. 담당자와 공수는 현재 `saveTask()` 로직에서 필수로 검증하므로, Team Board 수정 시에도 동일하게 적용된다.
- FR-003: Team Board의 태스크 수정 시 소속 프로젝트 ID를 기반으로 도메인 시스템 및 멤버 목록을 로드한다.
- FR-004: Team Board의 태스크 삭제 시 확인 다이얼로그를 표시하고, 삭제 후 보드를 새로고침한다.
- FR-005: 태스크에 외부 링크(URL + 라벨)를 하나 이상 추가/수정/삭제할 수 있다.
- FR-006: 태스크 상세 화면에서 첨부된 링크를 클릭하면 새 탭에서 URL이 열린다.
- FR-007: 태스크에 `parallel` 또는 `sequential` 실행 모드를 설정할 수 있다. 기본값은 `sequential`이다.
- FR-008: `sequential` 태스크 생성/수정 시 동일 담당자의 날짜 겹침이 있으면 `AssigneeConflictException`을 발생시킨다.
- FR-009: `parallel` 태스크 생성/수정 시 담당자 날짜 겹침 검증을 건너뛴다.
- FR-010: 충돌 검증 시, 겹치는 상대 태스크가 `parallel`이면 해당 태스크는 충돌 대상에서 제외한다 (양쪽 모두 parallel일 때만 충돌 면제).

### 2.2 비기능 요구사항

- NFR-001: 태스크 링크 테이블은 태스크 삭제 시 Cascade 삭제된다. `Task` 엔티티에 `@OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)`로 설정하거나, `TaskService.deleteTask()`에서 `taskLinkRepository.deleteByTaskId(taskId)`를 명시적으로 호출한다. 두 방식 중 하나만 선택하여 구현한다(중복 적용 금지).
- NFR-002: URL 값은 최대 2000자, 라벨은 최대 200자로 제한한다.
- NFR-003: 태스크 링크 최대 개수는 10개로 제한한다 (서비스 레이어 검증).
- NFR-004: Team Board의 CRUD는 기존 `TaskService`, `TaskController`를 그대로 재사용한다. 새 엔드포인트를 추가하지 않는다.
- NFR-005: 기존 `parallel` 여부와 무관하게 동작하던 충돌 검증 쿼리를 변경한다. `sequential` 태스크끼리만 충돌하도록 JPQL을 수정한다.

### 2.3 가정 사항

- Team Board에서 태스크를 수정할 때도 `currentProjectId` 전역 변수 대신, 태스크의 `projectId` 필드를 활용하여 프로젝트의 도메인 시스템/멤버 목록을 로드한다.
- 태스크 링크는 별도의 엔티티(`TaskLink`)로 관리한다. Task 엔티티의 컬럼이 아닌 별도 테이블(`task_link`)로 분리한다.
- `parallel` 모드의 충돌 면제 범위: 새로 생성/수정하려는 태스크가 `parallel`이면 모든 겹침을 면제한다. 새 태스크가 `sequential`이더라도, 기존에 겹치는 태스크가 `parallel`이면 그 태스크는 충돌 카운트에서 제외한다.
- Team Board에서 의존관계(선행 태스크) 설정은 이번 범위에 포함하지 않는다. 의존관계 변경은 간트차트 뷰에서만 한다.
- 태스크 링크 순서 정렬은 생성일(createdAt) 오름차순을 기본으로 한다.

### 2.4 제외 범위 (Out of Scope)

- Team Board에서 태스크 신규 생성 (수정/삭제만 허용)
- 의존관계 설정을 Team Board 뷰에서 편집
- 태스크 링크에 대한 별도 조회/검색 기능
- parallel 태스크의 UI 색상/아이콘 구분 (추후 개선)
- 링크 URL 유효성 검사 (형식 검사만 수행, 실제 접근 가능 여부는 검사하지 않음)

---

## 3. 시스템 설계

### 3.1 데이터 모델

#### 3.1.1 Task 엔티티 변경 (기존 필드에 추가)

파일: `src/main/java/com/timeline/domain/entity/Task.java`

추가 필드:

```
executionMode: ENUM('SEQUENTIAL', 'PARALLEL'), NOT NULL, DEFAULT 'SEQUENTIAL'
```

- `SEQUENTIAL`: 기존 동작. 동일 담당자의 날짜 겹침 시 `AssigneeConflictException` 발생.
- `PARALLEL`: 동일 담당자의 동시 작업 허용. 충돌 검증 건너뜀.

#### 3.1.2 TaskLink 신규 엔티티

파일: `src/main/java/com/timeline/domain/entity/TaskLink.java`

| 컬럼명       | 타입         | 제약               | 설명                     |
|-----------|-----------|--------------------|------------------------|
| id        | BIGINT    | PK, AUTO_INCREMENT |                        |
| task_id   | BIGINT    | FK → task(id), NOT NULL | 소속 태스크              |
| url       | VARCHAR(2000) | NOT NULL          | 링크 URL               |
| label     | VARCHAR(200) | NOT NULL          | 링크 라벨 (표시 이름)      |
| created_at| TIMESTAMP | NOT NULL, IMMUTABLE | 생성일시 (감사 필드)      |

관계: `Task` 1 : N `TaskLink` (Cascade REMOVE)

#### 3.1.3 TaskExecutionMode 신규 Enum

파일: `src/main/java/com/timeline/domain/enums/TaskExecutionMode.java`

```
SEQUENTIAL  // 순차: 담당자 날짜 겹침 불허
PARALLEL    // 병렬: 담당자 날짜 겹침 허용
```

### 3.2 API 설계

#### 3.2.1 기존 API 변경 (Request/Response 필드 추가)

**태스크 생성/수정 Request 변경**

`POST /api/v1/projects/{projectId}/tasks`
`PUT /api/v1/tasks/{id}`

Request body에 신규 필드 추가:

```json
{
  "name": "API 개발",
  "executionMode": "PARALLEL",
  "links": [
    { "url": "https://jira.example.com/browse/PROJ-123", "label": "Jira 티켓" },
    { "url": "https://confluence.example.com/pages/123", "label": "설계 문서" }
  ]
}
```

- `executionMode`: `SEQUENTIAL` 또는 `PARALLEL`. 생략 시 `SEQUENTIAL`.
- `links`: 링크 목록. 수정 시 전체 교체(replace-all) 방식으로 처리. 빈 배열 전송 시 전체 삭제.

**태스크 상세 Response 변경**

`GET /api/v1/tasks/{id}`

Response body에 신규 필드 추가:

```json
{
  "id": 1,
  "executionMode": "PARALLEL",
  "links": [
    { "id": 10, "url": "https://...", "label": "Jira 티켓" }
  ]
}
```

#### 3.2.2 태스크 링크 전용 API (선택적, 편의 제공)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/v1/tasks/{id}/links | 태스크의 링크 목록 조회 |
| POST | /api/v1/tasks/{id}/links | 링크 단건 추가 |
| DELETE | /api/v1/tasks/{id}/links/{linkId} | 링크 단건 삭제 |

> 태스크 저장(생성/수정) 시 `links` 배열로 일괄 관리하는 것이 주 방식이며, 위 API는 편의용 보조 API로 위치한다.

Request body (POST):
```json
{ "url": "https://jira.example.com/browse/PROJ-123", "label": "Jira 티켓" }
```

Response (GET):
```json
{
  "success": true,
  "data": [
    { "id": 10, "url": "https://...", "label": "Jira 티켓", "createdAt": "2026-04-11T10:00:00" }
  ]
}
```

### 3.3 서비스 계층

#### 3.3.1 TaskLinkRepository (신규)

파일: `src/main/java/com/timeline/domain/repository/TaskLinkRepository.java`

필요 메서드:
- `findByTaskIdOrderByCreatedAtAsc(Long taskId)` — 태스크의 링크 목록 조회
- `deleteByTaskId(Long taskId)` — 태스크 삭제 시 일괄 삭제 (직접 호출 또는 Cascade)
- `countByTaskId(Long taskId)` — 링크 개수 제한 검증

#### 3.3.2 TaskService 변경

파일: `src/main/java/com/timeline/service/TaskService.java`

**`createTask` 변경:**
1. `request.getExecutionMode()`로 실행 모드 설정 (기본 `SEQUENTIAL`)
2. 담당자 충돌 검증: `executionMode == SEQUENTIAL`인 경우에만 `validateAssigneeConflict()` 호출
3. Task 저장 후 `links` 목록이 있으면 `TaskLink` 엔티티를 순서대로 저장

**`updateTask` 변경:**
1. `request.getExecutionMode()`로 실행 모드 업데이트
2. 담당자 충돌 검증: 동일 조건 (`SEQUENTIAL`인 경우에만)
3. 기존 링크 전체 삭제 후 `request.getLinks()`로 새 링크 저장 (replace-all)

**`deleteTask` 변경:**
1. NFR-001 참고: Cascade 방식과 명시적 삭제 중 하나만 선택. Cascade를 선택한 경우 이 단계 불필요. 명시적 삭제를 선택한 경우: 기존 의존관계 삭제 후 `taskLinkRepository.deleteByTaskId(taskId)` 호출 추가.

**`validateAssigneeConflict` 변경:**
- 현재: 동일 담당자의 모든 겹치는 태스크를 조회
- 변경 후: 겹치는 태스크 중 `executionMode = SEQUENTIAL`인 것만 충돌 대상으로 집계
- `findOverlappingTasks` 메서드 시그니처에 `@Param("sequentialMode") TaskExecutionMode sequentialMode` 파라미터를 추가하고, 호출부에서 `TaskExecutionMode.SEQUENTIAL`을 전달한다.

JPQL 변경:
```jpql
-- 기존 (TaskRepository.findOverlappingTasks)
SELECT t FROM Task t
JOIN FETCH t.project
JOIN FETCH t.domainSystem
WHERE t.assignee.id = :assigneeId
AND t.startDate <= :endDate
AND t.endDate >= :startDate
AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId)

-- 변경 후
SELECT t FROM Task t
JOIN FETCH t.project
JOIN FETCH t.domainSystem
WHERE t.assignee.id = :assigneeId
AND t.startDate <= :endDate
AND t.endDate >= :startDate
AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId)
AND t.executionMode = :sequentialMode
```

> JPQL에서 Enum 값을 문자열 리터럴(`'SEQUENTIAL'`)로 직접 비교하면 런타임 오류가 발생한다. 파라미터 바인딩 방식을 사용해야 한다. `@Param("sequentialMode") TaskExecutionMode sequentialMode`를 메서드 시그니처에 추가하고, 호출부에서 `TaskExecutionMode.SEQUENTIAL`을 전달한다.
>
> 즉, `PARALLEL` 태스크가 이미 기간을 점유하고 있어도 새 `SEQUENTIAL` 태스크 배정이 가능하다. 반대로 새 태스크가 `PARALLEL`이면 `validateAssigneeConflict` 자체를 호출하지 않는다.

#### 3.3.3 TaskLinkService (신규 또는 TaskService 통합)

링크 CRUD 로직을 `TaskService` 내부에 private 메서드로 통합하는 방식을 권장한다. 규모가 작고 Task와 분리할 이유가 없다.

주요 로직:
- 링크 저장 전 개수 제한 검증: `10개 초과 시 IllegalArgumentException`
- URL blank 검증: URL이 비어 있으면 해당 링크 항목 skip 또는 예외 처리
- 라벨 미입력 시 URL 앞 50자를 라벨로 자동 설정 (편의 기능, 선택)

#### 3.3.4 TeamBoardService (변경 없음)

Team Board의 CRUD는 프론트엔드에서 기존 `TaskController` API (`PUT /api/v1/tasks/{id}`, `DELETE /api/v1/tasks/{id}`)를 직접 호출하므로 서비스 계층 변경이 없다.

다만, `TeamBoardDto.TaskItem`에 `executionMode`와 `links` 필드를 추가하여 Team Board 렌더링 시 참조할 수 있도록 한다.

### 3.4 DTO 변경

#### 3.4.1 TaskDto.Request 필드 추가

```java
private TaskExecutionMode executionMode;   // null 시 SEQUENTIAL 기본값 적용
private List<TaskLinkRequest> links;       // null 또는 빈 배열 허용

// 내부 정적 클래스
public static class TaskLinkRequest {
    private String url;
    private String label;
}
```

#### 3.4.2 TaskDto.Response 필드 추가

```java
private TaskExecutionMode executionMode;
private List<TaskLinkResponse> links;

// 내부 정적 클래스
public static class TaskLinkResponse {
    private Long id;
    private String url;
    private String label;
    private LocalDateTime createdAt;  // §3.2.2 GET /api/v1/tasks/{id}/links 응답과 일치시키기 위해 포함
}
```

#### 3.4.3 TeamBoardDto.TaskItem 필드 추가

```java
private TaskExecutionMode executionMode;
```

> §5.1의 리스크 검토에 따라 Team Board에서 링크를 직접 표시하지 않는 방식(상세 팝업에서 `GET /api/v1/tasks/{id}` 재조회)을 채택한다. 따라서 `TeamBoardDto.TaskItem`에 `links` 필드는 추가하지 않으며 N+1 문제를 회피한다. `executionMode`만 추가하여 Team Board 행 렌더링 시 참조 가능하도록 한다.

`TeamBoardDto.TaskItem.from(Task task)` 정적 팩토리 메서드를 수정하여 실행 모드를 포함한다.

#### 3.4.4 GanttDataDto.TaskItem 필드 추가 (선택)

간트차트 뷰에서도 링크와 실행 모드를 표시하는 경우 추가한다. 태스크 상세는 `GET /api/v1/tasks/{id}`를 통해 별도 조회하므로, `GanttDataDto`에는 `executionMode`만 추가하고 링크는 상세 팝업에서 조회해도 충분하다.

### 3.5 프론트엔드

#### 3.5.1 태스크 생성/수정 모달 (`taskModal`) 변경

**추가 UI 요소:**

1. **실행 모드 선택 (라디오 버튼 또는 select)**
   ```
   실행 모드: [SEQUENTIAL (순차)] [PARALLEL (병렬)]
   ```
   - 기본값: `SEQUENTIAL`
   - `PARALLEL` 선택 시 담당자 충돌 사전 경고(`checkAssigneeConflict`) UI를 숨기거나 "병렬 모드에서는 충돌 검증을 건너뜁니다" 안내 문구를 표시한다.

2. **링크 관리 섹션**
   ```
   [+ 링크 추가] 버튼
   ─────────────────────────────────────────
   [라벨 입력]  [URL 입력]  [X 삭제]
   [라벨 입력]  [URL 입력]  [X 삭제]
   ```
   - 링크 행을 동적으로 추가/삭제한다 (DOM 조작).
   - 최대 10개 제한 (10개 초과 시 "링크 추가" 버튼 비활성화).

**`showTaskModal(taskId)` 변경:**
- 기존 데이터 로드 시 `executionMode` 필드를 폼에 반영한다.
- 기존 `links` 배열을 렌더링하여 각 링크 행을 초기화한다.

**`saveTask()` 변경:**
- `executionMode` 값을 body에 포함한다.
- 링크 행을 순회하여 `links` 배열을 구성하고 body에 포함한다.

#### 3.5.2 태스크 상세 팝업 (`taskDetailModal`) 변경

- `executionMode` 행 추가: "실행 모드 | SEQUENTIAL" 또는 "PARALLEL" 표시
- 링크 목록 행 추가: 각 링크를 `<a href="..." target="_blank">` 형태로 렌더링
- Team Board 뷰에서 상세 팝업의 수정/삭제 버튼 활성화

#### 3.5.3 Team Board의 readOnly 제거

현재 `showTeamBoardTaskDetail(taskId)` 함수:
```javascript
function showTeamBoardTaskDetail(taskId) {
    showTaskDetail(taskId, { readOnly: true });  // 변경 전
}
```

변경 후:
```javascript
function showTeamBoardTaskDetail(taskId, projectId) {
    // projectId를 전달하여 taskModal에서 도메인 시스템/멤버 로드 시 사용
    showTaskDetail(taskId, { readOnly: false, projectId: projectId });
}
```

Team Board 렌더링 시 각 태스크 행에 `projectId`를 함께 전달:
```javascript
html += '<tr onclick="showTeamBoardTaskDetail(' + task.id + ', ' + task.projectId + ')">';
```

**`showTaskModal(taskId, projectId)` 변경:**
- `projectId` 파라미터를 추가하여 `currentProjectId` 대신 명시적 `projectId`를 사용할 수 있도록 한다.
- Team Board 컨텍스트에서 호출 시 `projectId`를 직접 사용한다.

**삭제 후 처리:**
- 간트차트 뷰: 기존처럼 `loadGanttData(currentProjectId)` 호출
- Team Board 뷰: `applyTeamBoardFilter()` 호출

이를 위해 삭제 버튼 핸들러에 컨텍스트 정보(현재 뷰)를 전달하거나, 삭제 완료 후 현재 섹션(`currentSection`)에 따라 분기한다.

**`saveTask()` 저장 후 처리 변경:**
- 현재: `await loadGanttData(currentProjectId)` 고정 호출
- 변경 후: `currentSection`에 따라 분기
  - 간트차트 컨텍스트: `loadGanttData(currentProjectId)`
  - Team Board 컨텍스트: `applyTeamBoardFilter()`
- Team Board에서 수정 시 `currentProjectId`가 null이므로 기존 코드를 그대로 두면 오류가 발생한다.

**`showTaskModal` 의존관계 섹션 처리:**
- Team Board 컨텍스트에서 `showTaskModal`을 호출하면 `currentGanttData`가 갱신되지 않아 의존관계 체크리스트가 빈 상태로 표시된다.
- §2.4에서 Team Board의 의존관계 편집은 Out of Scope이므로, `projectId` 파라미터가 명시적으로 전달된 경우(Team Board 컨텍스트)에는 의존관계 섹션을 숨김 처리한다.

#### 3.5.4 `checkAssigneeConflict` 변경

실행 모드가 `PARALLEL`인 경우 충돌 사전 경고를 건너뛴다:

```javascript
async function checkAssigneeConflict() {
    var executionMode = document.getElementById('task-execution-mode').value;
    var warningEl = document.getElementById('task-assignee-conflict-warning');
    if (executionMode === 'PARALLEL') {
        // 경고 숨김 처리
        warningEl.style.display = 'none';
        warningEl.innerHTML = '';
        return;
    }
    // 기존 로직 ...
}
```

> 주의: `checkAssigneeConflict`는 `/api/v1/members/{id}/tasks`를 호출하여 `TeamBoardDto.TaskItem` 형식(projectName 포함)의 응답을 처리한다. 현재 프론트엔드 경고 로직은 담당자의 모든 태스크를 조회하여 날짜 겹침을 판단하는데, 기존 `PARALLEL` 태스크와 겹쳐도 경고가 표시될 수 있다(프론트엔드 사전 경고는 참고용이며, 실제 저장 여부는 서버 검증이 결정). 이는 의도된 동작으로, 사용자가 모드를 확인하고 인지한 상태에서 저장하도록 유도한다.

### 3.6 기존 시스템 연동

#### 영향 받는 기존 코드

| 파일 | 변경 유형 | 상세 |
|------|----------|------|
| `Task.java` | 필드 추가 | `executionMode` 컬럼 추가 |
| `TaskDto.java` | 필드 추가 | Request/Response에 `executionMode`, `links` 추가 |
| `TaskService.java` | 로직 변경 | 충돌 검증 조건 변경, 링크 저장/삭제 로직 추가 |
| `TaskRepository.java` | 쿼리 변경 | `findOverlappingTasks` JPQL에 `executionMode` 조건 추가 |
| `TaskController.java` | 엔드포인트 추가 | 링크 전용 CRUD API 추가 |
| `TeamBoardDto.java` | 필드 추가 | `executionMode` 추가 (`links`는 미추가, §3.4.3 참고) |
| `GanttDataDto.java` | 필드 추가 (선택) | `executionMode` 추가 |
| `app.js` | UI 변경 | 모달 UI 확장, Team Board readOnly 제거, 링크 렌더링 |
| `index.html` | HTML 변경 | taskModal에 실행 모드 및 링크 섹션 추가 |

#### 신규 파일

| 파일 | 설명 |
|------|------|
| `TaskLink.java` | 태스크 링크 엔티티 |
| `TaskExecutionMode.java` | SEQUENTIAL/PARALLEL Enum |
| `TaskLinkRepository.java` | 링크 레포지토리 |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | TaskExecutionMode Enum 생성 | SEQUENTIAL/PARALLEL Enum | 낮음 | 없음 |
| T-02 | TaskLink 엔티티 생성 | task_link 테이블 매핑 | 낮음 | 없음 |
| T-03 | TaskLinkRepository 생성 | JPA 레포지토리 | 낮음 | T-02 |
| T-04 | Task 엔티티 필드 추가 | executionMode 필드 추가 | 낮음 | T-01 |
| T-05 | TaskDto 변경 | Request/Response 필드 추가 및 내부 클래스 추가 | 낮음 | T-01, T-02 |
| T-06 | TeamBoardDto 변경 | TaskItem 필드 추가 | 낮음 | T-01, T-05 |
| T-07 | TaskRepository 쿼리 변경 | findOverlappingTasks JPQL 수정 | 중간 | T-01, T-04 |
| T-08 | TaskService 로직 변경 | 충돌 검증 조건 변경, 링크 CRUD 통합 | 높음 | T-03, T-04, T-05, T-07 |
| T-09 | TaskController 링크 API 추가 | GET/POST/DELETE /tasks/{id}/links | 중간 | T-08 |
| T-10 | index.html 태스크 모달 UI 변경 | 실행 모드 select, 링크 섹션 추가 | 중간 | 없음 |
| T-11 | app.js 태스크 모달 로직 변경 | showTaskModal/saveTask 변경, 링크 동적 UI | 높음 | T-10 |
| T-12 | app.js 태스크 상세 팝업 변경 | executionMode, links 렌더링, Team Board 버튼 활성화 | 중간 | T-11 |
| T-13 | app.js Team Board CRUD 활성화 | showTeamBoardTaskDetail readOnly 제거, 수정/삭제 후 새로고침 | 중간 | T-12 |
| T-14 | app.js checkAssigneeConflict 변경 | PARALLEL 모드 시 경고 건너뜀 | 낮음 | T-11 |

### 4.2 구현 순서

1. **Step 1 - 백엔드 도메인 모델**: T-01, T-02, T-04 (Enum, 엔티티, Task 필드 추가)
2. **Step 2 - 백엔드 레포지토리 및 DTO**: T-03, T-05, T-06, T-07
3. **Step 3 - 백엔드 서비스/컨트롤러**: T-08, T-09
4. **Step 4 - 프론트엔드 HTML**: T-10
5. **Step 5 - 프론트엔드 JS (모달 로직)**: T-11, T-14
6. **Step 6 - 프론트엔드 JS (상세/Team Board)**: T-12, T-13

### 4.3 테스트 계획

**단위 테스트 대상:**
- `TaskService.validateAssigneeConflict`: SEQUENTIAL/PARALLEL 조합 시나리오
  - 새 SEQUENTIAL 태스크 vs 기존 SEQUENTIAL 겹침 → 충돌 예외 발생
  - 새 SEQUENTIAL 태스크 vs 기존 PARALLEL 겹침 → 충돌 없음
  - 새 PARALLEL 태스크 → 검증 자체 건너뜀
- `TaskService.createTask` / `updateTask`: 링크 저장/교체 동작
- 링크 개수 10개 초과 시 `IllegalArgumentException` 발생

**통합 테스트 시나리오 (수동):**
1. 간트차트에서 태스크 생성 시 링크 2개 추가 → 저장 후 상세 팝업에서 링크 확인
2. 링크 클릭 시 새 탭으로 열리는지 확인
3. 태스크를 PARALLEL로 설정 후 같은 담당자, 같은 기간 다른 태스크 생성 → 충돌 없이 저장 성공
4. Team Board에서 태스크 클릭 → 수정 버튼 활성화 확인 → 수정 후 저장 → Board 새로고침 확인
5. Team Board에서 태스크 삭제 → 확인 다이얼로그 → 삭제 후 Board 새로고침 확인

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

- **executionMode 기본값 마이그레이션**: Hibernate `ddl-auto: update`로 `execution_mode` 컬럼이 추가될 때 기존 row에 NOT NULL 제약이 있으면 오류가 발생한다. 해결 방법: 컬럼에 DB 레벨 `DEFAULT 'SEQUENTIAL'` 지정하거나, 엔티티에 `@Column(columnDefinition = "VARCHAR(20) DEFAULT 'SEQUENTIAL'")` 명시.
- **TeamBoardDto의 links 로딩**: `findAllForTeamBoard` 쿼리가 `TaskLink`를 JOIN FETCH 하지 않으면 N+1 문제가 발생한다. §3.4.3의 결정에 따라 `TeamBoardDto.TaskItem`에 `links` 필드를 추가하지 않으므로 이 리스크는 발생하지 않는다. 링크는 상세 팝업에서 `GET /api/v1/tasks/{id}` 재조회 방식으로만 표시한다.
- **`showTaskModal` 의 `currentProjectId` 의존성**: Team Board 컨텍스트에서는 `currentProjectId`가 null이다. `projectId` 파라미터를 추가하는 방식으로 해결하되, 기존 간트차트 컨텍스트에서의 호출 (`showTaskModal(taskId)`)이 하위 호환성을 유지해야 한다. 내부에서 `var resolvedProjectId = projectId || currentProjectId;`로 처리하여 기존 호출부 수정을 최소화한다. `saveTask()` 역시 `currentProjectId` 대신 `resolvedProjectId`를 참조해야 하므로, 저장 시점에 사용할 projectId를 모달 범위의 변수(예: `currentModalProjectId`)에 보관하는 방식이 적합하다.

### 5.2 의존성 리스크

- `findOverlappingTasks` JPQL 변경이 기존 테스트에 영향을 미칠 수 있다. 현재 테스트 코드(`TimelineApplicationTests.java`)는 단순 컨텍스트 로드 테스트만 있으나, 향후 단위 테스트 추가 시 주의가 필요하다.

### 5.3 대안 및 완화 방안

- 링크를 별도 엔티티 대신 Task 테이블의 TEXT 컬럼(JSON 직렬화)으로 관리하는 방안도 가능하다. 그러나 링크별 개별 삭제 API, 유효성 검증, 향후 정렬/검색 요구사항을 고려하면 별도 엔티티 방식이 더 유연하다.
- Team Board에서 링크를 표시하지 않아도 된다면, `TeamBoardDto` 변경 없이 상세 팝업에서 `GET /api/v1/tasks/{id}`를 통해 링크를 가져오는 방식으로 충분하다. 이 방식이 구현 난이도를 낮춘다.

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `src/main/java/com/timeline/domain/entity/Task.java` — 태스크 엔티티
- `src/main/java/com/timeline/domain/entity/TaskDependency.java` — 의존관계 엔티티 (신규 TaskLink 구조 참고)
- `src/main/java/com/timeline/service/TaskService.java` — 태스크 서비스 (충돌 검증 로직: `validateAssigneeConflict`)
- `src/main/java/com/timeline/controller/TaskController.java` — 태스크 컨트롤러
- `src/main/java/com/timeline/controller/TeamBoardController.java` — Team Board 컨트롤러
- `src/main/java/com/timeline/exception/AssigneeConflictException.java` — 충돌 예외
- `src/main/java/com/timeline/exception/GlobalExceptionHandler.java` — 전역 예외 핸들러
- `src/main/java/com/timeline/dto/TaskDto.java` — 태스크 DTO
- `src/main/java/com/timeline/dto/TeamBoardDto.java` — Team Board DTO
- `src/main/java/com/timeline/domain/repository/TaskRepository.java` — 태스크 레포지토리 (쿼리 변경 대상)
- `src/main/resources/static/js/app.js` — 전체 프론트엔드 JS (함수: `showTaskDetail`, `showTaskModal`, `saveTask`, `showTeamBoardTaskDetail`, `checkAssigneeConflict`, `renderTeamBoard`)
- `src/main/resources/static/index.html` — taskModal, taskDetailModal HTML 정의

### 충돌 검증 변경 핵심 요약

```
현재: SEQUENTIAL/PARALLEL 구분 없이 날짜 겹치는 모든 태스크를 충돌로 간주
변경: 새 태스크가 SEQUENTIAL인 경우에만 검증 실행
      검증 시 기존 태스크 중 SEQUENTIAL인 것만 충돌 대상으로 포함
      → PARALLEL(기존) + SEQUENTIAL(신규) = 충돌 없음
      → SEQUENTIAL(기존) + PARALLEL(신규) = 충돌 없음 (검증 자체 안 함)
      → SEQUENTIAL(기존) + SEQUENTIAL(신규) = 충돌 (기존 동작 유지)
      → PARALLEL(기존) + PARALLEL(신규) = 충돌 없음 (검증 자체 안 함)
```
