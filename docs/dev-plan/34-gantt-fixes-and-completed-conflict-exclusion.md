# 개발 계획서: 간트차트 버그 수정 및 COMPLETED 충돌 제외

## 1. 개요

- **기능 설명**: 간트차트 sticky header 관련 렌더링 버그 2종 수정, COMPLETED 태스크의 일정 충돌 경고 및 검증 제외, "시작일 최적화" 텍스트 일괄 변경
- **개발 배경 및 목적**: 현재 간트차트에서 첫번째 태스크 bar가 날짜 header에 가려지고 론치일 마커 텍스트도 header에 가려지는 시각적 버그가 존재함. 또한 이미 완료된(COMPLETED) 태스크가 일정 충돌 경고 및 담당자 충돌 검증 대상에 포함되어 불필요한 경고가 발생함. "시작일 최적화" 텍스트도 더 포괄적인 "일정 최적화"로 변경 요청됨.
- **작성일**: 2026-04-13

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-01**: 간트차트 sticky header가 첫번째 태스크 bar를 가리지 않도록 `rect.grid-header`의 height를 정밀 계산으로 조정
- **FR-02**: 론치일 마커(`gantt-deadline-marker-group`)가 sticky header(rect + g.date) 위에 렌더링되도록 z-order 보장
- **FR-03**: `COMPLETED` 상태 태스크를 일정 충돌 경고(SCHEDULE_CONFLICT) 및 담당자 충돌 검증(`validateAssigneeConflict`)에서 제외. TODO, IN_PROGRESS만 충돌 대상으로 처리
- **FR-04**: "시작일 최적화" 문자열을 "일정 최적화"로 모든 위치에서 일괄 변경

### 2.2 비기능 요구사항

- **NFR-01**: FR-01, FR-02 수정이 기존 sticky header 스크롤 동작을 손상시키지 않을 것
- **NFR-02**: FR-03 수정이 `recalculateQueueDates()`, `recalculateQueueDatesForTodo()`의 기존 로직에 영향을 주지 않을 것 (COMPLETED를 날짜 기준점으로 사용하는 로직은 그대로 유지)

### 2.3 가정 사항

- FR-03에서 "충돌 대상"은 SEQUENTIAL 모드 태스크에 한정 (PARALLEL 태스크는 기존 로직 유지)
- `INACTIVE_STATUSES` 상수 자체는 변경하지 않고, 충돌 검증 전용 새 상수를 추가하는 방식 채택 (부작용 최소화)
- `CONFLICT_EXCLUDE_STATUSES`를 `TaskService`와 `WarningService`에 각각 별도 정의하는 이유: 두 클래스는 Spring Bean 의존성 계층상 `TaskService` → `WarningService`가 아니므로 공유 클래스를 만들지 않고 단순 중복 선언이 더 가볍다고 판단. 단, 나중에 제외 대상 상태가 변경될 경우 두 곳을 모두 수정해야 하므로 변경 시 반드시 양쪽을 함께 수정해야 함. 대안으로 `TaskStatusGroups` 같은 유틸리티 클래스를 `domain/enums/` 패키지에 추가하는 방식이 있으나, 해당 리팩터링은 이 계획서 범위에 포함하지 않음
- FR-01의 height 계산: frappe-gantt가 생성하는 `rect.grid-header`의 원래 height attribute 값을 읽어서 그대로 활용하거나, `.upper-text`와 `.lower-text`의 실제 bounding box를 기준으로 계산

### 2.4 제외 범위 (Out of Scope)

- frappe-gantt 라이브러리 자체 소스 수정
- COMPLETED 태스크의 의존관계 검증(DEPENDENCY_ISSUE 경고) 로직 변경
- DEADLINE_EXCEEDED 경고의 `findMaxEndDateByProjectId` 쿼리 변경

---

## 3. 시스템 설계

### 3.1 데이터 모델

신규/변경 엔티티 없음.

### 3.2 API 설계

API 변경 없음. 백엔드 내부 로직 변경만 포함.

### 3.3 서비스 계층

#### 3.3.1 TaskService.java

**변경 사항**: 충돌 검증 전용 상수 추가 및 `validateAssigneeConflict()`에서 해당 상수 사용

```java
// 기존 (변경 없음)
private static final List<TaskStatus> INACTIVE_STATUSES = List.of(TaskStatus.HOLD, TaskStatus.CANCELLED);

// 신규 추가
/** 일정 충돌 검증에서 제외할 상태 목록 (HOLD, CANCELLED, COMPLETED) */
private static final List<TaskStatus> CONFLICT_EXCLUDE_STATUSES = List.of(
    TaskStatus.HOLD, TaskStatus.CANCELLED, TaskStatus.COMPLETED
);
```

`validateAssigneeConflict()` 내부:
```java
// 변경 전
List<Task> overlapping = taskRepository.findOverlappingTasks(
    assignee.getId(), startDate, endDate, excludeTaskId,
    TaskExecutionMode.SEQUENTIAL, INACTIVE_STATUSES);

// 변경 후
List<Task> overlapping = taskRepository.findOverlappingTasks(
    assignee.getId(), startDate, endDate, excludeTaskId,
    TaskExecutionMode.SEQUENTIAL, CONFLICT_EXCLUDE_STATUSES);
```

**영향 범위 검토**:
- `recalculateQueueDates()` / `recalculateQueueDatesForTodo()`: `INACTIVE_STATUSES`를 그대로 사용하므로 영향 없음. COMPLETED 태스크는 계속 날짜 기준점으로 활용됨
- `countSequentialTasksByAssigneeGlobal()`: `INACTIVE_STATUSES` 사용. 변경 없음 (COMPLETED 태스크는 카운트에 포함 — 담당자 배정 존재 판단에 필요)
- `previewDates()`: `INACTIVE_STATUSES` 사용. 변경 없음

#### 3.3.2 WarningService.java

**변경 사항**: SCHEDULE_CONFLICT 탐지 필터에서 COMPLETED 제외

```java
// 기존 (변경 없음)
private static final List<TaskStatus> INACTIVE_STATUSES = List.of(TaskStatus.HOLD, TaskStatus.CANCELLED);

// 신규 추가
/** 일정 충돌 경고에서 제외할 상태 목록 */
private static final List<TaskStatus> CONFLICT_EXCLUDE_STATUSES = List.of(
    TaskStatus.HOLD, TaskStatus.CANCELLED, TaskStatus.COMPLETED
);
```

SCHEDULE_CONFLICT 탐지 (line 148~172):
```java
// 변경 전
Map<Long, List<Task>> tasksByAssignee = tasks.stream()
    .filter(t -> t.getAssignee() != null && !INACTIVE_STATUSES.contains(t.getStatus())
            && t.getStartDate() != null && t.getEndDate() != null
            && t.getExecutionMode() == TaskExecutionMode.SEQUENTIAL)
    .collect(Collectors.groupingBy(t -> t.getAssignee().getId()));

// 변경 후
Map<Long, List<Task>> tasksByAssignee = tasks.stream()
    .filter(t -> t.getAssignee() != null && !CONFLICT_EXCLUDE_STATUSES.contains(t.getStatus())
            && t.getStartDate() != null && t.getEndDate() != null
            && t.getExecutionMode() == TaskExecutionMode.SEQUENTIAL)
    .collect(Collectors.groupingBy(t -> t.getAssignee().getId()));
```

**영향 범위 검토**:
- DEPENDENCY_ISSUE 경고 (line 178~186): `INACTIVE_STATUSES` 그대로 사용. 변경 없음
- DEADLINE_EXCEEDED 경고 (line 191): `INACTIVE_STATUSES` 그대로 사용. 변경 없음

### 3.4 프론트엔드

#### 3.4.1 FR-01: rect.grid-header height 정밀 계산

**문제 원인 분석**: 현재 `maxY + 16` 계산에서 `maxY`는 `.lower-text`의 `y` attribute 값임. SVG text element의 `y`는 baseline 위치를 가리키므로 실제 텍스트 하단은 `y + descender`임. frappe-gantt의 기본 grid-header height는 frappe-gantt가 렌더링 시 결정한 값으로, 이를 직접 읽어 사용하는 것이 가장 안전함.

**해결 방법**: `setupGanttStickyHeader()` 내에서 `gridHeaderRect.setAttribute('height', ...)` 호출 전, frappe-gantt가 원래 설정한 height를 읽어서 그 값을 그대로 사용. height를 덮어쓰지 않거나, `getBBox()`로 `g.date`의 실제 bounding box 높이를 구해서 사용.

```javascript
// 변경 전
if (gridHeaderRect && dateLayer) {
    var lowerTexts = dateLayer.querySelectorAll('.lower-text');
    var maxY = 0;
    lowerTexts.forEach(function(t) {
        var y = parseFloat(t.getAttribute('y') || 0);
        if (y > maxY) maxY = y;
    });
    var headerHeight = maxY > 0 ? maxY + 16 : 50;
    gridHeaderRect.setAttribute('height', headerHeight);
    gridHeaderRect.setAttribute('fill', '#ffffff');
    gridHeaderRect.setAttribute('opacity', '1');
}

// 변경 후
if (gridHeaderRect && dateLayer) {
    // frappe-gantt가 원래 설정한 height를 그대로 사용 (height 속성 재설정 안 함)
    // getBBox()로 g.date의 실제 렌더링 높이를 구해서 rect height와 일치시킴
    var dateBBox;
    try { dateBBox = dateLayer.getBBox(); } catch(e) { dateBBox = null; }
    if (dateBBox && dateBBox.height > 0) {
        var headerHeight = dateBBox.y + dateBBox.height + 2; // 2px 여유
        gridHeaderRect.setAttribute('height', headerHeight);
    }
    // height 미지정 시 frappe-gantt 원래 값 유지 (setAttribute 생략)
    gridHeaderRect.setAttribute('fill', '#ffffff');
    gridHeaderRect.setAttribute('opacity', '1');
}
```

**대안 (getBBox 실패 시 fallback)**: `.lower-text`의 최대 `y` + `font-size` attribute(없으면 12px 기본값) + 4px(descender 여유)로 계산. 수식: `maxY + fontSize + 4`. 참고로 기존 코드의 `maxY + 16`은 font-size 약 12px + 여유 4px 합산과 동등하나, font-size를 실제 attribute에서 읽으면 뷰 모드별 차이를 정확히 반영할 수 있음.

#### 3.4.2 FR-02: 론치일 마커 z-order 보장

**문제 원인**: `setupGanttStickyHeader()`에서 `gridHeaderRect`와 `dateLayer`를 SVG 마지막 자식으로 이동함. 그런데 론치일 마커는 그 이전에 `svg.appendChild(g)` 되어 있어서, 결국 z-order가 `rect.grid-header` < `g.date` < `마커` 순서가 되어야 하는데, sticky header 설정 이후 마커를 추가하면 올바른 순서가 됨.

**현재 코드 흐름 분석**:

단일 프로젝트 간트 (`renderGantt()` 내):
```
1. addGanttDeadlineMarker()   → svg.appendChild(마커)
2. setupGanttStickyHeader()   → svg.appendChild(rect), svg.appendChild(dateLayer)
```
단계 2 이후 SVG 자식 순서: `...기존요소... → 마커 → rect.grid-header → g.date`
결과: `g.date`가 마커보다 위 → **마커 텍스트가 g.date에 가려짐**

전체 프로젝트 간트 (`loadAllProjectsGantt()` 내):
```
1. svgEl.querySelectorAll('.gantt-deadline-marker-group').forEach(el.remove())  [기존 마커 제거]
2. svgEl.appendChild(g)  [마커 추가, projectDataList.forEach 내]
3. setupGanttStickyHeader()
```
동일하게 sticky header 설정 시 마커보다 dateLayer가 뒤로 이동됨 → **마커 텍스트 가려짐**

**해결 방법**: `setupGanttStickyHeader()` 내에서 sticky header 요소(rect + dateLayer)를 SVG 마지막으로 이동한 후, 기존 deadline 마커를 다시 SVG 마지막으로 재이동.

```javascript
// setupGanttStickyHeader() 마지막 부분에 추가
// rect.grid-header, dateLayer 이동 이후:
var deadlineMarkers = Array.from(svg.querySelectorAll('.gantt-deadline-marker-group'));
deadlineMarkers.forEach(function(m) { svg.appendChild(m); });
var todayMarkers = Array.from(svg.querySelectorAll('.gantt-today-marker-group'));
todayMarkers.forEach(function(m) { svg.appendChild(m); });
```

이 방식은 마커를 re-append하므로, 마커가 항상 sticky header 위에 렌더링됨.

#### 3.4.3 FR-04: "시작일 최적화" → "일정 최적화" 텍스트 변경

**변경 대상 목록** (app.js):

| 위치 | 현재 텍스트 | 변경 텍스트 |
|------|------------|------------|
| line 1114 | `title="TODO 태스크 시작일 최적화"` | `title="TODO 태스크 일정 최적화"` |
| line 1114 | `> 시작일 최적화</button>` | `> 일정 최적화</button>` |
| line 1396 | `showToast(memberName + '님의 TODO 태스크 시작일이 최적화되었습니다.', 'success')` | `showToast(memberName + '님의 TODO 태스크 일정이 최적화되었습니다.', 'success')` |
| line 1402 | `showToast('시작일 최적화에 실패했습니다.', 'error')` | `showToast('일정 최적화에 실패했습니다.', 'error')` |
| line 3856 | `showToast('TODO 태스크 시작일이 최적화되었습니다.', 'success')` | `showToast('TODO 태스크 일정이 최적화되었습니다.', 'success')` |
| line 3862 | `console.error('시작일 최적화 실패:', e)` | `console.error('일정 최적화 실패:', e)` |
| line 3863 | `showToast('시작일 최적화에 실패했습니다.', 'error')` | `showToast('일정 최적화에 실패했습니다.', 'error')` |

**변경 대상 목록** (index.html):

| 위치 | 현재 텍스트 | 변경 텍스트 |
|------|------------|------------|
| line 281 | `> 시작일 최적화</button>` | `> 일정 최적화</button>` |

### 3.5 기존 시스템 연동

- `TaskRepository.findOverlappingTasks()`: 쿼리 파라미터 `excludeStatuses`를 그대로 사용. 쿼리 자체 변경 없음. `CONFLICT_EXCLUDE_STATUSES`를 넘기면 COMPLETED도 제외됨
- `setupGanttStickyHeader()`: 스크롤 핸들러 내부 로직(translateY 계산)은 변경 없음

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | TaskService.java - CONFLICT_EXCLUDE_STATUSES 추가 | 상수 추가 + validateAssigneeConflict() 수정 | 낮음 | 없음 |
| T-02 | WarningService.java - CONFLICT_EXCLUDE_STATUSES 추가 | 상수 추가 + SCHEDULE_CONFLICT 필터 수정 | 낮음 | 없음 |
| T-03 | app.js - setupGanttStickyHeader() height 계산 개선 | getBBox() 기반 정밀 계산 + fallback | 중간 | 없음 |
| T-04 | app.js - setupGanttStickyHeader() 마커 z-order 보장 | deadline/today 마커 re-append | 낮음 | T-03 (같은 함수 수정으로 함께 구현; T-03의 height 계산 수정 이후 동일 함수 하단에 추가) |
| T-05 | app.js - "시작일 최적화" → "일정 최적화" 텍스트 변경 | 7곳 문자열 치환 | 낮음 | 없음 |
| T-06 | index.html - "시작일 최적화" → "일정 최적화" 텍스트 변경 | 1곳 문자열 치환 | 낮음 | 없음 |

### 4.2 구현 순서

1. **T-01, T-02** (백엔드 충돌 제외): 독립적이므로 동시 진행 가능
2. **T-03** (FR-01 height 계산): `setupGanttStickyHeader()` 내부 로직 수정
3. **T-04** (FR-02 z-order): T-03 수정 후 같은 함수 하단에 마커 re-append 코드 추가
4. **T-05, T-06** (텍스트 변경): 독립적이므로 언제든 진행 가능

### 4.3 테스트 계획

**FR-01 테스트**:
- 간트차트 로드 시 scroll top=0 상태에서 첫번째 태스크 bar가 날짜 헤더에 가려지지 않는지 확인
- Day / Week / Month 뷰 모드 각각에서 확인
- 주말 제거 토글 ON/OFF 상태에서 확인

**FR-02 테스트**:
- 단일 프로젝트 간트에서 론치일 마커 텍스트가 날짜 헤더 위에 표시되는지 확인
- 전체 프로젝트 간트에서 다수 론치일 마커 텍스트가 모두 표시되는지 확인
- 수직 스크롤 시 마커 텍스트가 계속 보이는지 확인

**FR-03 테스트**:
- COMPLETED 상태 태스크와 날짜가 겹치는 새 태스크 생성 시 충돌 예외(AssigneeConflictException)가 발생하지 않는지 확인
- COMPLETED 상태 태스크가 Warning 목록에 SCHEDULE_CONFLICT로 나타나지 않는지 확인
- TODO, IN_PROGRESS 태스크 간 날짜 겹침 시 기존대로 충돌 예외 및 경고가 발생하는지 확인
- recalculateQueueDates() 동작에 변화가 없는지 확인 (COMPLETED 태스크가 여전히 queueStartDate 계산 기준점으로 동작)

**FR-04 테스트**:
- 프로젝트 상세 뷰 담당자 카드의 버튼 텍스트 확인
- 스케줄 탭의 버튼 텍스트 확인
- 최적화 실패 시 toast 메시지 텍스트 확인

---

## 5. 리스크 및 고려사항

### FR-01 getBBox() 관련 리스크

- `getBBox()`는 SVG 요소가 DOM에 렌더링된 상태에서만 유효한 값을 반환함. frappe-gantt가 setTimeout 내에서 렌더링을 완료한 직후 호출되는 현재 구조(`setTimeout(..., 100)`)에서는 정상 동작할 가능성이 높으나, 렌더링 지연이 있을 경우 0 또는 예외가 반환될 수 있음.
- **display:none 컨테이너 리스크**: `#gantt-container`가 속한 탭/섹션이 숨겨진 상태(`display:none`)에서 `getBBox()`를 호출하면 브라우저(Chrome, Firefox 공통)가 `{x:0, y:0, width:0, height:0}`을 반환함. 간트차트 탭이 처음 열릴 때만 렌더링되는 구조이므로 실제 발생 가능성은 낮으나, `dateBBox.height === 0` 조건 체크로 완화됨.
- **완화 방안**: `getBBox()` 결과의 `height === 0`이면 fallback으로 `.lower-text`의 최대 `y` + `font-size` attribute 값(없으면 12px) + 4px(descender 여유)로 계산. fallback 수식: `maxY + fontSize + 4`. 기존 코드의 `maxY + 16`은 font-size(약 12px) + descender(약 2px) + 여유(2px) 합산이었으나, 뷰 모드별 font-size 편차를 고려해 font-size를 직접 읽는 방식이 더 정확함.

### FR-02 re-append 타이밍 리스크

- `setupGanttStickyHeader()`에서 마커를 re-append할 때, 마커가 이미 SVG에 없는 경우(아직 추가 전)에는 querySelectorAll 결과가 빈 배열이므로 부작용 없음.
- 단일 프로젝트 간트와 전체 프로젝트 간트 모두 `setupGanttStickyHeader()` 호출 전에 마커를 추가하는 구조이므로 올바르게 동작함.

### FR-03 부작용 범위

- `INACTIVE_STATUSES`를 사용하는 모든 호출 지점 목록:
  - `TaskService`: `countSequentialTasksByAssigneeGlobal()` (line 515, 559, 630, 818)
  - `TaskService`: `validateAssigneeConflict()` (메서드 선언 line 974, `findOverlappingTasks` 호출 line 978~980) → **`findOverlappingTasks` 호출 지점(line 978~980)만 CONFLICT_EXCLUDE_STATUSES로 변경**
  - `TaskService`: `recalculateDependentTasks()` line 805, 893
  - `WarningService`: SCHEDULE_CONFLICT 필터 (line 150) → **이 지점만 CONFLICT_EXCLUDE_STATUSES로 변경**
  - `WarningService`: DEPENDENCY_ISSUE 필터 (line 178~179) → 변경 없음
  - `WarningService`: DEADLINE_EXCEEDED (line 191) → 변경 없음
- 나머지 지점들은 모두 `INACTIVE_STATUSES` 그대로 유지하여 기존 로직 보존.

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `src/main/resources/static/js/app.js`
  - `setupGanttStickyHeader()`: line 2638
  - `addGanttDeadlineMarker()`: line 2553
  - `addGanttDeadlineMarkerForElement()`: line 2174 (전체 프로젝트 간트용)
  - `loadAllProjectsGantt()` 내 마커 추가: line 2079~2128
  - 프로젝트 상세 담당자 카드 "시작일 최적화" 버튼: line 1114
  - 스케줄 탭 최적화 toast: line 3856, 3862~3863
- `src/main/resources/static/index.html`
  - 스케줄 탭 버튼: line 281
- `src/main/java/com/timeline/service/TaskService.java`
  - `INACTIVE_STATUSES`: line 42
  - `validateAssigneeConflict()`: 메서드 선언 line 974, `findOverlappingTasks` 호출 line 978~980
- `src/main/java/com/timeline/service/WarningService.java`
  - `INACTIVE_STATUSES`: line 38
  - SCHEDULE_CONFLICT 필터: line 148~153

### 이전 관련 계획서

- `docs/dev-plan/29-gantt-ux-and-improvements.md`: 간트차트 UX 개선
- `docs/dev-plan/30-jira-todo-filter-and-gantt-sticky.md`: 간트 sticky header 최초 구현
- `docs/dev-plan/32-jira-status-category-filter-and-gantt-sticky-header-fix.md`: sticky header 버그 수정 이력
