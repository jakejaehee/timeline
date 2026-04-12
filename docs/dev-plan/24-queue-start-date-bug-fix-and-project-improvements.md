# 개발 계획서: 착수일 저장 버그 수정 및 프로젝트 화면 개선

## 1. 개요

- **기능 설명**: 스케줄(담당자별 태스크 큐) 화면의 "착수일 저장" 버튼이 내부적으로 태스크 시작일을 재계산하는 버그를 수정하고, 프로젝트 상세 화면의 멤버별 태스크 섹션에 "착수일 저장 / 시작일 재계산 버튼 분리" 및 "다중 선택 삭제" 기능을 추가한다.
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 스케줄 화면에서 "착수일 저장" 버튼 클릭 시 `queueStartDate` 값만 저장되어야 하며 태스크 시작일(startDate)이 재계산되면 안 된다.
- FR-002: 프로젝트 상세 > 태스크 탭 > 멤버별 뷰에서도 "착수일 저장" 버튼과 "시작일 재계산" 버튼을 분리한다.
- FR-003: 프로젝트 상세 > 태스크 탭에 체크박스 기반 다중 선택 삭제를 추가한다 (스케줄 화면의 동일 패턴 재사용).

### 2.2 비기능 요구사항

- NFR-001: 버그 수정은 백엔드 코드 변경 없이 프론트엔드 로직 수정으로 완결되어야 한다 (백엔드 API 자체는 이미 올바르게 분리되어 있음).
- NFR-002: 기존 스케줄 화면 기능에 영향을 주지 않아야 한다.

### 2.3 가정 사항

- 백엔드 `PATCH /api/v1/members/{id}/queue-start-date`는 재계산을 수행하지 않음 (코드 확인 완료).
- 백엔드 `POST /api/v1/members/{id}/recalculate-queue`는 TODO 태스크에만 재계산 수행 (코드 확인 완료).
- 프로젝트 화면의 다중 선택 삭제는 스케줄 화면과 동일한 `POST /api/v1/tasks/batch-delete` 엔드포인트를 재사용한다.

### 2.4 제외 범위 (Out of Scope)

- 백엔드 서비스 로직 변경
- `recalculateQueueDates()`의 동작 방식 변경
- 스케줄 화면 기존 드래그 앤 드롭 기능 변경

---

## 3. 시스템 설계

### 3.1 버그 원인 분석 (코드 레벨)

#### 버그 #1: "착수일 저장" 후 시작일이 재계산되는 문제

**버그 재현 경로**:

```
사용자: "착수일 저장" 클릭
  → app.js: PATCH /api/v1/members/{id}/queue-start-date  (올바른 동작: queueStartDate만 저장)
  → 저장 성공 후: await selectScheduleMember(memberId, name)  ← 여기서 재계산 트리거
    → app.js selectScheduleMember() 내부 마지막 블록:
        GET /api/v1/members/{assigneeId}/ordered-tasks  ← 핵심 원인
          → TaskController.getOrderedTasks()
              → taskService.recalculateQueueDates(assigneeId)  ← 모든 태스크 날짜 재계산
```

**코드 레벨 확인**:

`src/main/resources/static/js/app.js` - `selectScheduleMember()` 함수 (line 3373):

```javascript
// 착수일 저장 버튼 이벤트 (line 3437~3454)
newSaveBtn.addEventListener('click', async function() {
    var res = await apiCall('/api/v1/members/' + memberId + '/queue-start-date', 'PATCH', ...);
    if (res.success) {
        showToast('착수일이 저장되었습니다.', 'success');
        await selectScheduleMember(memberId, name);  // ← 문제: 전체 뷰 리프레시 호출
    }
});

// selectScheduleMember 마지막 블록 (line 3498~3510)
var res = await apiCall('/api/v1/members/' + memberId + '/ordered-tasks');  // ← 재계산 트리거
```

`src/main/java/com/timeline/controller/TaskController.java` (line 208~215):

```java
@GetMapping("/api/v1/members/{assigneeId}/ordered-tasks")
public ResponseEntity<?> getOrderedTasks(@PathVariable Long assigneeId) {
    taskService.recalculateQueueDates(assigneeId);  // ← GET 요청임에도 모든 태스크 날짜 변경
    return ResponseEntity.ok(...);
}
```

`recalculateQueueDates()` (TaskService.java line 547~603)는 **모든 상태(TODO, IN_PROGRESS, COMPLETED 포함)**의 SEQUENTIAL 태스크 날짜를 재계산한다. 반면 `recalculateQueueDatesForTodo()`는 TODO 태스크만 재계산한다.

**정리**: "착수일 저장" 버튼 → `selectScheduleMember()` 재호출 → `GET /ordered-tasks` 호출 → `recalculateQueueDates()` 실행 → 모든 태스크 날짜 덮어쓰기

---

#### 버그 #2: 프로젝트 화면의 착수일 저장 후 재계산 가능성

`initProjectTaskQueueStartDates()` (app.js line 1200~1204):

```javascript
var res = await apiCall('/api/v1/members/' + memberId + '/queue-start-date', 'PATCH', ...);
if (res.success) {
    showToast(...);
    await loadProjectTasks(projectId);  // loadProjectTasks는 ordered-tasks를 호출하지 않음
}
```

`loadProjectTasks()`는 `GET /api/v1/projects/{projectId}/tasks`를 호출하며 이 엔드포인트는 재계산하지 않는다. 따라서 프로젝트 화면의 착수일 저장 자체에는 재계산 버그가 없다.

그러나 프로젝트 화면에 "시작일 재계산" 버튼이 없어 기능 비대칭이 존재한다.

---

### 3.2 수정 방안

#### 수정 1: `getOrderedTasks()` 엔드포인트에서 재계산 제거 (백엔드)

**AS-IS** (`TaskController.java` line 204~215):

```java
/**
 * 담당자별 정렬된 SEQUENTIAL 태스크 목록 조회
 * 큐 순서 기반으로 날짜를 재계산한 후 반환한다.
 * NOTE: GET이지만 recalculateQueueDates로 DB 갱신이 발생함 (최신 날짜 보장 목적)
 */
@GetMapping("/api/v1/members/{assigneeId}/ordered-tasks")
public ResponseEntity<?> getOrderedTasks(@PathVariable Long assigneeId) {
    taskService.recalculateQueueDates(assigneeId);  // ← 제거 대상
    return ResponseEntity.ok(Map.of(
            "success", true,
            "data", assigneeOrderService.getOrderedTasksByAssignee(assigneeId)
    ));
}
```

**TO-BE**:

```java
@GetMapping("/api/v1/members/{assigneeId}/ordered-tasks")
public ResponseEntity<?> getOrderedTasks(@PathVariable Long assigneeId) {
    // 재계산 없이 현재 저장된 순서/날짜를 그대로 반환
    return ResponseEntity.ok(Map.of(
            "success", true,
            "data", assigneeOrderService.getOrderedTasksByAssignee(assigneeId)
    ));
}
```

**설명**: GET 엔드포인트에서 사이드이펙트(DB 변경)를 제거한다. 재계산은 사용자가 명시적으로 "시작일 재계산" 버튼을 누를 때(`POST /api/v1/members/{id}/recalculate-queue`)만 실행된다.

> **주의**: 이 변경으로 인해 `selectScheduleMember()` 내부에서 `GET /ordered-tasks`를 호출할 때 더 이상 재계산이 발생하지 않는다. 드래그 앤 드롭으로 순서 변경 시에는 `reorderAssigneeTasks()` (PATCH `/api/v1/tasks/assignee-order`) 내부에서 여전히 `recalculateQueueDates()`를 직접 호출하므로 순서 변경 후 날짜 재계산은 정상 동작이 유지된다.

---

#### 수정 2: 프로젝트 화면에 "시작일 재계산" 버튼 추가 (프론트엔드)

프로젝트 상세 > 태스크 탭 > 멤버별 뷰의 각 멤버 카드 헤더에 "시작일 재계산" 버튼을 추가한다.

**AS-IS** (`loadProjectTasks()` 내 멤버 카드 헤더 렌더링, app.js line 1064~1067):

```javascript
html += '<span class="text-muted ms-2" style="font-size:0.8rem;">착수일:</span>';
html += '<input type="text" class="form-control form-control-sm project-task-queue-start-date" data-member-id="' + key + '" value="..." ...>';
html += '<button class="btn btn-sm btn-outline-primary project-task-queue-start-save" data-member-id="' + key + '" ...>저장</button>';
html += '<button class="btn btn-sm btn-outline-secondary project-task-unavailable-btn" ...></button>';
```

**TO-BE**:

```javascript
html += '<span class="text-muted ms-2" style="font-size:0.8rem;">착수일:</span>';
html += '<input type="text" class="form-control form-control-sm project-task-queue-start-date" data-member-id="' + key + '" value="..." ...>';
html += '<button class="btn btn-sm btn-outline-primary project-task-queue-start-save" data-member-id="' + key + '" ...>저장</button>';
html += '<button class="btn btn-sm btn-outline-success project-task-queue-start-recalculate" data-member-id="' + key + '" data-member-name="' + escapeHtml(name) + '" style="padding:2px 6px;" title="TODO 태스크 시작일 재계산"><i class="bi bi-arrow-repeat"></i> 재계산</button>';
html += '<button class="btn btn-sm btn-outline-secondary project-task-unavailable-btn" ...></button>';
```

`initProjectTaskQueueStartDates()` 함수에 "재계산" 버튼 이벤트 바인딩 추가:

```javascript
var recalcBtns = document.querySelectorAll('.project-task-queue-start-recalculate');
recalcBtns.forEach(function(btn) {
    btn.addEventListener('click', async function() {
        var memberId = btn.getAttribute('data-member-id');
        var memberName = btn.getAttribute('data-member-name');
        try {
            var res = await apiCall('/api/v1/members/' + memberId + '/recalculate-queue', 'POST');
            if (res.success) {
                showToast(memberName + '님의 TODO 태스크 시작일이 재계산되었습니다.', 'success');
                await loadProjectTasks(projectId);
            } else {
                showToast(res.message || '재계산에 실패했습니다.', 'error');
            }
        } catch (e) {
            showToast('시작일 재계산에 실패했습니다.', 'error');
        }
    });
});
```

---

#### 수정 3: 프로젝트 화면에 다중 선택 삭제 기능 추가 (프론트엔드)

스케줄 화면의 구현 패턴을 프로젝트 화면에 동일하게 적용한다.

**필요한 변경 목록**:

1. `renderProjectTaskItem()` 함수에 체크박스 추가 (flat 뷰 + grouped 뷰 모두 적용)
2. `loadProjectTasks()` 함수에 배치 삭제 툴바 HTML 렌더링 추가
3. `updateProjectSelectedCount()` 함수 신규 추가
4. `batchDeleteSelectedProjectTasks(projectId)` 함수 신규 추가
5. `loadProjectTasks()` 마지막 단계에서 배치 삭제 툴바 이벤트 바인딩

**체크박스 추가 위치** (`renderProjectTaskItem()`, app.js line 1229):

```javascript
// AS-IS
html += '<i class="bi bi-grip-vertical drag-handle cursor-pointer me-2" ...>';

// TO-BE: draggable 여부와 무관하게 체크박스를 먼저 추가
html += '<input type="checkbox" class="project-task-checkbox me-1" value="' + t.id + '" onclick="event.stopPropagation(); updateProjectSelectedCount();">';
if (draggable) {
    html += '<i class="bi bi-grip-vertical drag-handle cursor-pointer me-2" ...>';
}
```

**배치 삭제 툴바 HTML** (`loadProjectTasks()` 내 `toggleHtml`에 추가):

```javascript
toggleHtml += '<div id="project-batch-delete-toolbar" class="d-flex align-items-center gap-2 ms-2">';
toggleHtml += '<input type="checkbox" id="project-select-all" title="전체 선택">';
toggleHtml += '<label for="project-select-all" class="mb-0" style="font-size:0.8rem;">전체 선택</label>';
toggleHtml += '<button class="btn btn-danger btn-sm ms-2" id="project-batch-delete-btn" disabled>';
toggleHtml += '<i class="bi bi-trash"></i> 선택 삭제 (<span id="project-selected-count">0</span>)';
toggleHtml += '</button>';
toggleHtml += '</div>';
```

**`updateProjectSelectedCount()` 신규 함수**:

```javascript
function updateProjectSelectedCount() {
    var checked = document.querySelectorAll('#project-tasks-content .project-task-checkbox:checked');
    var countEl = document.getElementById('project-selected-count');
    var deleteBtn = document.getElementById('project-batch-delete-btn');
    if (countEl) countEl.textContent = checked.length;
    if (deleteBtn) deleteBtn.disabled = (checked.length === 0);
    var allCbs = document.querySelectorAll('#project-tasks-content .project-task-checkbox');
    var selectAllCb = document.getElementById('project-select-all');
    if (selectAllCb) {
        selectAllCb.checked = allCbs.length > 0 && checked.length === allCbs.length;
    }
}
```

**`batchDeleteSelectedProjectTasks(projectId)` 신규 함수**:

```javascript
var projectBatchDeleteInProgress = false;
async function batchDeleteSelectedProjectTasks(projectId) {
    if (projectBatchDeleteInProgress) return;
    var checked = document.querySelectorAll('#project-tasks-content .project-task-checkbox:checked');
    if (checked.length === 0) return;
    if (!confirmAction(checked.length + '개 태스크를 삭제하시겠습니까?')) return;
    projectBatchDeleteInProgress = true;
    var taskIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    try {
        var res = await apiCall('/api/v1/tasks/batch-delete', 'POST', { taskIds: taskIds });
        if (res.success) {
            showToast(res.deleted + '개 태스크가 삭제되었습니다.', 'success');
            await loadProjectTasks(projectId);
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        showToast('태스크 삭제에 실패했습니다.', 'error');
    } finally {
        projectBatchDeleteInProgress = false;
    }
}
```

**`loadProjectTasks()` 이벤트 바인딩 추가** (`contentEl.innerHTML = toggleHtml + html` 직후, `if (projectTaskViewMode === 'grouped')` 분기 바깥에 위치시켜 flat 뷰에서도 동작하도록 한다):

```javascript
// 배치 삭제 툴바 이벤트 바인딩
var selectAllCb = document.getElementById('project-select-all');
if (selectAllCb) {
    selectAllCb.addEventListener('change', function() {
        var cbs = document.querySelectorAll('#project-tasks-content .project-task-checkbox');
        cbs.forEach(function(cb) { cb.checked = selectAllCb.checked; });
        updateProjectSelectedCount();
    });
}
var batchDeleteBtn = document.getElementById('project-batch-delete-btn');
if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', function() {
        batchDeleteSelectedProjectTasks(projectId);
    });
}
```

---

### 3.3 API 설계

변경되는 API:

| Method | Endpoint | 변경 내용 |
|--------|----------|-----------|
| GET | `/api/v1/members/{assigneeId}/ordered-tasks` | 내부 `recalculateQueueDates()` 호출 **제거** |

신규 호출 (기존 엔드포인트 재사용):

| Method | Endpoint | 프로젝트 화면에서의 새 사용처 |
|--------|----------|-------------------------------|
| POST | `/api/v1/members/{id}/recalculate-queue` | 프로젝트 화면 멤버별 뷰 "재계산" 버튼 |
| POST | `/api/v1/tasks/batch-delete` | 프로젝트 화면 선택 삭제 버튼 |

---

### 3.4 변경 파일 목록

#### 변경 파일 (백엔드): `src/main/java/com/timeline/controller/TaskController.java`

- `getOrderedTasks()` 메서드에서 `taskService.recalculateQueueDates(assigneeId)` 호출 1줄 제거
- Javadoc 주석도 "재계산 없이 현재 저장된 순서/날짜를 그대로 반환"으로 수정

#### 변경 파일 (프론트엔드): `src/main/resources/static/js/app.js`

| 위치 | 변경 유형 | 설명 |
|------|-----------|------|
| `loadProjectTasks()` - 멤버 카드 헤더 렌더링 (line ~1064) | 수정 | "시작일 재계산" 버튼 HTML 추가 |
| `loadProjectTasks()` - `toggleHtml` (line ~999) | 수정 | 배치 삭제 툴바 HTML 추가 |
| `loadProjectTasks()` - `contentEl.innerHTML` 직후, 뷰 모드 분기 바깥 (line ~1127) | 수정 | 배치 삭제 이벤트 바인딩 추가 (flat/grouped 뷰 공통 동작) |
| `renderProjectTaskItem()` (line ~1229) | 수정 | 체크박스 추가 |
| `initProjectTaskQueueStartDates()` (line ~1155) | 수정 | 재계산 버튼 이벤트 바인딩 추가 |
| 신규 함수 `updateProjectSelectedCount()` | 추가 | 선택 개수 카운터 |
| 신규 함수 `batchDeleteSelectedProjectTasks()` | 추가 | 배치 삭제 실행 |
| 신규 변수 `projectBatchDeleteInProgress` | 추가 | 중복 실행 방지 플래그 |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 복잡도 | 의존성 |
|---|------|------|--------|--------|
| T1 | 백엔드: `getOrderedTasks()`에서 재계산 제거 | `TaskController.java` 1줄 삭제 | 낮음 | 없음 |
| T2 | 프론트: 프로젝트 화면 재계산 버튼 HTML 렌더링 | `loadProjectTasks()` 내 HTML 수정 | 낮음 | 없음 |
| T3 | 프론트: 프로젝트 화면 재계산 버튼 이벤트 바인딩 | `initProjectTaskQueueStartDates()` 수정 | 낮음 | T2 |
| T4 | 프론트: `renderProjectTaskItem()` 체크박스 추가 | 아이템 HTML에 체크박스 삽입 | 낮음 | 없음 |
| T5 | 프론트: 배치 삭제 툴바 HTML 렌더링 | `loadProjectTasks()` toggleHtml 수정 | 낮음 | 없음 |
| T6 | 프론트: 배치 삭제 이벤트 바인딩 | `loadProjectTasks()` 이벤트 바인딩 추가 | 낮음 | T5, T7, T8 |
| T7 | 프론트: `updateProjectSelectedCount()` 함수 추가 | 신규 함수 작성 | 낮음 | T4, T5 |
| T8 | 프론트: `batchDeleteSelectedProjectTasks()` 함수 추가 | 신규 함수 작성 | 낮음 | T7 |

### 4.2 구현 순서

1. **Step 1 - 백엔드 버그 수정**: `TaskController.java`의 `getOrderedTasks()`에서 `taskService.recalculateQueueDates(assigneeId)` 호출 제거 (T1)
2. **Step 2 - 프로젝트 화면 재계산 버튼**: `loadProjectTasks()` 멤버 카드 헤더 HTML에 버튼 추가 + `initProjectTaskQueueStartDates()`에 이벤트 바인딩 (T2, T3)
3. **Step 3 - 프로젝트 화면 다중 선택 삭제**:
   - `renderProjectTaskItem()`에 체크박스 추가 (T4)
   - `loadProjectTasks()` toggleHtml에 배치 삭제 툴바 추가 (T5)
   - `updateProjectSelectedCount()`, `batchDeleteSelectedProjectTasks()` 신규 함수 추가 (T7, T8)
   - `loadProjectTasks()` contentEl.innerHTML 설정 후 이벤트 바인딩 추가 (T6)

### 4.3 테스트 계획

| 시나리오 | 기대 결과 |
|----------|-----------|
| 스케줄 화면: "착수일 저장" 버튼 클릭 후 태스크 목록 확인 | IN_PROGRESS/COMPLETED 태스크의 startDate 변경 없음 |
| 스케줄 화면: "시작일 재계산" 버튼 클릭 후 태스크 목록 확인 | TODO 태스크의 startDate가 queueStartDate 기준으로 재계산됨 |
| 스케줄 화면: 드래그 앤 드롭으로 순서 변경 후 태스크 목록 확인 | 순서 변경 후 날짜가 정상 재계산됨 |
| 프로젝트 화면: "착수일 저장" 버튼 클릭 | queueStartDate 저장, 태스크 날짜 불변 |
| 프로젝트 화면: "재계산" 버튼 클릭 | 해당 멤버의 TODO 태스크 startDate 재계산 |
| 프로젝트 화면: 개별 체크박스 선택 후 "선택 삭제" | 선택한 태스크만 삭제, 목록 갱신 |
| 프로젝트 화면: "전체 선택" 체크박스 토글 | 전체 체크/해제, 카운터 업데이트 |
| 프로젝트 화면: flat 뷰에서도 체크박스 동작 확인 | flat 뷰에서도 다중 선택 삭제 가능 |

---

## 5. 리스크 및 고려사항

### 기술적 리스크

- **R1**: `getOrderedTasks()`에서 재계산 제거 시, 화면에 표시되는 날짜가 실제 DB와 다를 수 있다는 우려가 있다. 그러나 날짜 변경 시점(태스크 저장, 순서 변경, 명시적 재계산)에 이미 재계산이 수행되므로 문제없다.
- **R2**: 프로젝트 화면의 flat 뷰에서 체크박스를 추가하면 `onclick="showTaskModal(...)"` 이벤트와 충돌할 수 있다. `event.stopPropagation()`으로 해결한다 (스케줄 화면에서 이미 검증된 패턴).

### 의존성 리스크

- 없음. 모든 사용하는 API 엔드포인트는 이미 존재하며, 신규 엔드포인트가 필요 없다.

---

## 6. 참고 사항

### 관련 파일 경로

- `src/main/java/com/timeline/controller/TaskController.java` — `getOrderedTasks()` (line 208)
- `src/main/java/com/timeline/controller/MemberController.java` — `updateQueueStartDate()`, `recalculateQueue()`
- `src/main/java/com/timeline/service/TaskService.java` — `recalculateQueueDates()`, `recalculateQueueDatesForTodo()`
- `src/main/resources/static/js/app.js`
  - `selectScheduleMember()` (line 3373)
  - `loadProjectTasks()` (line 968)
  - `initProjectTaskQueueStartDates()` (line 1155)
  - `renderProjectTaskItem()` (line 1229)
  - `batchDeleteSelectedTasks()` (line 3797) — 프로젝트 화면 신규 함수의 참고 패턴
  - `updateScheduleSelectedCount()` (line 3779) — 프로젝트 화면 신규 함수의 참고 패턴
- `src/main/resources/static/index.html` — 스케줄 화면 배치 삭제 툴바 HTML (line 300~305) 참고

### 관련 계획서

- `docs/dev-plan/16-ui-fixes-header-badge-queuedate-gantt-merge.md` — queueStartDate 저장 버튼 분리 1차 구현
- `docs/dev-plan/23-task-management-improvements.md` — 스케줄 화면 다중 선택 삭제 구현
