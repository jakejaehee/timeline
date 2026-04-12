# 개발 계획서: 태스크 관리 기능 개선 (5개)

## 1. 개요

- **기능 설명**: 태스크 관리 UX 및 Jira 연동 동작을 개선하는 5가지 독립적인 기능 개선
- **개발 배경 및 목적**: 착수일 저장과 시작일 재계산 버튼 분리로 의도치 않은 자동 재계산 방지, 모달에서 직접 삭제 가능하게 하여 UX 향상, Jira Import 기본값 변경 및 다중 선택 삭제로 대량 정리 편의성 제공
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 담당자 착수일 저장 버튼과 시작일 재계산 버튼을 분리
  - "착수일 저장" 버튼: `PATCH /api/v1/members/{id}/queue-start-date` 호출 (재계산 없음)
  - "시작일 재계산" 버튼: `POST /api/v1/members/{id}/recalculate-queue` 호출 (TODO 상태 태스크만 재계산)
  - 적용 위치: 담당자 스케줄 뷰 (`#schedule-queue-start-date-row` 영역)
  - 프로젝트 탭 담당자별 뷰 (`.project-task-queue-start-save` 버튼) — 착수일 저장 후 자동 재계산 제거
- **FR-002**: 시작일 재계산은 상태가 TODO인 태스크에만 적용
  - IN_PROGRESS, COMPLETED, HOLD, CANCELLED 상태는 기존 시작일/종료일 유지
- **FR-003**: 태스크 상세 보기 모달(`taskDetailModal`)에 삭제 버튼 추가
  - 이미 `task-detail-delete-btn`이 HTML에 존재함 — 동작 확인 후 필요 시 보완
- **FR-004**: 태스크 수정 모달(`taskModal`)의 footer에 삭제 버튼 추가
  - 수정 모드(task-id 값이 있을 때)에만 삭제 버튼 표시
  - 삭제 시 확인 다이얼로그(`confirmAction()`) 표시 후 삭제 실행
  - 삭제 후 모달 닫기 + UI 새로고침
- **FR-005**: Jira Import 시 새 태스크 생성 기본 executionMode를 PARALLEL → SEQUENTIAL로 변경
  - `JiraImportService.importIssues()` 내 CREATE 분기의 `TaskExecutionMode.PARALLEL` 변경
  - UPDATE 분기는 기존 값 유지 (변경 없음)
- **FR-006**: Jira Story Points → manDays 매핑 동작 확인
  - `JiraApiClient.extractStoryPoints()`: `customfield_10016` → `customfield_10028` → `story_points` 순서로 시도 (이미 구현됨)
  - `JiraImportService`의 CREATE/UPDATE 분기 모두 `issue.getStoryPoints()` → `manDays` 매핑 확인 (이미 구현됨)
  - SEQUENTIAL 모드로 변경 시 `manDays`가 null인 경우 날짜 계산 문제 발생 가능 → 방어 처리 필요
- **FR-007**: 멤버 태스크 목록(담당자 스케줄 뷰)에서 다중 선택 삭제 기능 추가
  - 각 태스크 아이템에 체크박스 추가
  - 헤더 영역에 "전체 선택/해제" 체크박스 추가
  - "선택 삭제" 버튼: 선택된 태스크를 일괄 삭제
  - 삭제 전 확인 다이얼로그 표시
  - 백엔드: `POST /api/v1/tasks/batch-delete` API 신규 추가

### 2.2 비기능 요구사항

- **NFR-001**: 배치 삭제 API는 존재하지 않는 taskId에 대해 오류를 반환하지 않고 성공 처리 (best-effort 방식)
- **NFR-002**: SEQUENTIAL 모드로 변경된 Jira Import 태스크의 manDays가 null이면 예외 없이 처리 (날짜 자동 계산 스킵 또는 방어 처리)
- **NFR-003**: 착수일 저장과 재계산 버튼은 각각 독립적으로 동작 (저장 후 자동 재계산 연동 제거)

### 2.3 가정 사항

- 태스크 상세 모달(`taskDetailModal`)의 삭제 버튼(`task-detail-delete-btn`)은 HTML에 이미 존재하므로, 동작 여부를 코드에서 확인하고 문제 시 수정
- 시작일 재계산 버튼은 `recalculateQueueDates()` 로직을 그대로 사용하되, TODO 태스크 필터 조건만 추가
- 프로젝트 탭의 착수일 저장(`.project-task-queue-start-save`) 버튼은 현재 저장 후 `loadProjectTasks()` 재로드를 하므로 자동 재계산은 백엔드 `PATCH /queue-start-date` API 내부에서만 발생 → MemberController의 `updateQueueStartDate()`에서 `recalculateQueueDates()` 호출을 제거해야 함

### 2.4 제외 범위 (Out of Scope)

- 프로젝트 태스크 탭(그룹별 뷰)의 다중 선택 삭제 (담당자 스케줄 뷰에만 적용)
- 간트차트 뷰에서의 다중 선택 삭제
- Jira Import의 executionMode 선택 옵션 UI (일괄 SEQUENTIAL 고정)

---

## 3. 시스템 설계

### 3.1 데이터 모델

신규 엔티티나 스키마 변경 없음.

### 3.2 API 설계

| Method | Endpoint | 설명 | Request Body | Response |
|--------|----------|------|--------------|----------|
| PATCH | `/api/v1/members/{id}/queue-start-date` | 착수일만 저장 (재계산 없음) | `{"queueStartDate": "YYYY-MM-DD"}` | `{"success": true}` |
| POST | `/api/v1/members/{id}/recalculate-queue` | 착수일 기준 TODO 태스크만 시작일 재계산 | (body 없음) | `{"success": true}` |
| POST | `/api/v1/tasks/batch-delete` | 태스크 일괄 삭제 | `{"taskIds": [1, 2, 3]}` | `{"success": true, "deleted": 3}` |

**변경 사항:**
- `PATCH /api/v1/members/{id}/queue-start-date`: 기존 엔드포인트이나, 내부에서 `taskService.recalculateQueueDates()` 호출 **제거**
- `POST /api/v1/members/{id}/recalculate-queue`: 신규 엔드포인트, TODO 상태 태스크에만 날짜 재계산 적용
- `POST /api/v1/tasks/batch-delete`: 신규 엔드포인트

### 3.3 서비스 계층

#### 3.3.1 TaskService — recalculateQueueDates() 개선 (FR-002)

현재 `recalculateQueueDates()` 메서드는 HOLD/CANCELLED 상태를 제외하지만, IN_PROGRESS/COMPLETED도 재계산에서 제외해야 함.

```
신규 메서드: recalculateQueueDatesForTodo(Long assigneeId)
- recalculateQueueDates()와 동일한 로직
- 단, TODO 상태인 태스크에만 날짜를 업데이트함
- IN_PROGRESS, COMPLETED 태스크는 날짜 변경 없이 queueStartDate 연속성 계산에만 사용
```

**처리 흐름:**
1. assigneeId로 SEQUENTIAL 태스크를 assigneeOrder 기준 정렬 (HOLD/CANCELLED 제외)
2. queueStartDate는 **목록 전체의 1번 태스크 위치에 관계없이** 첫 번째 TODO 태스크에만 적용한다.
   - 1번 태스크가 IN_PROGRESS/COMPLETED이면 해당 태스크의 기존 endDate를 기준으로 다음 날짜를 계산하고, 첫 번째 TODO 태스크에 queueStartDate를 적용하지 않는다.
   - 즉, IN_PROGRESS/COMPLETED 태스크의 endDate가 queueStartDate보다 늦으면 queueStartDate는 무시하고 기존 endDate 기준으로 연속 계산한다.
3. TODO가 아닌 태스크는 날짜를 변경하지 않고 "이전 태스크 종료일" 계산의 기준으로만 활용
4. TODO 태스크에만 새 startDate/endDate 계산 및 저장

#### 3.3.2 TaskService — deleteTasksBatch() 신규 (FR-007)

```java
@Transactional
public int deleteTasksBatch(List<Long> taskIds) {
    // 존재하는 태스크만 삭제 (best-effort)
    // 각 태스크에 대해 deleteTask() 로직 반복 (의존관계 + 링크 삭제 포함)
    // 삭제된 건수 반환
}
```

#### 3.3.3 MemberController — updateQueueStartDate() 변경 및 recalculateQueue() 추가 (FR-001)

**updateQueueStartDate() 변경:**

현재 (line 107~108):
```java
memberService.updateQueueStartDate(id, dateStr);
taskService.recalculateQueueDates(id);  // 이 줄 제거
```

변경 후: `taskService.recalculateQueueDates()` 호출 제거. 재계산은 `/recalculate-queue` 엔드포인트에서 처리.

**신규 recalculateQueue() 엔드포인트 추가 (T-05):**

```java
@PostMapping("/{id}/recalculate-queue")
public ResponseEntity<?> recalculateQueue(@PathVariable Long id) {
    taskService.recalculateQueueDatesForTodo(id);
    return ResponseEntity.ok(Map.of("success", true));
}
```

위 메서드는 `updateQueueStartDate()` 메서드 바로 아래에 추가한다.

#### 3.3.4 JiraImportService — executionMode 변경 (FR-005)

```java
// CREATE 분기: PARALLEL -> SEQUENTIAL
.executionMode(TaskExecutionMode.SEQUENTIAL)
```

**주의**: SEQUENTIAL 모드는 기본적으로 manDays가 필수이나, JiraImportService는 `TaskService`를 경유하지 않고 `TaskRepository`를 직접 사용하므로 manDays null 체크를 서비스에서 강제하지 않음. 단, manDays가 null이면 `startDate`/`endDate`도 null일 수 있으므로 `resolveDatePair()` 로직에 의해 today로 채워짐 → 별도 예외 처리 불필요.

### 3.4 프론트엔드

#### 3.4.1 담당자 스케줄 뷰 — 버튼 분리 (FR-001)

**변경 위치:** `index.html` — `#schedule-queue-start-date-row`

현재:
```html
<button id="schedule-queue-start-date-save">저장</button>
```

변경 후:
```html
<button id="schedule-queue-start-date-save">착수일 저장</button>
<button id="schedule-queue-start-date-recalculate">시작일 재계산</button>
```

**변경 위치:** `app.js` — `selectScheduleMember()` 함수 내 버튼 이벤트 바인딩 부분 (line ~3419)

- `schedule-queue-start-date-save` 버튼: `PATCH /api/v1/members/{id}/queue-start-date` 호출 → 성공 시 멤버 재로드만 (재계산 없음)
- `schedule-queue-start-date-recalculate` 버튼 (신규): `POST /api/v1/members/{id}/recalculate-queue` 호출 → 성공 시 태스크 목록 재로드

#### 3.4.2 프로젝트 탭 — 착수일 저장 버튼 (FR-001 보완)

**변경 위치:** `app.js` — `initProjectTaskQueueStartDates()` 함수 내 `.project-task-queue-start-save` 버튼 이벤트 (line ~1192)

현재 동작: `PATCH /queue-start-date` → 성공 시 `loadProjectTasks()` 재로드
변경 후 동작: 동일하나, 백엔드 API에서 `recalculateQueueDates()` 제거되었으므로 재계산은 자동으로 일어나지 않음.

프로젝트 탭에는 재계산 버튼 불필요 (담당자 스케줄 뷰에서 처리).

#### 3.4.3 태스크 수정 모달 — 삭제 버튼 추가 (FR-004)

**변경 위치:** `index.html` — `#taskModal` footer

현재:
```html
<div class="modal-footer">
    <button class="btn btn-secondary" data-bs-dismiss="modal">취소</button>
    <button class="btn btn-primary" onclick="saveTask()">저장</button>
</div>
```

변경 후:
```html
<div class="modal-footer">
    <button type="button" class="btn btn-danger btn-sm" id="task-modal-delete-btn" style="display:none; margin-right:auto;">
        <i class="bi bi-trash"></i> 삭제
    </button>
    <button class="btn btn-secondary" data-bs-dismiss="modal">취소</button>
    <button class="btn btn-primary" onclick="saveTask()">저장</button>
</div>
```

**변경 위치:** `app.js` — `showTaskModal()` 함수 (수정 모드 진입 시 `task-modal-delete-btn` 표시, 이벤트 바인딩)

- 추가 모드 (`taskId == null`): `task-modal-delete-btn` `display:none`
- 수정 모드 (`taskId != null`): `task-modal-delete-btn` 표시, onclick은 **모달 먼저 닫기 후** `deleteTask(taskId)` 호출 순서로 구현

  ```javascript
  deleteModalBtn.onclick = function() {
      bootstrap.Modal.getInstance(document.getElementById('taskModal')).hide();
      deleteTask(taskId);
  };
  ```

  > **주의**: `deleteTask()`를 먼저 호출한 뒤 모달을 닫으면, `deleteTask()` 내부의 UI 갱신(`loadProjectTasks`, `selectScheduleMember` 등) 완료 전에 모달이 DOM 위에 남아 갱신된 뷰를 가린다. 기존 `taskDetailModal`의 삭제 버튼도 동일하게 `modal.hide()` → `deleteTask()` 순서를 사용한다 (app.js line 2720~2721).

이벤트 바인딩 위치: `showTaskModal()` 함수 내 수정 모드 진입 블록(`if (taskId)` 분기) 안, `modal.show()` 호출 직전.

#### 3.4.4 태스크 상세 모달 — 삭제 버튼 확인 (FR-003)

`index.html` 확인 결과:
- `#task-detail-delete-btn`이 이미 존재하며 이벤트 바인딩도 되어 있음 (app.js line ~2719)
- 실제 동작: `deleteBtn.onclick` 핸들러에서 **먼저 `modal.hide()`** 후 `deleteTask(task.id)` 호출 (app.js line 2720~2721)
- **추가 작업 없음** — 현재 정상 동작 중이므로 변경 불필요

#### 3.4.5 멤버 스케줄 뷰 — 다중 선택 삭제 (FR-007)

**변경 위치:** `index.html` — `#schedule-queue-panel` 내 헤더 영역에 "선택 삭제" 버튼 추가

```html
<!-- schedule-queue-start-date-row 아래에 선택 삭제 툴바 추가 -->
<div id="schedule-batch-delete-toolbar" class="align-items-center gap-2 px-2 py-1 border-bottom" style="display:none;">
    <input type="checkbox" id="schedule-select-all" title="전체 선택">
    <label for="schedule-select-all" class="mb-0" style="font-size:0.8rem;">전체 선택</label>
    <button class="btn btn-danger btn-sm ms-2" id="schedule-batch-delete-btn" disabled>
        <i class="bi bi-trash"></i> 선택 삭제 (<span id="schedule-selected-count">0</span>)
    </button>
</div>
```

> **주의**: `d-flex` 클래스와 `style="display:none !important;"` 를 함께 쓰면 `!important` 우선순위로 인해 JS에서 `style.display = 'flex'`로 표시 시도 시 `!important`가 덮어써 요소가 보이지 않는다. 따라서 `d-flex` 클래스를 제거하고 초기값을 `style="display:none;"` (일반 우선순위)으로 지정한다. JS에서 표시할 때는 `element.style.display = 'flex'`로 설정한다.

**변경 위치:** `app.js` — `renderScheduleQueue()` 함수

- 순서 있는 태스크 아이템 렌더링 시 체크박스 추가
- 체크박스 `change` 이벤트: 선택 개수 업데이트 + "선택 삭제" 버튼 활성화/비활성화
- 전체 선택 체크박스 연동

**변경 위치:** `app.js` — `selectScheduleMember()` 함수

- 멤버 선택 시 `schedule-batch-delete-toolbar` 표시
- `schedule-select-all`, `schedule-batch-delete-btn` 이벤트 바인딩

**신규 함수:** `batchDeleteSelectedTasks(memberId)`

```javascript
async function batchDeleteSelectedTasks(memberId) {
    var checked = document.querySelectorAll('#schedule-ordered-tasks .schedule-task-checkbox:checked');
    if (checked.length === 0) return;
    if (!confirmAction(checked.length + '개 태스크를 삭제하시겠습니까?')) return;

    var taskIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    var res = await apiCall('/api/v1/tasks/batch-delete', 'POST', { taskIds: taskIds });
    if (res.success) {
        showToast(res.deleted + '개 태스크가 삭제되었습니다.', 'success');
        await selectScheduleMember(memberId, currentScheduleMemberName);
    }
}
```

### 3.5 기존 시스템 연동

| 영향 파일 | 변경 내용 |
|-----------|-----------|
| `MemberController.java` | `updateQueueStartDate()`: `recalculateQueueDates()` 호출 제거, 신규 `recalculateQueue()` 엔드포인트 추가 |
| `TaskService.java` | `recalculateQueueDatesForTodo()` 신규 메서드 추가, `deleteTasksBatch()` 신규 메서드 추가 |
| `TaskController.java` | `batchDelete()` 엔드포인트 추가 |
| `JiraImportService.java` | CREATE 분기 `executionMode` PARALLEL → SEQUENTIAL 변경 |
| `index.html` | `#taskModal` footer에 삭제 버튼 추가, `#schedule-queue-start-date-row` 버튼 수정, 배치 삭제 툴바 추가 |
| `app.js` | 착수일 저장/재계산 이벤트 분리, `showTaskModal()` 삭제 버튼 표시 로직, `renderScheduleQueue()` 체크박스, `batchDeleteSelectedTasks()` 신규 함수 |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | JiraImportService executionMode 변경 | CREATE 분기 PARALLEL → SEQUENTIAL, 클래스 주석 업데이트 | 낮음 | - |
| T-02 | Story Points 매핑 확인 | JiraApiClient.extractStoryPoints() + JiraImportService 매핑 코드 리뷰, 문제 없음 확인 | 낮음 | - |
| T-03 | MemberController 착수일 저장에서 재계산 제거 | `recalculateQueueDates()` 호출 제거 | 낮음 | - |
| T-04 | TaskService.recalculateQueueDatesForTodo() 추가 | TODO 태스크만 재계산하는 신규 메서드 | 중간 | - |
| T-05 | MemberController.recalculateQueue() 엔드포인트 추가 | POST /api/v1/members/{id}/recalculate-queue | 낮음 | T-04 |
| T-06 | TaskService.deleteTasksBatch() 추가 | 일괄 삭제 메서드 | 낮음 | - |
| T-07 | TaskController.batchDelete() 엔드포인트 추가 | POST /api/v1/tasks/batch-delete | 낮음 | T-06 |
| T-08 | index.html: taskModal footer 삭제 버튼 추가 | 수정 모드에서만 표시되는 삭제 버튼 | 낮음 | - |
| T-09 | app.js: showTaskModal() 삭제 버튼 표시 로직 | 수정 모드 진입 시 버튼 표시 + 이벤트 바인딩 | 낮음 | T-08 |
| T-10 | index.html: schedule 착수일/재계산 버튼 분리 | "착수일 저장" + "시작일 재계산" 버튼으로 분리 | 낮음 | - |
| T-11 | app.js: selectScheduleMember() 이벤트 바인딩 분리 | 저장/재계산 버튼 이벤트 분리 | 낮음 | T-10, T-05 |
| T-12 | index.html: schedule 배치 삭제 툴바 추가 | 전체 선택 체크박스 + 선택 삭제 버튼 | 낮음 | - |
| T-13 | app.js: renderScheduleQueue() 체크박스 추가 | 각 태스크 아이템에 체크박스 렌더링 | 중간 | T-12 |
| T-14 | app.js: batchDeleteSelectedTasks() 신규 함수 | 배치 삭제 API 호출 + UI 갱신 | 낮음 | T-07, T-13 |

### 4.2 구현 순서

1. **Step 1 — 백엔드 단순 변경** (T-01, T-02, T-03, T-06, T-07)
   - JiraImportService executionMode 변경
   - Story Points 매핑 코드 확인
   - MemberController 재계산 제거
   - TaskService/TaskController 배치 삭제 추가

2. **Step 2 — 백엔드 신규 로직** (T-04, T-05)
   - `recalculateQueueDatesForTodo()` 메서드 구현
   - MemberController에 `/recalculate-queue` 엔드포인트 추가

3. **Step 3 — 프론트엔드 모달 개선** (T-08, T-09)
   - taskModal footer에 삭제 버튼 추가
   - showTaskModal() 삭제 버튼 표시/바인딩 로직

4. **Step 4 — 프론트엔드 착수일 버튼 분리** (T-10, T-11)
   - HTML 버튼 분리
   - 이벤트 바인딩 분리

5. **Step 5 — 프론트엔드 배치 삭제** (T-12, T-13, T-14)
   - 배치 삭제 툴바 HTML 추가
   - 체크박스 렌더링 + 이벤트 처리
   - batchDeleteSelectedTasks() 구현

### 4.3 테스트 계획

**단위 테스트 대상:**
- `recalculateQueueDatesForTodo()`: TODO 태스크만 날짜 변경, IN_PROGRESS/COMPLETED 날짜 불변 확인
- `deleteTasksBatch()`: 존재하지 않는 ID 포함 시 best-effort 삭제 동작 확인

**통합 테스트 시나리오:**
1. 착수일 저장 후 태스크 시작일이 변경되지 않는지 확인
2. 시작일 재계산 후 TODO 태스크는 시작일 변경, IN_PROGRESS/COMPLETED는 불변인지 확인
3. Jira Import 후 신규 생성 태스크의 executionMode가 SEQUENTIAL인지 확인
4. Story Points가 있는 Jira 이슈를 Import 했을 때 manDays에 정상 매핑되는지 확인
5. 태스크 수정 모달에서 삭제 버튼 표시 여부 (수정 모드 vs 추가 모드)
6. 배치 삭제 시 선택한 태스크들이 삭제되고 UI가 갱신되는지 확인

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 항목 | 리스크 | 대응 방안 |
|------|--------|-----------|
| recalculateQueueDatesForTodo | IN_PROGRESS 태스크가 연속선상에 있을 때 그 다음 TODO 태스크 시작일을 올바르게 계산해야 함 | IN_PROGRESS/COMPLETED 태스크는 날짜를 변경하지 않지만 "현재 endDate"를 다음 태스크 시작 기준으로 사용 |
| SEQUENTIAL 모드 Jira Import | manDays null인 태스크는 날짜 계산 불가 | JiraImportService는 TaskRepository 직접 사용이므로 TaskService 유효성 검사 우회됨. resolveDatePair()가 today로 채우므로 실용적으로 문제 없음 |
| 배치 삭제 + 의존관계 | 삭제 대상 태스크를 선행으로 갖는 태스크가 있을 때 의존관계 자동 제거 | 기존 `deleteTask()`가 `taskDependencyRepository.deleteByTaskId()` + `deleteByDependsOnTaskId()` 를 모두 호출하므로, 배치 삭제도 이를 재사용하면 안전 |
| 드래그 앤 드롭 + 체크박스 충돌 | Sortable.js가 체크박스 클릭도 drag로 해석할 수 있음 | Sortable의 `filter` 옵션으로 체크박스를 drag 대상에서 제외: `filter: 'input[type="checkbox"]'` |

### 5.2 의존성 리스크

- `recalculateQueueDates()` 호출부가 `MemberController.updateQueueStartDate()` 외에 `TaskController.reorderAssigneeTasks()`, `TaskController.getOrderedTasks()`에도 존재한다.
  - `reorderAssigneeTasks()` (line 153): 재정렬 시 전체 재계산 유지 — **변경 없음** (재정렬은 의도적 행위이므로 IN_PROGRESS 포함 전체 재계산이 적합)
  - `getOrderedTasks()` (line 167): 담당자 스케줄 뷰 진입 시 `selectScheduleMember()` → 이 API를 호출하여 전체 재계산을 수행 — **변경 없음** (뷰 최신화 목적이므로 전체 재계산 유지)
  - 결론: `recalculateQueueDatesForTodo()`는 "시작일 재계산" 버튼(`/recalculate-queue` 엔드포인트)에서만 사용. 기존 `getOrderedTasks()`, `reorderAssigneeTasks()`는 기존 `recalculateQueueDates()`(IN_PROGRESS 포함 전체 재계산)를 유지한다.

---

## 6. 참고 사항

### 6.1 관련 기존 코드 경로

| 파일 | 위치 | 관련 내용 |
|------|------|-----------|
| `MemberController.java` | line 103 | `PATCH /{id}/queue-start-date` — 착수일 저장 + 재계산 |
| `TaskController.java` | line 133, 165 | `reorderAssigneeTasks()`, `getOrderedTasks()` |
| `TaskService.java` | line 516 | `recalculateQueueDates()` |
| `JiraImportService.java` | line 239-251 | CREATE 분기 Task 빌더 |
| `JiraApiClient.java` | line 316 | `extractStoryPoints()` |
| `app.js` | line 3419 | `schedule-queue-start-date-save` 버튼 이벤트 |
| `app.js` | line 3460 | `renderScheduleQueue()` |
| `app.js` | line 3129 | `deleteTask()` |
| `app.js` | line 2710 | `task-detail-delete-btn` 이벤트 바인딩 |
| `index.html` | line 1069 | `#taskModal` footer |
| `index.html` | line 1077 | `#taskDetailModal` — 삭제 버튼 이미 존재 |
| `index.html` | line 294 | `#schedule-queue-start-date-row` |

### 6.2 Story Points 매핑 현황 (FR-006 분석 결과)

코드 검토 결과 이미 올바르게 구현되어 있음:

- `JiraApiClient.extractStoryPoints()` (line 316): `customfield_10016` → `customfield_10028` → `story_points` 순서로 시도
- `JiraApiClient.BOARD_FIELDS` (line 36): `customfield_10016,customfield_10015,customfield_10028,story_points` 모두 포함
- `JiraImportService` CREATE 분기 (line 247): `.manDays(issue.getStoryPoints())` 매핑 정상
- `JiraImportService` UPDATE 분기 (line 203): `if (issue.getStoryPoints() != null)` 조건부 업데이트 정상

**결론**: Story Points 매핑은 정상 동작 중. 별도 수정 불필요. FR-006은 확인만으로 완료.
