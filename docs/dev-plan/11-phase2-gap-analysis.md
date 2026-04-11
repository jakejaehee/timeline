# 개발 계획서: Phase 2 갭 분석 및 수정 계획

- 작성일: 2026-04-11
- 기준 코드: 현재 main 브랜치 (Phase 1 구현 완료 상태)
- 기준 요구사항: `docs/requirements-ko.md`

---

## 1. 개요

Phase 1에서 GAP-01~08, GAP-14를 구현 완료하였다. 본 계획서는 현재 코드베이스를 직접 읽고 `requirements-ko.md` §1~§14 전 구간과 대조하여, **아직 미구현되었거나 불완전하게 구현된 항목만**을 식별하고 Phase 2 수정 계획을 제시한다.

---

## 2. 현재 구현 상태 (코드 직접 확인 결과)

### 2.1 엔티티 상태

| 엔티티 | 구현된 필드 | 비고 |
|--------|------------|------|
| `Task` | id, project, domainSystem, assignee, name, description, startDate, endDate, manDays, status(5종), executionMode, priority, type, actualEndDate, assigneeOrder, sortOrder, createdAt, updatedAt | Phase 1 완료 |
| `Member` | id, name, role, email, capacity(BigDecimal), active, createdAt, updatedAt | capacity 구현 완료 |
| `Project` | id, name, type, description, startDate, endDate, deadline, status, createdAt, updatedAt | expectedEndDate/isDelayed는 서비스에서 계산 |
| `TaskDependency` | id, task, dependsOnTask | 완료 |
| `TaskLink` | id, task, url, label | 완료 |

### 2.2 서비스 계층 상태

| 기능 | 구현 상태 | 비고 |
|------|---------|------|
| SEQUENTIAL 날짜 자동 계산 | 완료 | BFS 연쇄 재계산 포함 |
| capacity 반영 (MD/capacity) | 완료 | `BusinessDayCalculator.calculateEndDate()` |
| Same-Day Rule (소숫점 MD) | 완료 | `isFractionalMd()` 활용 |
| Hold/Cancelled 의존관계 제외 | 완료 | `INACTIVE_STATUSES` 상수 |
| 전역 담당자 큐 (assigneeOrder) | 완료 | `AssigneeOrderService` |
| expectedEndDate/isDelayed | 완료 | `ProjectService.calculateExpectedEndDate()` |
| 비가용일 (공휴일/회사휴일/개인휴가) | **미구현** | `BusinessDayCalculator`는 토/일만 제외 |
| Warning 시스템 | **미구현** | 8가지 경고 모두 미구현 |
| Baseline 스냅샷 | **미구현** | |

### 2.3 API 상태

| 컨트롤러 | 구현된 엔드포인트 | 미구현 |
|---------|---------------|------|
| TaskController | CRUD, 의존관계, 링크, 프리뷰 | - |
| TeamBoardController | GET /api/v1/team-board/tasks (status/projectId/날짜 필터) | priority/type/assigneeOrder 필터 |
| ProjectController | CRUD, 멤버/도메인시스템 관리 | - |
| MemberController | CRUD | - |
| AssigneeOrderController | 담당자 큐 순서 변경 | - |

### 2.4 프론트엔드 상태

| UI 기능 | 구현 상태 | 비고 |
|---------|---------|------|
| 간트차트 (frappe-gantt) | 기본 동작 | 도메인시스템 그룹핑 |
| 간트차트 오늘 표시 | **미구현** | frappe-gantt의 `today_button` 옵션은 버튼만 제공하며 수직선 마커는 커스텀 구현 필요 |
| 간트차트 마감선 (deadline marker) | **미구현** | |
| 간트차트 의존성 화살표 | 부분 구현 | frappe-gantt `dependencies` 필드 전달하나 렌더링은 라이브러리 의존 |
| 간트차트 접기/펼치기 | **미구현** | |
| Team Board 정렬 뷰 (§10: 3가지) | **미구현** | 현재 "담당자 > 태스크" 방식 1가지만 존재 |
| Team Board 필터 확장 | **불완전** | priority/type/지연/순서미지정 필터 미구현 |
| 비가용일 관리 UI | **미구현** | |
| Warning 표시 UI | **미구현** | |
| Baseline UI | **미구현** | |
| drag & drop 담당자 큐 | **미구현** | Team Board에 순서 변경 UI 없음 |

---

## 3. 갭 항목별 상세 분석

### GAP-A: 비가용일 (§4) - 미구현

**요구사항**: 국가공휴일, 회사 공통 휴무일, 개인 휴무를 비가용일로 처리

**현재 코드 상태**:
- `BusinessDayCalculator.isBusinessDay()`는 토/일만 제외
- 공휴일/회사휴일/개인휴무를 고려하는 엔티티 없음

**필요 작업**:
1. `Holiday` 엔티티 신규 생성 (공휴일 + 회사 공통 휴무일)
2. `MemberLeave` 엔티티 신규 생성 (개인 휴무)
3. `BusinessDayCalculator.isBusinessDay(LocalDate, Long memberId)` 오버로드 — 비가용일 목록을 주입받아 판단
4. `calculateEndDate()` 메서드 시그니처 확장 또는 별도 메서드 추가
5. 스케줄 계산 시 비가용일 반영 (TaskService 수정)
6. Holiday CRUD API + UI
7. MemberLeave CRUD API + UI

**영향 범위**: `BusinessDayCalculator`, `TaskService`, `AssigneeOrderService`

---

### GAP-B: 조회 정렬 뷰 3가지 (§10) - 미구현

**요구사항**:
1. 프로젝트 > 태스크 > 담당자 (현재 간트차트)
2. 프로젝트 > 담당자 > 태스크 (미구현)
3. 담당자 > 프로젝트 > 태스크 (현재 Team Board와 유사하나 다름)

**현재 코드 상태**:
- 간트차트: 프로젝트 단위, 도메인시스템 > 태스크 그룹핑 (§10의 정렬 1번과 부분 일치)
- Team Board: 전체 > 담당자 > 태스크 (프로젝트 구분 없음)

**필요 작업**:
1. Team Board에 뷰 모드 전환 버튼 추가 (3가지 정렬 뷰)
2. 뷰 모드 2: "프로젝트 > 담당자 > 태스크" 렌더링 로직 — 기존 API 데이터 재조합 (백엔드 변경 최소화)
3. 뷰 모드 3: "담당자 > 프로젝트 > 태스크" 렌더링 로직 — 현재 Team Board 구조와 유사, 프로젝트 내 그룹핑 추가

**영향 범위**: `app.js`, Team Board 섹션 HTML

---

### GAP-C: 간트차트 고급 기능 (§11) - 미구현

**요구사항**: 오늘 표시, 접기/펼치기, 의존성 화살표, 마감선

**현재 코드 상태**:
- `renderGantt()` 함수에서 frappe-gantt 초기화 시 `dependencies` 필드 전달 (`task-{id}` 형식)
- frappe-gantt 라이브러리가 의존성 화살표를 일부 지원하나, 동작 확인 필요
- 오늘 표시(수직선 마커), 마감선, 접기/펼치기는 커스텀 구현 필요; `today_button` 옵션은 뷰 이동 버튼이며 수직선이 아님

**필요 작업**:
1. **오늘 표시**: 간트 차트 렌더링 후 오늘 날짜 위치에 수직선(CSS/SVG) 삽입
2. **마감선**: 프로젝트 deadline 날짜 위치에 수직선 삽입 (빨간색 구분)
3. **접기/펼치기**: 도메인시스템 그룹 단위로 태스크 행 토글 (CSS display 제어)
4. **의존성 화살표**: frappe-gantt의 `dependencies` 필드 동작 검증; 미동작 시 SVG 오버레이 방식 커스텀 구현 검토

**영향 범위**: `app.js (renderGantt)`, `styles.css`

---

### GAP-D: Warning 시스템 (§12) - 전체 미구현

**요구사항**: 8가지 경고
1. 순서 미지정 (assigneeOrder null)
2. 시작일 누락 (첫 번째 태스크의 startDate null)
3. 일정 충돌 (담당자 일정 겹침)
4. 의존성 문제 (순환 의존, 선행 태스크 미완료)
5. 마감 지연 (expectedEndDate > deadline)
6. orphan task (담당자 없는 SEQUENTIAL 태스크)
7. 의존성 제거된 태스크 (Hold/Cancelled 선행 태스크로 인해 의존관계 끊긴 태스크)
8. 비가용일 충돌 (태스크 기간 중 비가용일 포함)

**현재 코드 상태**:
- 경고 관련 엔티티, 서비스, API, UI 전혀 없음
- 프론트엔드에서 마감 지연 경고를 위한 `project-delay-warning` div가 HTML에 존재하나 로직 없음

**필요 작업**:
1. `WarningType` enum 신규 생성 (8가지)
2. `WarningService` 신규 생성: 프로젝트/담당자 단위 경고 탐지 로직
3. GET `/api/v1/projects/{id}/warnings` API 추가
4. GET `/api/v1/members/{id}/warnings` API 추가 (optional)
5. 간트차트 및 Team Board에 경고 배지/아이콘 표시 UI
6. Dashboard에 전체 경고 요약 표시

**영향 범위**: 신규 서비스 클래스, 컨트롤러, 프론트엔드 다수

---

### GAP-E: 필터 확장 (§13) - 불완전

**요구사항**: 9가지 필터 (프로젝트, 담당자, 상태, 중요도, 종류, 경고, 지연, 기간, 순서미지정)

**현재 코드 상태**:
- Team Board 필터: status(단일값), projectId, startDate/endDate (4가지; 담당자 필터 미구현)
- 미구현 필터: assigneeId(담당자), priority, type, warning(경고), 지연(isDelayed), 순서미지정(assigneeOrder IS NULL)
- 복수 상태 필터 미구현 (현재 단일 상태만)
- `TaskRepository.findAllForTeamBoard()` JPQL: status, projectId, 날짜만 지원

**필요 작업**:
1. `TeamBoardController`에 필터 파라미터 추가 (priority, type, 지연, 순서미지정)
2. `TeamBoardService.getTeamBoard()` 시그니처 확장
3. `TaskRepository` JPQL 쿼리 확장 또는 별도 동적 쿼리 (Specification 또는 파라미터 IS NULL 패턴)
4. Team Board HTML에 priority, type, 지연, 순서미지정 필터 UI 추가
5. 복수 상태 필터 지원 (status 멀티셀렉트)

**영향 범위**: `TeamBoardController`, `TeamBoardService`, `TaskRepository`, `app.js`, HTML

---

### GAP-F: Baseline 스냅샷 (§14) - 전체 미구현

**요구사항**: 스냅샷 저장, 변경 비교, 지연 추적, 순서 변경 추적

**현재 코드 상태**: 관련 코드 없음

**필요 작업**:
1. `BaselineSnapshot` 엔티티 신규 생성 (프로젝트 단위 JSON 스냅샷)
2. `BaselineTaskEntry` 엔티티 또는 JSON 직렬화 방식 선택
3. `BaselineService` 신규 생성: 스냅샷 저장/조회/비교 로직
4. POST `/api/v1/projects/{id}/baselines` API
5. GET `/api/v1/projects/{id}/baselines` API
6. GET `/api/v1/projects/{id}/baselines/{baselineId}/diff` API (현재 vs 스냅샷 비교)
7. UI: 간트차트 또는 별도 뷰에 baseline 비교 표시

**영향 범위**: 신규 엔티티, 서비스, 컨트롤러, 프론트엔드

---

### GAP-G: drag & drop 담당자 큐 (§5.4) - UI 미구현

**요구사항**: drag & drop 방식으로 담당자 기준 전체 큐 관리

**현재 코드 상태**:
- 백엔드: `AssigneeOrderService.reorderTasks()` 구현 완료
- 백엔드: `PATCH /api/v1/tasks/assignee-order` (TaskController, `reorderAssigneeTasks()`) 구현 완료
- 프론트엔드: Team Board에 순서 변경 UI 없음, drag & drop 미구현

**필요 작업**:
1. Team Board의 담당자별 태스크 목록에 drag & drop 기능 추가
2. HTML5 Drag & Drop API 또는 외부 라이브러리 (SortableJS 등) 활용
3. 순서 변경 후 PUT 호출 + 날짜 재계산 트리거

**영향 범위**: `app.js`, Team Board HTML

---

### GAP-H: 조회/편집 분리 (§10 원칙) - 부분 미구현

**요구사항**: 조회 모드와 편집 모드를 분리

**현재 코드 상태**:
- 간트차트: 태스크 클릭 시 상세 팝업(조회) → 수정 버튼 클릭 시 편집 모달 전환 (분리됨)
- Team Board: 태스크 클릭 시 상세 팝업(조회) → 수정 버튼 클릭 시 편집 모달 전환 (분리됨)
- 현재 구현이 조회/편집 분리 원칙을 대체로 준수하고 있음

**판정**: 기본 분리는 구현됨. 다만 편집 모달에서 조회 전용 필드(계산된 날짜 등)를 명확히 읽기 전용으로 표시하는 부분은 부분적으로 구현됨 (readonly 속성 적용 있음).

**추가 작업**: 없거나 최소 (현재 구조 유지)

---

### GAP-I: BusinessDayCalculator 공휴일 파라미터 미지원 (§4 연동 이슈)

**현재 코드 상태**:
```java
// 현재 isBusinessDay()는 토/일만 제외
public boolean isBusinessDay(LocalDate date) {
    DayOfWeek dow = date.getDayOfWeek();
    return dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY;
}
```

GAP-A(비가용일)와 연동: `Holiday` 및 `MemberLeave` 엔티티 구현 후 `BusinessDayCalculator`에 비가용일 목록을 파라미터로 받는 오버로드 메서드 추가 필요. 기존 메서드는 하위 호환 유지.

---

## 4. 우선순위 분류

### Priority 1: 핵심 스케줄링 정확도 영향

| 항목 | GAP | 난이도 | 이유 |
|------|-----|--------|------|
| 비가용일 (공휴일/회사휴일/개인휴가) | GAP-A | 높음 | 스케줄 계산의 정확도에 직접 영향 |
| Warning 시스템 | GAP-D | 중간 | 리스크 탐지 핵심 기능 |
| 필터 확장 | GAP-E | 낮음 | UX 향상, 기존 구조에 추가만 |

### Priority 2: UX 및 가시성 향상

| 항목 | GAP | 난이도 | 이유 |
|------|-----|--------|------|
| 조회 뷰 3가지 | GAP-B | 낮음 | 기존 데이터 재조합 수준 |
| 간트차트 고급 기능 | GAP-C | 중간 | 오늘/마감선 커스텀 렌더링 |
| drag & drop 담당자 큐 | GAP-G | 중간 | 백엔드 완료, UI만 구현 |

### Priority 3: 장기 기능

| 항목 | GAP | 난이도 | 이유 |
|------|-----|--------|------|
| Baseline 스냅샷 | GAP-F | 높음 | 신규 엔티티 + 비교 로직 복잡 |

---

## 5. 구현 계획

### Phase 2-A: 비가용일 (GAP-A + GAP-I)

#### 5.1 데이터 모델

**신규 엔티티 1: `Holiday`**
```
holiday
  id          BIGINT PK
  date        DATE NOT NULL
  name        VARCHAR(100) NOT NULL
  type        VARCHAR(20) NOT NULL  -- NATIONAL(국가공휴일), COMPANY(회사휴무)
  created_at  TIMESTAMP NOT NULL
  updated_at  TIMESTAMP
```

**신규 엔티티 2: `MemberLeave`**
```
member_leave
  id          BIGINT PK
  member_id   BIGINT FK(member)
  date        DATE NOT NULL
  reason      VARCHAR(200)
  created_at  TIMESTAMP NOT NULL
  updated_at  TIMESTAMP
```

#### 5.2 서비스 수정

- `BusinessDayCalculator` 수정 (**§7.1 권고 방식 채택**):
  - Repository 직접 주입 대신, 호출 측(TaskService)에서 비가용일 목록을 미리 조회하여 파라미터로 전달
  - `isBusinessDay(LocalDate date, Set<LocalDate> unavailableDates)` 오버로드 추가
  - `calculateEndDate(LocalDate start, BigDecimal manDays, BigDecimal capacity, Set<LocalDate> unavailableDates)` 오버로드 추가
  - 기존 파라미터 없는 메서드 (`isBusinessDay(LocalDate)`, `calculateEndDate(LocalDate, BigDecimal)`) 하위 호환 유지
  - Repository 직접 주입 방식(`isBusinessDay(LocalDate, Long memberId)`)은 캐싱 부담 및 단일 책임 원칙 위반으로 **채택하지 않음**

- `TaskService` 수정:
  - `calculateAutoStartDate()` 호출 전, 해당 기간의 공휴일+회사휴무 및 담당자 개인휴무를 `HolidayService`에서 조회
  - 조회한 `Set<LocalDate>` 를 `BusinessDayCalculator`에 전달

#### 5.3 API 설계

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/v1/holidays | 공휴일/회사휴무 목록 (연도/월 필터) |
| POST | /api/v1/holidays | 공휴일/회사휴무 등록 |
| DELETE | /api/v1/holidays/{id} | 삭제 |
| GET | /api/v1/members/{id}/leaves | 특정 멤버 개인 휴무 목록 |
| POST | /api/v1/members/{id}/leaves | 개인 휴무 등록 |
| DELETE | /api/v1/members/{id}/leaves/{leaveId} | 삭제 |

#### 5.4 작업 목록

| # | 작업 | 설명 |
|---|------|------|
| A-1 | Holiday 엔티티/Repository 생성 | `HolidayType` enum 포함 |
| A-2 | MemberLeave 엔티티/Repository 생성 | member FK |
| A-3 | HolidayService 생성 | CRUD |
| A-4 | BusinessDayCalculator 수정 | isBusinessDay() 오버로드 |
| A-5 | TaskService 수정 | calculateAutoStartDate()에 담당자 ID 전달 |
| A-6 | HolidayController 생성 | REST API |
| A-7 | MemberLeave API (MemberController 확장) | REST API |
| A-8 | UI: 사이드바에 "비가용일" 메뉴 추가 | 공휴일/회사휴무 관리 |
| A-9 | UI: 멤버 상세에서 개인 휴무 관리 | |

---

### Phase 2-B: Warning 시스템 (GAP-D)

#### 5.5 Warning 타입 정의

```java
public enum WarningType {
    UNORDERED_TASK,       // 순서 미지정 (assigneeOrder null)
    MISSING_START_DATE,   // 시작일 누락 (첫 태스크 startDate null)
    SCHEDULE_CONFLICT,    // 일정 충돌 (담당자 일정 겹침)
    DEPENDENCY_ISSUE,     // 의존성 문제 (순환 또는 미완료 선행)
    DEADLINE_EXCEEDED,    // 마감 지연 (expectedEndDate > deadline)
    ORPHAN_TASK,          // orphan task (담당자 없는 SEQUENTIAL 태스크)
    DEPENDENCY_REMOVED,   // 의존성 제거된 태스크 (Hold/Cancelled 선행)
    UNAVAILABLE_DATE      // 비가용일 충돌 (GAP-A 구현 후 활성화)
}
```

#### 5.6 WarningService 주요 메서드

```java
// 프로젝트 단위 경고 탐지
List<WarningDto> detectProjectWarnings(Long projectId)

// 담당자 단위 경고 탐지
List<WarningDto> detectMemberWarnings(Long memberId)
```

#### 5.7 API 설계

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/v1/projects/{id}/warnings | 프로젝트 경고 목록 |
| GET | /api/v1/warnings/summary | 전체 경고 요약 (Dashboard용) |

#### 5.8 작업 목록

| # | 작업 | 설명 |
|---|------|------|
| D-1 | WarningType enum 생성 | 8가지 |
| D-2 | WarningDto 생성 | type, taskId, taskName, message 포함 |
| D-3 | WarningService 생성 | 각 타입별 탐지 로직 |
| D-4 | WarningController 생성 | REST API |
| D-5 | UI: 간트차트 태스크 바에 경고 아이콘 표시 | |
| D-6 | UI: Team Board 태스크 행에 경고 배지 표시 | |
| D-7 | UI: Dashboard 경고 요약 카드 추가 | |

---

### Phase 2-C: 필터 확장 (GAP-E)

#### 5.9 TeamBoard 필터 확장

추가할 필터 파라미터:
- `assigneeId`: Long (담당자 필터 — 현재 미구현, TeamBoardController에 파라미터 없음)
- `priority`: TaskPriority (단일값)
- `type`: TaskType (단일값)
- `isDelayed`: Boolean — 태스크 단위 지연 여부. 태스크에는 deadline이 없으므로 **`t.endDate < CURRENT_DATE AND t.status != COMPLETED`** 조건으로 판단한다. (프로젝트 단위 `isDelayed = expectedEndDate > deadline`과 구분)
- `unordered`: Boolean (assigneeOrder IS NULL)
- `warning`: Boolean (경고 있는 태스크 필터 — GAP-D Warning 시스템 구현 후 활성화 가능)

`TaskRepository.findAllForTeamBoard()` JPQL 확장 방식:
- 기존 `(:param IS NULL OR t.field = :param)` 패턴 적용
- `assigneeId`: `(:assigneeId IS NULL OR t.assignee.id = :assigneeId)`
- `unordered`: `(:unordered IS NULL OR (:unordered = true AND t.assigneeOrder IS NULL))`
- `isDelayed`: `(:isDelayed IS NULL OR (:isDelayed = true AND t.endDate < CURRENT_DATE AND t.status != com.timeline.domain.enums.TaskStatus.COMPLETED))`

#### 5.10 작업 목록

| # | 작업 | 설명 |
|---|------|------|
| E-1 | TeamBoardController 파라미터 추가 | assigneeId, priority, type, 지연, 순서미지정 |
| E-2 | TeamBoardService 시그니처 확장 | |
| E-3 | TaskRepository JPQL 확장 | 필터 조건 추가 |
| E-4 | HTML: 필터 UI 추가 | 5개 필터 폼 요소 (담당자 셀렉트 포함) |
| E-5 | app.js: 필터 수집/전송 로직 | `applyTeamBoardFilter()` 수정 |

---

### Phase 2-D: 간트차트 고급 기능 (GAP-C)

#### 5.11 오늘 표시 및 마감선

frappe-gantt의 `today_button` 옵션은 "오늘로 스크롤하는 버튼"을 제공할 뿐, 오늘 날짜 위치에 수직선 마커를 자동으로 그리지 않는다. 오늘 수직선은 커스텀 구현 필요.

구현 방식:
1. `renderGantt()` 후 `ganttInstance`의 SVG 컨테이너에 오늘 날짜 위치 계산
2. `<line>` 또는 `<rect>` SVG 요소를 CSS 클래스로 삽입
3. 프로젝트 `deadline`이 있는 경우 마감선 동일 방식 삽입

#### 5.12 접기/펼치기

도메인시스템 그룹 단위 접기/펼치기:
1. 간트차트 데이터에 그룹 헤더 행 추가 (frappe-gantt 미지원 → 대안 필요)
2. 현재 frappe-gantt는 그룹핑/접기 미지원 → 별도 접기/펼치기 구현 필요하거나 라이브러리 교체 검토

**권고사항**: frappe-gantt 한계로 인해, 그룹 접기/펼치기는 다음 중 선택:
- 옵션 A: DOM 조작으로 특정 태스크 행 숨김 (frappe-gantt 재렌더링 없이)
- 옵션 B: gantt 외부에 도메인시스템 목록 패널을 별도 구성하여 체크박스 방식

#### 5.13 작업 목록

| # | 작업 | 설명 |
|---|------|------|
| C-1 | 오늘 날짜 수직선 삽입 | SVG 오버레이 방식 |
| C-2 | 마감선 삽입 | 프로젝트 deadline 기준 |
| C-3 | 도메인시스템 그룹 접기/펼치기 | 옵션 A 또는 B 선택 |
| C-4 | 의존성 화살표 동작 검증 | frappe-gantt `dependencies` 필드 테스트 |

---

### Phase 2-E: drag & drop 담당자 큐 (GAP-G)

#### 5.14 작업 목록

| # | 작업 | 설명 |
|---|------|------|
| G-1 | SortableJS CDN 추가 | 또는 HTML5 기본 DnD API |
| G-2 | Team Board 담당자 카드에 drag handle 추가 | 태스크 행에 드래그 핸들 아이콘 |
| G-3 | 순서 변경 이벤트 핸들러 | 변경 후 PATCH /api/v1/tasks/assignee-order 호출 (body: `{assigneeId, taskIds}`) |
| G-4 | 날짜 재계산 결과 반영 | 재조회 후 UI 업데이트 |

---

### Phase 2-F: 조회 뷰 3가지 (GAP-B)

#### 5.15 작업 목록

| # | 작업 | 설명 |
|---|------|------|
| B-1 | Team Board에 뷰 모드 토글 버튼 추가 | 3가지 탭 또는 버튼 |
| B-2 | 뷰 모드 2 렌더링 함수 | 프로젝트 > 담당자 > 태스크 |
| B-3 | 뷰 모드 3 렌더링 함수 | 담당자 > 프로젝트 > 태스크 (현재 Team Board 확장) |

---

### Phase 2-G: Baseline 스냅샷 (GAP-F)

별도 Phase 3으로 분리하여 진행 권고.

---

## 6. 전체 작업 분해 및 구현 순서

### 6.1 권장 구현 순서

```
1. Phase 2-C: 필터 확장 (E-1~E-5)
   - 가장 낮은 난이도, 즉시 UX 개선

2. Phase 2-A: 비가용일 (A-1~A-9)
   - 스케줄링 정확도 핵심, Warning과 연동

3. Phase 2-B: Warning 시스템 (D-1~D-7)
   - GAP-A 완료 후 UNAVAILABLE_DATE 경고 활성화 가능

4. Phase 2-F: 조회 뷰 3가지 (B-1~B-3)
   - 프론트엔드만 변경, 빠른 구현

5. Phase 2-E: drag & drop 담당자 큐 (G-1~G-4)
   - 백엔드 완료, 프론트엔드 집중

6. Phase 2-D: 간트차트 고급 기능 (C-1~C-4)
   - frappe-gantt 한계 분석 후 접근법 결정

7. Phase 3: Baseline 스냅샷 (별도 계획서)
```

### 6.2 작업 분해 전체 목록

| # | ID | 작업 | 난이도 | 의존성 |
|---|-----|------|--------|--------|
| 1 | E-1 | TeamBoardController 파라미터 확장 | 낮음 | - |
| 2 | E-2 | TeamBoardService 시그니처 확장 | 낮음 | E-1 |
| 3 | E-3 | TaskRepository JPQL 확장 | 낮음 | E-2 |
| 4 | E-4 | Team Board 필터 UI 추가 (HTML) | 낮음 | - |
| 5 | E-5 | app.js 필터 수집/전송 수정 | 낮음 | E-4 |
| 6 | A-1 | Holiday 엔티티/Repository 생성 | 낮음 | - |
| 7 | A-2 | MemberLeave 엔티티/Repository 생성 | 낮음 | - |
| 8 | A-3 | HolidayService 생성 | 낮음 | A-1 |
| 9 | A-4 | BusinessDayCalculator 수정 | 중간 | A-1, A-2 |
| 10 | A-5 | TaskService 수정 (비가용일 Set 조회 후 전달) | 중간 | A-4 |
| 11 | A-6 | HolidayController 생성 | 낮음 | A-3 |
| 12 | A-7 | MemberLeave API 추가 | 낮음 | A-2 |
| 13 | A-8 | UI: 비가용일 관리 메뉴 | 중간 | A-6 |
| 14 | A-9 | UI: 멤버 개인 휴무 관리 | 중간 | A-7 |
| 15 | D-1 | WarningType enum 생성 | 낮음 | - |
| 16 | D-2 | WarningDto 생성 | 낮음 | D-1 |
| 17 | D-3 | WarningService 생성 | 높음 | A-1, A-2, D-1 |
| 18 | D-4 | WarningController 생성 | 낮음 | D-3 |
| 19 | D-5 | UI: 간트차트 경고 아이콘 | 중간 | D-4 |
| 20 | D-6 | UI: Team Board 경고 배지 | 중간 | D-4 |
| 21 | D-7 | UI: Dashboard 경고 요약 카드 | 중간 | D-4 |
| 22 | B-1 | Team Board 뷰 모드 토글 버튼 | 낮음 | - |
| 23 | B-2 | 뷰 모드 2 렌더링 함수 | 중간 | B-1 |
| 24 | B-3 | 뷰 모드 3 렌더링 함수 | 낮음 | B-1 |
| 25 | G-1 | SortableJS CDN 추가 | 낮음 | - |
| 26 | G-2 | Team Board drag handle 추가 | 낮음 | G-1 |
| 27 | G-3 | 순서 변경 이벤트 핸들러 | 중간 | G-2 |
| 28 | G-4 | 날짜 재계산 결과 반영 | 낮음 | G-3 |
| 29 | C-1 | 오늘 날짜 수직선 삽입 | 중간 | - |
| 30 | C-2 | 마감선 삽입 | 중간 | C-1 |
| 31 | C-3 | 도메인시스템 접기/펼치기 | 높음 | - |
| 32 | C-4 | 의존성 화살표 검증 | 중간 | - |

---

## 7. 리스크 및 고려사항

### 7.1 BusinessDayCalculator 수정 리스크

현재 `BusinessDayCalculator`는 상태가 없는(stateless) 컴포넌트다. 비가용일 지원을 위해 Repository를 직접 주입하면 단일 책임 원칙 위반 및 매 날짜 계산마다 DB 조회가 발생하므로, **§5.2 설계 방식을 채택한다**:

- **채택 방식**: `isBusinessDay(LocalDate date, Set<LocalDate> unavailableDates)` 파라미터 주입 방식. 호출 측(TaskService)에서 해당 계산 범위의 비가용일을 미리 조회하여 `Set<LocalDate>`로 전달.
- **기존 테스트 영향**: `BusinessDayCalculatorTest`가 존재하므로 기존 파라미터 없는 메서드 하위 호환 유지 필요.
- **Repository 직접 주입 방식 미채택**: `BusinessDayCalculator`에 `HolidayRepository`, `MemberLeaveRepository`를 주입하는 방식은 캐싱 부담 및 단일 책임 원칙 위반으로 사용하지 않는다.

### 7.2 frappe-gantt 라이브러리 한계

frappe-gantt는 그룹 헤더, 접기/펼치기, 커스텀 수직선을 기본 지원하지 않는다. 고급 기능 구현 시 다음 중 선택:

1. SVG/DOM 직접 조작 (단기 해결, 유지보수 어려움)
2. 라이브러리 교체 (dhtmlx-gantt, Vis.js Timeline 등) — 장기적으로 적합하나 대규모 리팩토링 필요

**권고**: 이번 Phase에서는 SVG 오버레이로 오늘/마감선만 구현하고, 접기/펼치기는 외부 패널(도메인시스템 체크박스) 방식으로 최소 구현.

### 7.3 Warning 시스템 성능

전체 프로젝트 경고 탐지는 모든 태스크를 순회하므로, 태스크 수가 많아질 경우 성능 이슈 발생 가능. 초기 구현 시 결과 캐싱 없이 On-Demand 계산 방식으로 시작하고, 필요 시 캐싱 레이어 추가.

---

## 8. 참고 파일 경로

| 파일 | 경로 |
|------|------|
| BusinessDayCalculator | `src/main/java/com/timeline/service/BusinessDayCalculator.java` |
| TaskService | `src/main/java/com/timeline/service/TaskService.java` |
| TeamBoardService | `src/main/java/com/timeline/service/TeamBoardService.java` |
| TeamBoardController | `src/main/java/com/timeline/controller/TeamBoardController.java` |
| AssigneeOrderService | `src/main/java/com/timeline/service/AssigneeOrderService.java` |
| TaskRepository | `src/main/java/com/timeline/domain/repository/TaskRepository.java` |
| Task 엔티티 | `src/main/java/com/timeline/domain/entity/Task.java` |
| Member 엔티티 | `src/main/java/com/timeline/domain/entity/Member.java` |
| Project 엔티티 | `src/main/java/com/timeline/domain/entity/Project.java` |
| 프론트엔드 JS | `src/main/resources/static/js/app.js` |
| 프론트엔드 HTML | `src/main/resources/static/index.html` |
| BusinessDayCalculatorTest | `src/test/java/com/timeline/service/BusinessDayCalculatorTest.java` |
