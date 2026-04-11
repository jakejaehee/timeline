# 개발 계획서: 프론트엔드 전면 개편 (UI 스펙 기반)

- 작성일: 2026-04-11
- 기준 문서: `docs/ui_spec-ko.md`
- 대상 파일: `index.html`, `app.js`, `styles.css` (3개 파일만 수정)

---

## 1. 개요

### 1.1 배경

현재 프론트엔드는 기능이 구현되어 있지만 메뉴 구조가 UI 스펙(`docs/ui_spec-ko.md`)과 다르다.
- 현재: Dashboard / Projects / Members / Domain Systems / Gantt (프로젝트 서브뷰) / Team Board / Holidays / AI Parser
- 목표: Dashboard / Projects(상세탭) / Tasks / 담당자 스케줄 / Gantt Chart / 경고 센터 / 설정 / AI Parser

### 1.2 목적

UI 스펙의 7개 화면을 구현하여 각 화면이 명확한 단일 책임을 갖도록 개편한다.
- 태스크 관리(생성/수정)와 순서 편집(담당자 스케줄)을 분리한다.
- 간트차트를 독립 전용 화면으로 승격한다.
- 경고/리스크를 전용 "경고 센터"에서 집중 관리한다.
- 설정(공휴일/개인휴무/capacity/담당자)을 단일 설정 메뉴로 통합한다.

### 1.3 범위

- **포함**: 메뉴 구조 변경, 7개 섹션 신규/개편, 글로벌 상단 바, 모달 재활용
- **제외**: 베이스라인(§10), 신규 백엔드 API (기존 API 최대 활용)
- **유지**: AI Parser 메뉴 (기존 그대로)

---

## 2. 현재 상태 분석

### 2.1 현재 메뉴 vs 목표 메뉴 매핑

| 현재 메뉴 (data-section) | 목표 메뉴 | 처리 방법 |
|---|---|---|
| dashboard | 대시보드 | 개편 (경고 카드 강화, 통계 카드 교체) |
| projects | 프로젝트 | 개편 (상세 탭 구조 추가) |
| (없음) | 태스크 | 신규 (전체 태스크 테이블, Team Board 데이터 활용) |
| team-board | 담당자 스케줄 | 개편 (3패널 레이아웃, section ID 변경) |
| gantt (서브뷰) | 간트차트 | 독립 메뉴로 승격 |
| (없음) | 경고 센터 | 신규 (WarningController 활용) |
| holidays | 설정 | 통합 (Holidays + Members + DomainSystems 탭) |
| ai-parser | AI Parser | 유지 |
| members | (설정으로 통합) | 설정 탭으로 이동 |
| domain-systems | (설정으로 통합) | 설정 탭으로 이동 |

### 2.2 활용 가능한 기존 API

| API | 용도 |
|---|---|
| `GET /api/v1/projects` | 프로젝트 목록 |
| `GET /api/v1/projects/{id}` | 프로젝트 상세 (members, domainSystems 포함) |
| `GET /api/v1/projects/{id}/tasks` | 간트차트 데이터 (GanttDataDto) |
| `GET /api/v1/team-board/tasks` | 전체 태스크 (필터 지원: status/priority/type/assigneeId/projectId/isDelayed/unordered) |
| `GET /api/v1/warnings/summary` | 전체 경고 요약 (Dashboard, 경고 센터) |
| `GET /api/v1/projects/{id}/warnings` | 프로젝트별 경고 |
| `GET /api/v1/members` | 멤버 목록 |
| `GET /api/v1/members/{assigneeId}/ordered-tasks` | 담당자 순서별 SEQUENTIAL 태스크 (`TaskController`에 정의) |
| `PATCH /api/v1/tasks/assignee-order` | 담당자 큐 순서 변경 |
| `GET /api/v1/holidays` | 공휴일 목록 |
| `GET /api/v1/domain-systems` | 도메인 시스템 목록 |

### 2.3 신규 필요 API

UI 스펙 요구사항 중 기존 API로 충족되지 않는 항목:

| 필요 기능 | 현재 상태 | 신규 API 필요 여부 |
|---|---|---|
| 전체 태스크 테이블 | `GET /api/v1/team-board/tasks` 데이터 재활용 | 불필요 (기존 활용) |
| 프로젝트 진행률 | `GanttDataDto`에서 태스크 상태 집계 | 불필요 (프론트 계산) |
| 담당자 workload | `team-board/tasks`에서 집계 | 불필요 (프론트 계산) |
| 마감 임박 프로젝트 | 프로젝트 목록 + deadline 필드로 프론트 계산 | 불필요 |
| 경고 센터 전체 목록 | `GET /api/v1/warnings/summary` (warnings 배열 포함) | 불필요 (기존 활용) |

**결론: 신규 백엔드 API 불필요. 기존 API 재조합으로 구현 가능.**

---

## 3. 화면별 상세 설계

### 3.1 공통 레이아웃 변경

#### 글로벌 상단 바 추가

현재는 상단 바가 없다. 다음 요소를 포함하는 `<header id="topbar">` 를 신규 추가한다.

```
[Timeline 로고 공간] | [검색 입력] [빠른 추가 버튼] [경고 배지] [설정 아이콘]
```

- 검색: 프론트엔드 전용 (현재 섹션 내 텍스트 검색, 별도 검색 API 없음)
- 빠른 추가: 태스크 추가 모달 호출 (현재 `showTaskModal()` 재활용)
- 경고 배지: `GET /api/v1/warnings/summary`의 `data.totalWarnings` 표시. ID는 `topbar-warning-badge`로 명명. 사이드바 경고 센터 메뉴 안의 배지(`id="sidebar-warning-count"`)와 함께 `T18` 작업에서 동시에 갱신한다.
- 설정 아이콘: 설정 섹션으로 이동

#### 레이아웃 구조 변경

```
현재: sidebar(250px) | main-content (margin-left: 250px, padding: 20px 30px)
목표: sidebar(220px) | topbar(height: 56px, fixed) | main-content (margin-left: 220px, margin-top: 56px, padding: 16px 24px)
```

CSS 변경: `#sidebar` width 250px → 220px, `#main-content` margin-left/top 조정, `#topbar` 고정 헤더 추가.

---

### 3.2 대시보드 (dashboard)

#### 현재 상태
- 통계 카드 3개: 진행 중 프로젝트, 전체 멤버, 전체 태스크
- 경고 요약 카드 (이미 구현: `loadDashboardWarnings()`)
- 최근 프로젝트 테이블

#### 변경 내용

통계 카드를 UI 스펙 기준으로 교체한다.

| 현재 카드 | 변경 후 카드 | 데이터 소스 |
|---|---|---|
| 진행 중 프로젝트 수 | 진행 중 프로젝트 수 | 유지 |
| 전체 멤버 수 | 지연 프로젝트 수 | `projects.filter(p => p.isDelayed)` |
| 전체 태스크 수 | 순서 미지정 태스크 수 | `warningsRes.data.unorderedCount` (`SummaryResponse` 필드) |
| (없음) | 일정 충돌 수 | `warningsRes.data.scheduleConflictCount` (`SummaryResponse` 필드) |

추가 섹션:
- **담당자 workload 카드**: `GET /api/v1/team-board/tasks` 결과에서 멤버별 활성 태스크 수 집계
- **마감 임박 프로젝트 카드**: deadline이 오늘로부터 14일 이내인 프로젝트 목록
- **경고 요약**: 기존 `loadDashboardWarnings()` 유지 및 위치 조정

`loadDashboard()` 함수 수정 사항:
- `Promise.all` 병렬 호출에 `GET /api/v1/warnings/summary` 추가
- 통계 카드 ID 변경: `stat-members` → `stat-delayed`, `stat-tasks` → `stat-unordered`, 신규 `stat-conflict`
- 마감 임박 테이블 신규 렌더링

---

### 3.3 프로젝트 (projects)

#### 현재 상태
- 프로젝트 목록 테이블 (projects-section)
- 클릭 시 Gantt 서브뷰로 전환 (`showGanttChart(projectId)`)
- 프로젝트 추가/수정 모달

#### 변경 내용

프로젝트 목록에서 프로젝트 클릭 시 **프로젝트 상세 화면**으로 전환. 상세 화면은 탭 구조.

**탭 구조:**

| 탭 | 내용 | 데이터 소스 |
|---|---|---|
| 개요 | 프로젝트 정보 + 진행률 바 | `GET /api/v1/projects/{id}` |
| 태스크 | 프로젝트 태스크 테이블 | `GET /api/v1/projects/{id}/tasks` |
| 일정 | 프로젝트 간트차트 (축소 버전) | `GET /api/v1/projects/{id}/tasks` (frappe-gantt) |
| 참여자 | 멤버 추가/제거 | `GET /api/v1/projects/{id}` (members) |

**HTML 구조:**
```html
<!-- 현재 projects-section 내 -->
<div id="project-list-view">  <!-- 목록 -->
  <table id="projects-table">...</table>
</div>
<div id="project-detail-view" style="display:none;">  <!-- 상세 -->
  <button onclick="showProjectList()">← 목록</button>
  <ul class="nav nav-tabs" id="project-detail-tabs">
    <li><a data-bs-toggle="tab" href="#tab-overview">개요</a></li>
    <li><a data-bs-toggle="tab" href="#tab-tasks">태스크</a></li>
    <li><a data-bs-toggle="tab" href="#tab-schedule">일정</a></li>
    <li><a data-bs-toggle="tab" href="#tab-members">참여자</a></li>
  </ul>
  <div class="tab-content">
    <div id="tab-overview">...</div>
    <div id="tab-tasks">...</div>
    <div id="tab-schedule">...</div>
    <div id="tab-members">...</div>
  </div>
</div>
```

**신규/변경 JS 함수:**

| 함수 | 설명 |
|---|---|
| `showProjectList()` | 목록 뷰 표시, 상세 뷰 숨김 |
| `showProjectDetail(projectId)` | 상세 뷰 표시, 첫 탭(개요) 로드 |
| `loadProjectOverview(projectId)` | 개요 탭 렌더링 (이름, 기간, 진행률) |
| `loadProjectTasks(projectId)` | 태스크 탭 렌더링. `GET /api/v1/projects/{id}/tasks` (`GanttDataDto`)의 `data.domainSystems[].tasks[]` 배열을 flat하여 단일 테이블 렌더링 |
| `loadProjectSchedule(projectId)` | 일정 탭 렌더링 (frappe-gantt, 기존 renderGantt 재활용) |
| `loadProjectMembers(projectId)` | 참여자 탭 렌더링 (추가/제거 UI) |

현재 `showGanttChart(projectId)` 는 프로젝트 상세 → 일정 탭으로 대체됨.

**진행률 계산 (프론트):**
```
진행률(%) = (COMPLETED 태스크 수 / 전체 태스크 수) * 100
```

---

### 3.4 태스크 (tasks) - 신규

#### 목적

전체 프로젝트에 걸친 태스크를 단일 테이블에서 조회하고, 필터링 및 CRUD를 수행한다.

#### 데이터 소스

`GET /api/v1/team-board/tasks` 엔드포인트를 재활용한다. 이 API는 이미 project, assignee, status, priority, type, startDate, endDate, isDelayed, unordered 필터를 지원한다.

응답 구조 (`TeamBoardDto.Response`):
- `data.members[].tasks[]`: 담당자별 태스크 목록
- `data.unassigned[]`: 미배정 태스크

프론트에서 `data.members[].tasks[]` 배열을 flat하여 단일 태스크 배열로 변환해 테이블 렌더링. `data.unassigned[]`(미배정 태스크)도 동일하게 포함시킨다. 각 태스크 항목에서 `task.projectName`, `task.assigneeName`을 직접 참조 가능 (`TeamBoardDto.TaskItem` 구조 기준).

#### HTML 섹션 (신규: `tasks-section`)

```html
<div id="tasks-section" class="section" style="display:none;">
  <!-- 필터 영역 -->
  <div class="card mb-3">
    <!-- project, assignee, status, priority, type, 날짜 필터 -->
    <!-- 지연/순서미지정 체크박스 -->
    <!-- 조회/초기화 버튼 -->
  </div>
  <!-- 태스크 테이블 -->
  <div class="card">
    <table id="tasks-table">
      <thead>프로젝트 | 태스크명 | 유형 | 우선순위 | 담당자 | 시작일 | 종료일 | MD | 상태 | 액션</thead>
      <tbody id="tasks-table-body">...</tbody>
    </table>
  </div>
</div>
```

#### JS 함수

| 함수 | 설명 |
|---|---|
| `loadTasks()` | 섹션 진입 시 필터 드롭다운 초기화 + 전체 조회 |
| `applyTasksFilter()` | 필터 파라미터 구성 → team-board API 호출 |
| `resetTasksFilter()` | 필터 초기화 |
| `renderTasksTable(data)` | members 배열 flat → 테이블 렌더링 |

현재 Team Board 필터(`tb-filter-*`)와 다른 ID 체계(`task-filter-*`)를 사용해 충돌 방지.

태스크 클릭 → 기존 `showTaskDetail(taskId)` 재활용.
태스크 추가 버튼 → 기존 `showTaskModal()` 재활용.

---

### 3.5 담당자 스케줄 (assignee-schedule) - 개편

#### 현재 상태 (team-board-section)
- 필터 + 3가지 뷰 모드 (assignee / project-assignee / assignee-project)
- Drag & Drop 순서 변경 (SortableJS, `initTeamBoardDragDrop()`)
- 태스크 클릭 → 상세 패널

#### 변경 내용

Team Board 섹션의 **section ID와 메뉴명을 변경**하고, UI 스펙의 3패널 레이아웃에 맞게 구조를 조정한다.

**Section ID 변경**: `team-board-section` → `assignee-schedule-section`
(기존 함수들은 내부 element ID만 변경하고 함수 이름은 그대로 유지 가능)

**3패널 레이아웃:**

```
┌─────────────┬─────────────────────────────┬──────────────────────┐
│ 담당자 리스트 │  태스크 큐 (Drag & Drop)     │  태스크 상세           │
│  (20%)      │  (50%)                      │  (30%)               │
│             │  - SEQUENTIAL 태스크         │  - 이름, 기간, MD     │
│ [김개발]    │  - 순서 번호 표시             │  - 설명               │
│ [이디자인]  │  - assigneeOrder 표시        │  - 의존관계           │
│ [박QA]     │  - 드래그 핸들               │  - 링크               │
│             │                             │  - 상태 변경           │
│ 클릭 시      │  순서미지정 태스크 별도 표시  │                      │
│ 해당 담당자  │  (assigneeOrder = null)     │                      │
│ 큐 표시      │                             │                      │
└─────────────┴─────────────────────────────┴──────────────────────┘
```

**HTML 구조 변경:**

```html
<div id="assignee-schedule-section" class="section" style="display:none;">
  <div class="section-header">
    <h2>담당자 스케줄</h2>
    <button class="btn btn-outline-secondary btn-sm" onclick="showTaskModal()">
      태스크 추가
    </button>
  </div>
  <div class="d-flex gap-0" style="height: calc(100vh - 120px);">
    <!-- 패널 1: 담당자 리스트 -->
    <div id="schedule-member-panel" class="schedule-panel-left">
      <div id="schedule-member-list">...</div>
    </div>
    <!-- 패널 2: 태스크 큐 -->
    <div id="schedule-queue-panel" class="schedule-panel-middle">
      <div id="schedule-member-name" class="panel-title">...</div>
      <div id="schedule-ordered-tasks" class="sortable-list">...</div>
      <div id="schedule-unordered-tasks">...</div>
    </div>
    <!-- 패널 3: 태스크 상세 -->
    <div id="schedule-detail-panel" class="schedule-panel-right">
      <div id="schedule-task-detail-content">
        담당자를 선택하고 태스크를 클릭하세요.
      </div>
    </div>
  </div>
</div>
```

**신규/변경 JS 함수:**

| 함수 | 설명 |
|---|---|
| `loadAssigneeSchedule()` | 담당자 목록 로드, 멤버 리스트 렌더링 |
| `selectScheduleMember(memberId, name)` | 담당자 선택 → `GET /api/v1/members/{id}/ordered-tasks` 호출 |
| `renderScheduleQueue(tasks)` | 큐 렌더링 (순서 있음 / 순서 없음 분리) |
| `showScheduleTaskDetail(taskId)` | 우측 패널에 태스크 상세 인라인 표시 |
| `initScheduleDragDrop(memberId)` | SortableJS 초기화 (기존 `initTeamBoardDragDrop` 기반) |

**기존 코드 재활용:**
- `reorderAssigneeTasks(assigneeId, taskIds)` 그대로 재활용.
  단, 기존 코드는 완료 후 `applyTeamBoardFilter()`를 호출하는데, 담당자 스케줄 섹션에서는 해당 함수가 없으므로 **`selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName)`를 호출하도록 수정**해야 한다. 전역 변수 `currentScheduleMemberId`, `currentScheduleMemberName`을 추가하여 현재 선택된 담당자를 추적한다.
- `showTaskDetail(taskId, options)` 우측 패널에 인라인 렌더링으로 재활용

---

### 3.6 간트차트 (gantt-chart) - 독립 메뉴로 승격

#### 현재 상태

간트차트는 프로젝트 클릭 시 `showGanttChart(projectId)` 로 전환되는 서브뷰. 별도 메뉴 없음.

#### 변경 내용

독립 사이드바 메뉴로 승격. 프로젝트 선택 드롭다운을 헤더에 추가.

**Section ID**: 기존 `gantt-section` 유지 (이미 구현 완료)

**변경 사항:**
- 사이드바에 "간트차트" 메뉴 항목 추가 (`data-section="gantt"`)
- 섹션 진입 시 프로젝트 선택 드롭다운 표시 (프로젝트 미선택 시 안내 메시지)
- 프로젝트 선택 → `loadGanttData(projectId)` 호출 (기존 함수 그대로)
- 기존 뒤로가기 버튼("← 프로젝트 목록") → 제거 또는 "프로젝트 상세로 돌아가기"로 변경

**HTML 변경 (gantt-section header 부분):**

```html
<!-- 기존: 뒤로가기 버튼 + 프로젝트 타이틀 -->
<!-- 변경: 프로젝트 선택 드롭다운 추가 -->
<div class="section-header">
  <div class="d-flex align-items-center gap-3">
    <h2><i class="bi bi-bar-chart-gantt"></i> 간트차트</h2>
    <select id="gantt-project-select" class="form-select form-select-sm"
            style="width:200px" onchange="onGanttProjectChange(this.value)">
      <option value="">프로젝트 선택...</option>
    </select>
  </div>
  <!-- 뷰 모드 버튼 그룹 유지 -->
</div>
```

**신규 JS 함수:**

| 함수 | 설명 |
|---|---|
| `loadGanttSection()` | 프로젝트 드롭다운 초기화 |
| `onGanttProjectChange(projectId)` | 프로젝트 선택 시 간트 로드 |

기존 `renderGantt()`, `addGanttTodayMarker()`, `addGanttDeadlineMarker()`, `changeGanttViewMode()` 등 모두 그대로 재활용.

---

### 3.7 경고 센터 (warning-center) - 신규

#### 목적

전체/프로젝트별 경고 목록을 표시하고 해결 가이드를 제공한다.

#### 데이터 소스

- `GET /api/v1/warnings/summary`: 전체 경고 요약 및 경고 목록
- `GET /api/v1/projects/{id}/warnings`: 프로젝트별 상세 경고

#### HTML 섹션 (신규: `warning-center-section`)

```html
<div id="warning-center-section" class="section" style="display:none;">
  <div class="section-header">
    <h2><i class="bi bi-exclamation-triangle"></i> 경고 센터</h2>
    <button class="btn btn-outline-secondary btn-sm" onclick="loadWarningCenter()">
      <i class="bi bi-arrow-clockwise"></i> 새로고침
    </button>
  </div>

  <!-- 요약 카드 -->
  <div class="row mb-4" id="warning-summary-cards">
    <!-- 경고 유형별 카운트 카드 -->
  </div>

  <!-- 필터 -->
  <div class="card mb-3">
    <div class="card-body">
      <select id="wc-filter-project" class="form-select form-select-sm">
        <option value="">전체 프로젝트</option>
      </select>
      <select id="wc-filter-type" class="form-select form-select-sm">
        <option value="">전체 유형</option>
        <option value="UNORDERED_TASK">순서미지정</option>
        <option value="MISSING_START_DATE">시작일미설정</option>
        <option value="SCHEDULE_CONFLICT">일정충돌</option>
        <option value="DEPENDENCY_ISSUE">의존관계문제</option>
        <option value="DEADLINE_EXCEEDED">마감초과</option>
        <option value="ORPHAN_TASK">고아태스크</option>
        <option value="DEPENDENCY_REMOVED">의존성비활성</option>
        <option value="UNAVAILABLE_DATE">비가용일배정</option>
      </select>
    </div>
  </div>

  <!-- 경고 목록 -->
  <div id="warning-list-content">...</div>
</div>
```

#### 경고 카드 렌더링 형식

```
[경고 아이콘] [경고 유형] [태스크명] [프로젝트명]
[경고 메시지 설명]
[→ 해결 버튼] (클릭 시 해당 태스크/담당자 스케줄로 이동)
```

#### 해결 가이드 버튼 동작

| 경고 유형 | 해결 버튼 동작 |
|---|---|
| UNORDERED_TASK | 담당자 스케줄 섹션으로 이동 |
| MISSING_START_DATE | 담당자 스케줄 섹션으로 이동 |
| SCHEDULE_CONFLICT | 담당자 스케줄 섹션으로 이동 |
| DEPENDENCY_ISSUE | 태스크 수정 모달 열기 (`showTaskModal(taskId)`) |
| DEADLINE_EXCEEDED | 프로젝트 상세 → 개요 탭으로 이동 |
| ORPHAN_TASK | 태스크 수정 모달 열기 |
| DEPENDENCY_REMOVED | 태스크 수정 모달 열기 (선행 태스크 상태 확인) |
| UNAVAILABLE_DATE | 설정 → 개인휴무 탭으로 이동 |

**신규 JS 함수:**

| 함수 | 설명 |
|---|---|
| `loadWarningCenter()` | 전체 경고 요약 로드, 카드 렌더링 |
| `renderWarningList(warnings)` | 경고 목록 렌더링 |
| `resolveWarning(type, taskId, projectId)` | 해결 버튼 클릭 시 해당 화면으로 이동 |

---

### 3.8 설정 (settings) - 통합

#### 현재 상태

- `holidays-section`: 공휴일 + 개인휴무 관리
- `members-section`: 멤버 CRUD (별도 메뉴)
- `domain-systems-section`: 도메인 시스템 CRUD (별도 메뉴)

#### 변경 내용

기존 3개 섹션을 단일 `settings-section`으로 통합하고 탭 구조로 구성.

**Section ID**: `holidays-section` → `settings-section` (기존 holidays-section 제거)

**탭 구조:**

| 탭 | 내용 | 기존 섹션 |
|---|---|---|
| 공휴일 | 공휴일/회사휴무 CRUD | holidays-section |
| 개인 휴무 | 멤버별 개인휴무 CRUD | holidays-section 하단 |
| 담당자 | 멤버 CRUD + capacity | members-section |
| 도메인 시스템 | 도메인 시스템 CRUD | domain-systems-section |

**HTML 구조:**

```html
<div id="settings-section" class="section" style="display:none;">
  <div class="section-header">
    <h2><i class="bi bi-gear"></i> 설정</h2>
  </div>
  <ul class="nav nav-tabs mb-3" id="settings-tabs">
    <li><a class="nav-link active" data-bs-toggle="tab" href="#settings-holidays">공휴일</a></li>
    <li><a class="nav-link" data-bs-toggle="tab" href="#settings-leaves">개인 휴무</a></li>
    <li><a class="nav-link" data-bs-toggle="tab" href="#settings-members">담당자</a></li>
    <li><a class="nav-link" data-bs-toggle="tab" href="#settings-domains">도메인 시스템</a></li>
  </ul>
  <div class="tab-content">
    <div id="settings-holidays" class="tab-pane active">
      <!-- 기존 공휴일 테이블 HTML 이동 -->
    </div>
    <div id="settings-leaves" class="tab-pane">
      <!-- 기존 개인휴무 HTML 이동 -->
    </div>
    <div id="settings-members" class="tab-pane">
      <!-- 기존 멤버 테이블 HTML 이동 -->
    </div>
    <div id="settings-domains" class="tab-pane">
      <!-- 기존 도메인 시스템 테이블 HTML 이동 -->
    </div>
  </div>
</div>
```

**JS 변경 사항:**
- `loadHolidaysSection()` → `loadSettingsSection()` 로 이름 변경 (내부적으로 공휴일 탭 초기화 + 멤버 드롭다운 초기화)
- `showSection('holidays')` 호출 코드 → `showSection('settings')` 로 변경
- 탭 전환 시 해당 섹션 데이터 로드 (탭 `show.bs.tab` 이벤트 활용). 탭별 로드 함수 매핑:

  | 탭 ID | `show.bs.tab` 이벤트 시 호출 함수 |
  |---|---|
  | `#settings-holidays` | `loadHolidays()` |
  | `#settings-leaves` | (멤버 선택 후 `loadMemberLeaves()` — 진입 시 멤버 드롭다운만 초기화) |
  | `#settings-members` | `loadMembers()` |
  | `#settings-domains` | `loadDomainSystems()` |

- 기존 `loadMembers()`, `loadDomainSystems()`, `loadHolidays()`, `loadMemberLeaves()` 함수는 그대로 유지

---

## 4. 사이드바 메뉴 최종 구성

```html
<ul class="sidebar-nav">
  <li>
    <a href="#" class="nav-link active" data-section="dashboard" onclick="showSection('dashboard', this)">
      <i class="bi bi-speedometer2"></i> 대시보드
    </a>
  </li>
  <li>
    <a href="#" class="nav-link" data-section="projects" onclick="showSection('projects', this)">
      <i class="bi bi-folder"></i> 프로젝트
    </a>
  </li>
  <li>
    <a href="#" class="nav-link" data-section="tasks" onclick="showSection('tasks', this)">
      <i class="bi bi-list-task"></i> 태스크
    </a>
  </li>
  <li>
    <a href="#" class="nav-link" data-section="assignee-schedule" onclick="showSection('assignee-schedule', this)">
      <i class="bi bi-person-lines-fill"></i> 담당자 스케줄
    </a>
  </li>
  <li>
    <a href="#" class="nav-link" data-section="gantt" onclick="showSection('gantt', this)">
      <i class="bi bi-bar-chart-gantt"></i> 간트차트
    </a>
  </li>
  <li>
    <a href="#" class="nav-link" data-section="warning-center" onclick="showSection('warning-center', this)">
      <i class="bi bi-exclamation-triangle"></i> 경고 센터
      <span id="sidebar-warning-count" class="badge bg-danger rounded-pill ms-auto" style="display:none;">0</span>
    </a>
  </li>
  <li>
    <a href="#" class="nav-link" data-section="settings" onclick="showSection('settings', this)">
      <i class="bi bi-gear"></i> 설정
    </a>
  </li>
  <li>
    <a href="#" class="nav-link" data-section="ai-parser" onclick="showSection('ai-parser', this)">
      <i class="bi bi-robot"></i> AI Parser
    </a>
  </li>
</ul>
```

**제거 메뉴**: Members, Domain Systems, Team Board (기존 섹션 ID 삭제)
**변경 메뉴**: Gantt Chart (독립 메뉴), Holidays → 설정으로 통합

---

## 5. showSection() 함수 변경

현재 `showSection()`의 switch문에서 섹션별 로드 함수 호출. 다음과 같이 수정:

```javascript
switch (sectionName) {
    case 'dashboard':       loadDashboard(); break;
    case 'projects':        loadProjects(); break;
    case 'tasks':           loadTasks(); break;           // 신규
    case 'assignee-schedule': loadAssigneeSchedule(); break; // team-board 대체
    case 'gantt':           loadGanttSection(); break;    // 신규 래퍼
    case 'warning-center':  loadWarningCenter(); break;   // 신규
    case 'settings':        loadSettingsSection(); break; // holidays 통합
    case 'ai-parser':       loadAiParserProjects(); break;
    // 제거: members, domain-systems, team-board, holidays
}
```

---

## 6. 신규 API 요구사항

**결론: 신규 백엔드 API 불필요.**

모든 신규 화면은 기존 API의 데이터를 조합하거나 프론트엔드에서 집계하여 구현한다. 단, 아래 사항은 확인 필요:

| 확인 항목 | 기존 API | 비고 |
|---|---|---|
| 태스크 테이블 (전체) | `GET /api/v1/team-board/tasks` | members 배열 flat 처리 필요 |
| 프로젝트 진행률 | `GET /api/v1/projects/{id}/tasks` (GanttDataDto) | 태스크 status 집계 |
| 담당자 workload | `GET /api/v1/team-board/tasks` | 멤버별 태스크 수 집계 |
| 경고 전체 목록 | `GET /api/v1/warnings/summary` | warnings 배열 사용 |
| 경고 배지 카운트 | `GET /api/v1/warnings/summary` | totalWarnings 사용 |

---

## 7. CSS 변경 계획

### 7.1 기존 제거 또는 수정

| 대상 | 변경 |
|---|---|
| `#main-content` margin-left: 250px | 220px로 축소 |
| `#sidebar` width: 250px | 220px로 축소 |

### 7.2 신규 추가

```css
/* 글로벌 상단 바 */
#topbar {
    position: fixed; top: 0; left: 220px; right: 0;
    height: 56px; background: #fff;
    border-bottom: 1px solid #dee2e6;
    z-index: 999;
    display: flex; align-items: center; padding: 0 24px; gap: 12px;
}

#main-content {
    margin-left: 220px;
    margin-top: 56px;   /* 상단 바 높이 */
    padding: 16px 24px;
}

/* 담당자 스케줄 3패널 */
.schedule-panel-left { width: 20%; border-right: 1px solid #dee2e6; overflow-y: auto; }
.schedule-panel-middle { width: 50%; border-right: 1px solid #dee2e6; overflow-y: auto; padding: 12px; }
.schedule-panel-right { width: 30%; overflow-y: auto; padding: 12px; }
.schedule-member-item { cursor: pointer; padding: 8px 12px; border-radius: 6px; }
.schedule-member-item:hover { background: rgba(78,115,223,0.08); }
.schedule-member-item.active { background: rgba(78,115,223,0.2); font-weight: 600; }

/* 프로젝트 진행률 바 */
.progress-sm { height: 6px; }

/* 경고 센터 경고 카드 */
.warning-item { border-left: 4px solid #dc3545; padding: 12px; margin-bottom: 8px; background: #fff; border-radius: 4px; }
.warning-item.severity-high { border-left-color: #dc3545; }
.warning-item.severity-medium { border-left-color: #ffc107; }

/* 사이드바 배지 */
.sidebar-nav .nav-link .badge { font-size: 0.65rem; line-height: 1.4; }
```

---

## 8. 구현 작업 분해 (Task Breakdown)

| # | 작업 | 파일 | 복잡도 | 의존성 |
|---|---|---|---|---|
| T1 | 사이드바 메뉴 재구성 (HTML) | index.html | 낮음 | 없음 |
| T2 | 글로벌 상단 바 HTML + CSS | index.html, styles.css | 낮음 | T1 |
| T3 | CSS 레이아웃 조정 (topbar, sidebar 축소) | styles.css | 낮음 | T1 |
| T4 | 대시보드 통계 카드 교체 (HTML + JS) | index.html, app.js | 중간 | T1, T2, T3 |
| T5 | 프로젝트 상세 탭 구조 (HTML) | index.html | 중간 | T1 |
| T6 | 프로젝트 상세 탭 JS 함수 | app.js | 중간 | T5 |
| T7 | 태스크 섹션 신규 (HTML) | index.html | 중간 | T1 |
| T8 | 태스크 섹션 JS 함수 | app.js | 중간 | T7 |
| T9 | 담당자 스케줄 HTML 구조 변경 (3패널) | index.html | 높음 | T1 |
| T10 | 담당자 스케줄 JS 함수 (멤버 선택, 큐 렌더링) | app.js | 높음 | T9 |
| T11 | 담당자 스케줄 CSS (3패널 레이아웃) | styles.css | 중간 | T9 |
| T12 | 간트차트 독립 메뉴 (프로젝트 드롭다운 추가) | index.html, app.js | 낮음 | T1 |
| T13 | 경고 센터 섹션 HTML | index.html | 중간 | T1 |
| T14 | 경고 센터 JS 함수 | app.js | 중간 | T13 |
| T15 | 설정 탭 통합 HTML (holidays + leaves + members + domains) | index.html | 중간 | T1 |
| T16 | 설정 탭 JS 연결 (showSection 수정) | app.js | 낮음 | T15 |
| T17 | showSection() switch문 업데이트 | app.js | 낮음 | T1~T16 |
| T18 | 경고 배지 자동 갱신 (상단 바 + 사이드바) | app.js | 낮음 | T2, T14 |
| T19 | 전체 검증 (컴파일, 링크 동작, 모달 동작) | - | - | 전체 |

---

## 9. 구현 순서

```
1단계 (뼈대): T1 → T2 → T3
2단계 (섹션 HTML): T5 → T7 → T9 → T13 → T15
3단계 (섹션 JS): T4 → T6 → T8 → T10 → T12 → T14 → T16
4단계 (마무리): T11 → T17 → T18 → T19
```

---

## 10. 리스크 및 고려사항

### 10.1 ID 충돌

- 담당자 스케줄 내부 element ID가 기존 Team Board와 겹칠 수 있음.
- 해결: `schedule-*` 접두사 통일, 기존 `tb-filter-*` ID를 `task-filter-*`로 변경.

### 10.2 간트차트 frappe-gantt 인스턴스

- 현재 `ganttInstance` 전역 변수 1개. 프로젝트 상세 탭(일정)과 간트차트 메뉴가 동시에 gantt를 사용할 경우 충돌 가능.
- 해결: 프로젝트 상세 탭의 간트는 별도 `projectGanttInstance` 전역 변수로 분리.

### 10.3 showSection('gantt') 기존 호출 코드

- 현재 여러 곳에서 `showGanttChart(projectId)`가 호출되어 `showSection('gantt')`로 이동함.
- 프로젝트 상세 → 일정 탭으로 대체되므로, 기존 `showGanttChart()` 호출을 `showProjectDetail(projectId, 'schedule')` 으로 변경.

### 10.4 app.js 규모

- 현재 3,007줄. 변경 후 약 3,500~4,000줄 예상.
- 단일 파일 구조 유지 (번들러 없음).
- 섹션별 주석 블록(`// ====`) 으로 구분 유지.

### 10.5 Team Board 기존 기능 보존

- 담당자 스케줄은 §3.5에서 설계한 **단일 3패널 레이아웃**으로 재설계된다. 기존 Team Board의 "담당자 > 태스크", "프로젝트 > 담당자 > 태스크", "담당자 > 프로젝트 > 태스크" 3가지 뷰 모드는 이관 대상이 아니며 폐기한다.
- 기존 Team Board 필터(project, assignee, status, priority, type, 날짜, 지연, 순서미지정)는 §3.4 태스크 섹션에서 `task-filter-*` ID로 재활용된다.
- Drag & Drop 순서 변경 기능(`initTeamBoardDragDrop`, `reorderAssigneeTasks`)은 담당자 스케줄 섹션에서 `initScheduleDragDrop`으로 대체한다.
- `renderTeamBoard()`, `renderTeamBoardProjectAssignee()`, `renderTeamBoardAssigneeProject()` 함수는 더 이상 사용되지 않으므로 코드에서 제거한다. (단, 기존 Team Board 섹션 HTML도 함께 제거됨을 전제)

---

## 11. 참고 코드 경로

- `src/main/resources/static/index.html` - 전체 HTML
- `src/main/resources/static/js/app.js` - 전체 JS (3,007줄)
- `src/main/resources/static/css/styles.css` - 전체 CSS (632줄)
- `src/main/java/com/timeline/controller/WarningController.java` - `/api/v1/warnings/summary`
- `src/main/java/com/timeline/controller/TeamBoardController.java` - `/api/v1/team-board/tasks`
- `src/main/java/com/timeline/dto/WarningDto.java` - SummaryResponse, Warning 구조
- `src/main/java/com/timeline/dto/TeamBoardDto.java` - Response, MemberGroup, TaskItem 구조
- `src/main/java/com/timeline/dto/ProjectDto.java` - Response (expectedEndDate, isDelayed 포함)
