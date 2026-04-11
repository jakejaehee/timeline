# 개발 계획서: requirement.md 기반 전체 갭 분석 및 구현 로드맵

- 작성일: 2026-04-11
- 기준 커밋: bc43fff
- 기준 문서: `docs/requirement.md`

---

## 1. 개요

### 1.1 기능 설명

`docs/requirement.md`는 Backend Engineering Team의 Multi-Project Scheduling App 전체 요구사항을 정의한다. 현재 시스템은 기본 CRUD, 공수 기반 날짜 자동 계산, BFS 연쇄 재계산, Team Board, 간트차트 등을 구현하고 있으나, 요구사항의 상당 부분이 미구현 상태다.

본 계획서는 현재 코드베이스와 요구사항 사이의 갭을 항목별로 분석하고, Phase별 구현 로드맵을 제시한다.

### 1.2 현재 시스템 상태 요약

| 구성요소 | 현재 상태 |
|---------|---------|
| Task 엔티티 | `id, project, domainSystem, assignee, name, description, startDate, endDate, manDays, status(PENDING/IN_PROGRESS/COMPLETED), executionMode(SEQUENTIAL/PARALLEL), sortOrder` |
| Project 엔티티 | `id, name, type, description, startDate, endDate, status(PLANNING/IN_PROGRESS/COMPLETED/ON_HOLD)` |
| Member 엔티티 | `id, name, role, email, active` |
| 스케줄링 | SEQUENTIAL 모드: 공수 기반 endDate 자동 계산, BFS 연쇄 재계산 |
| BusinessDayCalculator | 토/일 제외 영업일 계산 (공휴일/회사휴일/개인휴가 미반영) |
| 의존관계 | TaskDependency 엔티티로 다중 선행 태스크 지원 |
| 뷰 | Gantt Chart (프로젝트 단위), Team Board (전체 담당자별) |
| 필터 | Team Board: status(단일값), projectId, 날짜 범위 (priority/type/복수 status 미지원) |

---

## 2. 갭 분석 (Gap Analysis)

### 2.1 GAP-01: Task 상태 미확장 (§8 Status)

**요구사항**: To do / In Progress / Done / **Hold** / **Cancelled**

**현재**: `PENDING / IN_PROGRESS / COMPLETED` (Hold, Cancelled 없음)

**갭**:
- `Hold`, `Cancelled` 상태 enum 값 추가 필요
- 상태명 정합성: 요구사항의 "To do" = PENDING, "Done" = COMPLETED (이름 불일치이나 기능적으로 동일)
- Hold/Cancelled 상태일 때 의존관계 스케줄링에서 제외하는 로직 필요 (§7)

---

### 2.2 GAP-02: Task Priority 미구현 (§8 Priority)

**요구사항**: P0, P1, P2, P3

**현재**: Task 엔티티에 priority 필드 없음

**갭**:
- `TaskPriority` enum 신규 생성: `P0, P1, P2, P3`
- Task 엔티티에 `priority` 컬럼 추가
- 필터, 정렬, UI 표시 필요

---

### 2.3 GAP-03: Task Type 미구현 (§8 Type)

**요구사항**: Feature / Design / Backend / Infra / QA / Release / Ops / Tech Debt

**현재**: Task 엔티티에 type 필드 없음 (Project에는 `ProjectType` 있음)

**갭**:
- `TaskType` enum 신규 생성: `FEATURE, DESIGN, BACKEND, INFRA, QA, RELEASE, OPS, TECH_DEBT`
- Task 엔티티에 `type` 컬럼 추가
- 필터, UI 표시 필요

---

### 2.4 GAP-04: Task Done 시 Actual End Date 미구현 (§8 Done Tasks)

**요구사항**: Done 상태 시 실제 완료일(`actualEndDate`)을 수동 입력해야 함

**현재**: Task 엔티티에 `actualEndDate` 필드 없음

**갭**:
- Task 엔티티에 `actual_end_date` 컬럼 추가 (nullable)
- status가 COMPLETED로 변경될 때 actualEndDate 입력 강제 또는 권장 처리
- 간트차트에서 예정 종료일 vs 실제 종료일 표시

---

### 2.5 GAP-05: Assignee Capacity 미구현 (§3 Assignee Capacity)

**요구사항**: 담당자별 하루 최대 투입 가능 MD(capacity, 0.5 또는 1.0). `actual_duration = MD / capacity`

**현재**: Member 엔티티에 capacity 필드 없음. BusinessDayCalculator는 단순히 MD를 영업일로 환산

**갭**:
- Member 엔티티에 `capacity DECIMAL(3,1)` 추가 (기본값 1.0)
- BusinessDayCalculator.calculateEndDate() 시그니처에 capacity 파라미터 추가
- `actual_duration = ceil(MD / capacity)` 영업일 수로 교체 (예: 1.0 MD / 0.5 capacity = 2일, 1.5 MD / 0.5 capacity = 3일)
  > 요구사항 §3.2는 수식을 `MD / capacity`로만 기술하나, 기존 BusinessDayCalculator의 올림 처리 방침(정수 영업일로 환산)을 유지하여 `ceil` 적용.
- 기존 SEQUENTIAL 날짜 계산, 연쇄 재계산(BFS) 로직 전체에 capacity 반영

---

### 2.6 GAP-06: Same-Day Rule 미구현 (§6.5 Same Day Rule)

**요구사항**:
- 선행 태스크가 full-day로 끝나면 → 다음 태스크는 다음 날 시작
- 선행 태스크가 fractional MD(0.5 등)로 끝나면 → 같은 날 시작 가능

**현재**: BusinessDayCalculator.getNextBusinessDay()는 항상 다음 영업일 반환 (same-day 로직 없음)

**갭**:
- Task 엔티티에 `fractionalEndDay` 여부 계산 로직 필요 (`MD % 1 != 0` 이면 fractional)
- `calculateAutoStartDate()`에서 선행 태스크의 MD가 fractional이면 선행 endDate 당일을 start 후보로 사용
- `BusinessDayCalculator`에 `isFractionalMd(BigDecimal md)` 유틸 메서드 추가

---

### 2.7 GAP-07: Assignee-scope Execution Order (전역 실행 큐) 미구현 (§5)

**요구사항**: 태스크 순서 = 담당자의 실행 큐 (프로젝트 단위가 아닌 담당자 단위 전역 큐)

**현재**: `sortOrder`가 Task 엔티티에 있으나 프로젝트 범위 정렬이며 담당자 단위 전역 실행 큐가 아님. `TaskRepository.findLatestSequentialTaskByAssignee()`도 `projectId`를 인자로 받아 동일 프로젝트 내 태스크만 참조하므로, 타 프로젝트의 담당자 태스크 일정은 고려되지 않음

**갭**:
- 담당자별 전역 `assigneeOrder` 컬럼 추가 또는 별도 `AssigneeTaskOrder` 엔티티 고려
- `calculateAutoStartDate()`: 동일 프로젝트가 아닌 전체 프로젝트의 담당자 태스크 중 선행 태스크 참조로 변경 → `findLatestSequentialTaskByAssignee()`에서 `projectId` 조건 제거하는 신규 쿼리 추가 필요 (기존 쿼리는 하위호환 유지)
- 태스크 순서 변경 API (드래그앤드롭): `PATCH /api/v1/tasks/assignee-order` 신규 추가 (§4.2 Phase 1 API 설계와 동일)
- "미정렬(unordered)" 태스크: `assigneeOrder`가 null인 경우로 정의

---

### 2.8 GAP-08: Project Deadline / Expected End Date / Delay Flag 미구현 (§9)

**요구사항**:
- `deadline`: 프로젝트 마감일 (사용자 입력)
- `expectedEndDate`: 현재 스케줄 기반 예상 완료일 (계산값)
- `delayFlag`: `expectedEndDate > deadline` 이면 true

**현재**: Project에 `endDate`만 있음. deadline/expectedEndDate/delayFlag 없음
> 참고: 기존 `endDate`는 "사용자가 계획한 프로젝트 종료일"로 사용 중이며, `deadline`과 의미가 사실상 동일함. 구현 시 `endDate`를 `deadline`으로 통합하거나, `endDate`는 계획일/`deadline`은 마감 기한으로 명확히 구분하는 결정 필요. 본 계획서는 `deadline`을 신규 컬럼으로 추가하는 방향으로 진행하며 `endDate`는 기존 호환성을 위해 유지.

**갭**:
- Project 엔티티에 `deadline DATE` 컬럼 추가
- `expectedEndDate`는 DB 컬럼으로 저장하지 않고 서비스 계층에서 동적 계산 (태스크 최대 endDate)
- `delayFlag`도 계산값으로 응답 DTO에 포함
- ProjectDto.Response에 `deadline`, `expectedEndDate`, `isDelayed` 필드 추가

---

### 2.9 GAP-09: Availability (공휴일/회사휴일/개인휴가) 미구현 (§4)

**요구사항**: 영업일 = 평일 - 공휴일 - 회사휴일 - 개인휴가

**현재**: BusinessDayCalculator는 토/일만 제외. 공휴일/회사휴일/개인휴가 전혀 미반영

**갭**:
- `Holiday` 엔티티: `date DATE, name VARCHAR, type(NATIONAL/COMPANY)` 신규 생성
- `MemberLeave` 엔티티: `member_id, date DATE, reason` 신규 생성
- BusinessDayCalculator를 인터페이스로 추상화하거나 Holiday/Leave 목록을 주입받아 계산
- 공휴일 관리 API: `GET/POST/DELETE /api/v1/holidays`
- 개인 휴가 관리 API: `GET/POST/DELETE /api/v1/members/{id}/leaves`
- 기존 날짜 계산 로직 전체 교체 필요 (Breaking Change)

---

### 2.10 GAP-10: Warning System 미구현 (§12)

**요구사항**: 다음 경고 항목 실시간 감지
1. 미정렬(unordered) 태스크 — `assigneeOrder == null`
2. 첫 번째 태스크 시작일 누락
3. 스케줄 충돌 (동일 담당자, 동일 날짜에 다중 full-day 태스크)
4. 의존관계 위반 (후행 시작일 < 선행 종료일)
5. 마감 위험 (expectedEndDate > deadline)
6. Orphan 태스크 (담당자도 없고 의존관계도 없는 태스크)
7. Hold/Cancelled로 의존관계가 무시된 태스크
8. Availability 충돌 (태스크 기간 내 담당자 공휴일/휴가 포함 — Phase 2, Availability 도입 후 활성화)

**현재**: 경고 시스템 전혀 없음. AssigneeConflictException으로 저장 시점 충돌 방지만 있음

**갭**:
- `WarningService` 신규 생성: 전체 경고 계산 로직
- `WarningDto.WarningItem`: `{taskId, type, message, severity}` DTO
- `GET /api/v1/warnings?projectId=&assigneeId=` API 신규
- 경고는 DB 저장하지 않고 요청 시 동적 계산
- 프론트엔드: 간트차트/Team Board에 경고 배지, 경고 필터

---

### 2.11 GAP-11: 필터 확장 미구현 (§13)

**요구사항**: Project, Assignee, Status, Priority, Type, Warning, Delayed, Date range, Unordered

**현재**: Team Board에서 status(단일값), projectId, 날짜 범위만 필터링. Priority/Type/Warning/Delayed/Unordered/Assignee(Team Board 내) 미지원

**갭**:
- Team Board 및 간트차트 뷰 API에 필터 파라미터 추가
  - `assigneeId`, `priority`, `type`, `hasWarning`, `isDelayed`, `isUnordered`
  - status 필터를 단일값에서 복수값(List) 지원으로 변경
- 백엔드: `TaskRepository`에 동적 쿼리 추가 (JPA Specification 또는 다중 파라미터 JPQL)
- 프론트엔드: 필터 UI 패널 추가

---

### 2.12 GAP-12: 3가지 정렬 뷰 모드 미구현 (§10)

**요구사항**:
1. Project > Task > Assignee
2. Project > Assignee > Task
3. Assignee > Project > Task

**현재**: 간트차트 = 프로젝트 단위 + 도메인시스템별 그룹핑 (Project > DomainSystem > Task). Team Board = 담당자별 그룹핑 (Assignee > Task)

**갭**:
- 모드 1(Project > Task > Assignee): 현재 간트차트는 DomainSystem 계층을 Task 상위에 두고 있어 도메인 시스템 계층 제거 또는 Task 레이어로 평탄화 필요
- 모드 2(Project > Assignee > Task): 현재 간트차트에 Assignee 그룹핑 레이어 신규 추가 필요
- 모드 3(Assignee > Project > Task): 현재 Team Board에 Project 하위 그룹핑 추가 필요
- 뷰 모드 파라미터를 받아 응답 구조를 동적으로 조합하는 API 또는 프론트엔드 재그룹핑 방식 결정 필요

---

### 2.13 GAP-13: 간트차트 기능 개선 (§11)

**요구사항**:
- Today marker
- Collapsible hierarchy (계층 축소)
- Dependency arrows (의존관계 화살표)
- Status 시각화 (색상 구분)
- Deadline marker
- Fractional MD bar (0.5 MD → 반폭 bar 또는 비례 표시)

**현재**: frappe-gantt 라이브러리 사용. 의존관계 없음, today marker 없음, fractional bar 없음

**갭**:
- frappe-gantt의 custom_popup_html, bar_corner_radius 등 커스터마이징 확인
- frappe-gantt가 의존관계 화살표 지원하나 데이터 형식 맞춰야 함
- Today marker: JS로 현재일 기준 선 그리기 (CSS + absolute 포지션 방식)
- Fractional MD: frappe-gantt는 지원 안 하므로 커스텀 렌더링 또는 툴팁으로 처리
- Deadline marker: Project deadline 날짜에 수직선 추가
- 계층 축소: frappe-gantt 미지원 → 직접 구현 or 라이브러리 교체 검토

---

### 2.14 GAP-14: Hold/Cancelled 시 의존관계 스케줄링 제외 (§7)

**요구사항**: Hold/Cancelled 상태의 태스크는 의존관계 계산에서 무시

**현재**: `calculateAutoStartDate()`가 선행 태스크 상태를 무시하고 endDate 그대로 사용

**갭**:
- `calculateAutoStartDate()`에서 선행 태스크 endDate 참조 전 상태 확인
- HOLD/CANCELLED 상태 태스크는 의존관계 max endDate 계산에서 제외
- BFS 재계산(`recalculateDependentTasks()`)에서도 동일 처리

---

### 2.15 GAP-15: Baseline 스냅샷 미구현 (§14)

**요구사항**: 스냅샷 저장, 변경 비교, 지연 추적, 순서 변경 추적

**현재**: 없음

**갭**:
- `Baseline` 엔티티: `id, project_id, name, created_at`
- `BaselineTask` 엔티티: 스냅샷 시점의 태스크 상태 저장 (비정규화 테이블)
- 비교 API: 현재 상태 vs 베이스라인 diff 반환
- Phase 3으로 분류

---

## 3. 요구사항 정리

### 3.1 기능 요구사항

- FR-001: `TaskStatus`에 `HOLD`, `CANCELLED` 추가
- FR-002: `Task` 엔티티에 `priority(P0-P3)` 필드 추가
- FR-003: `Task` 엔티티에 `type(TaskType enum)` 필드 추가
- FR-004: `Task` 엔티티에 `actualEndDate` 필드 추가 (Done 시 입력)
- FR-005: `Member` 엔티티에 `capacity(DECIMAL)` 필드 추가 (기본 1.0)
- FR-006: `Project` 엔티티에 `deadline` 필드 추가
- FR-007: `ProjectDto.Response`에 `expectedEndDate`, `isDelayed` 계산값 포함
- FR-008: 담당자 단위 전역 실행 큐 (`assigneeOrder`) 구현
- FR-009: Same-Day Rule 스케줄링 로직 구현
- FR-010: Hold/Cancelled 태스크를 의존관계 계산에서 제외
- FR-011: `WarningService` 및 경고 API 구현 (경고 타입 8가지, `AVAILABILITY_CONFLICT`는 Phase 2 Availability 도입 후 활성화)
- FR-012: 팀 보드 및 간트 데이터 필터 확장 (priority, type, warning, delayed, unordered)
- FR-013: 간트차트 Today marker, Deadline marker, Dependency arrows, Status 시각화 추가
- FR-014: `Holiday`, `MemberLeave` 엔티티 및 관리 API 구현
- FR-015: `BusinessDayCalculator`에 Availability(공휴일/휴가) 반영
- FR-016: Gantt 뷰 정렬 모드 3가지 지원
- FR-017: Baseline 스냅샷 저장/비교 기능 구현

### 3.2 비기능 요구사항

- NFR-001: 날짜 계산 변경 시 기존 SEQUENTIAL 태스크 데이터 마이그레이션 전략 필요
- NFR-002: `WarningService` 계산은 요청 시 동적 수행 (DB 저장 없음), 응답 시간 500ms 이내
- NFR-003: Availability 반영 시 기존 API 시그니처 하위호환 유지
- NFR-004: 담당자 전역 큐 변경은 기존 프로젝트 내 sortOrder와 병행 지원

### 3.3 가정 사항

- `executionMode(SEQUENTIAL/PARALLEL)` 모델은 요구사항의 "자동 계산 vs 직접 입력"과 동일 개념으로 간주
- capacity 미설정 멤버는 1.0으로 간주
- `sortOrder`(프로젝트 내)와 `assigneeOrder`(전역)는 병행 존재하되, 스케줄링은 `assigneeOrder` 기준으로 전환
- Baseline은 Phase 3에 배치 (현재 MVP에서 제외)

### 3.4 제외 범위 (Phase 3 이후)

- Baseline 스냅샷 저장/비교 (FR-017)
- 간트차트 라이브러리 교체 (계층 축소 지원 라이브러리)
- Assignee capacity 0.5 시 같은 날 2개 태스크 UI 표현 (fractional bar 완전 지원)

---

## 4. 시스템 설계

### 4.1 데이터 모델 변경

#### 4.1.1 Task 엔티티 변경

```
// 추가 컬럼
priority        VARCHAR(5)   NULL  -- P0/P1/P2/P3
type            VARCHAR(20)  NULL  -- FEATURE/DESIGN/BACKEND/...
actual_end_date DATE         NULL  -- Done 시 실제 완료일
assignee_order  INTEGER      NULL  -- 담당자 전역 실행 큐 순서 (null = unordered)
```

변경 컬럼:
```
status VARCHAR(20) -- 기존 PENDING/IN_PROGRESS/COMPLETED 값 유지 (enum 이름 변경 없음)
                   -- HOLD, CANCELLED 두 값만 신규 추가
```
> 참고: 요구사항의 "To do"는 기존 `PENDING`에 해당하며, 표시 레이블만 다를 뿐 enum 값 변경은 필요 없음.

> 주의: 현재 `Task.start_date`는 `NOT NULL` 제약이 걸려 있음 (`Task.java` L49: `@Column(name = "start_date", nullable = false)`). 미정렬(unordered) 태스크는 `startDate`를 null로 허용해야 하므로, Hibernate ddl-auto에 의해 스키마가 변경되도록 `nullable = true`로 수정 필요.

#### 4.1.2 Member 엔티티 변경

```
// 추가 컬럼
capacity DECIMAL(3,1) NOT NULL DEFAULT 1.0
```

#### 4.1.3 Project 엔티티 변경

```
// 추가 컬럼
deadline DATE NULL  -- 사용자가 지정한 마감일
```

`expectedEndDate`와 `isDelayed`는 서비스 계산값이므로 DB 컬럼 불필요.

#### 4.1.4 신규 엔티티: Holiday

```
holiday (
  id           BIGSERIAL PRIMARY KEY,
  date         DATE NOT NULL,
  name         VARCHAR(100) NOT NULL,
  type         VARCHAR(20) NOT NULL,  -- NATIONAL / COMPANY
  created_at   TIMESTAMP NOT NULL
)
```

#### 4.1.5 신규 엔티티: MemberLeave

```
member_leave (
  id           BIGSERIAL PRIMARY KEY,
  member_id    BIGINT NOT NULL REFERENCES member(id),
  date         DATE NOT NULL,
  reason       VARCHAR(200),
  created_at   TIMESTAMP NOT NULL,
  UNIQUE (member_id, date)
)
```

#### 4.1.6 신규 enum

```java
// com.timeline.domain.enums.TaskPriority
P0, P1, P2, P3

// com.timeline.domain.enums.TaskType
FEATURE, DESIGN, BACKEND, INFRA, QA, RELEASE, OPS, TECH_DEBT
```

`TaskStatus` 확장:
```java
// 기존 유지 + 추가
PENDING, IN_PROGRESS, COMPLETED, HOLD, CANCELLED
```

### 4.2 API 설계

#### Phase 1 신규/변경 API

| Method | Endpoint | 설명 | 변경 사항 |
|--------|----------|------|---------|
| PUT | `/api/v1/tasks/{id}` | 태스크 수정 | `priority`, `type`, `actualEndDate` 필드 추가 |
| POST | `/api/v1/projects/{id}/tasks` | 태스크 생성 | `priority`, `type` 필드 추가 |
| GET | `/api/v1/projects/{id}/tasks` | 간트 데이터 | response에 `priority`, `type`, `actualEndDate`, `assigneeOrder` 추가 |
| PUT | `/api/v1/projects/{id}` | 프로젝트 수정 | `deadline` 필드 추가 |
| GET | `/api/v1/projects/{id}` | 프로젝트 상세 | response에 `deadline`, `expectedEndDate`, `isDelayed` 추가 |
| PATCH | `/api/v1/tasks/assignee-order` | 담당자 실행 큐 순서 일괄 변경 | **신규** (요청 body: `{"assigneeId": Long, "taskIds": [Long, ...]}` — taskIds 순서가 assigneeOrder로 저장됨) |
| GET | `/api/v1/members/{id}` | 멤버 상세 | response에 `capacity` 추가 |
| PUT | `/api/v1/members/{id}` | 멤버 수정 | `capacity` 필드 추가 |

#### Phase 2 신규 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/warnings` | 전체 경고 조회 (`?projectId=&assigneeId=`) |
| GET | `/api/v1/team-board` | 팀 보드 (필터 파라미터 확장: `assigneeId`, `priority`, `type`, `hasWarning`, `isDelayed`, `isUnordered`, status 복수값 지원) |
| GET | `/api/v1/projects/{id}/tasks` | 간트 데이터 (필터 파라미터 확장: `assigneeId`, `priority`, `type`, `hasWarning`, `isDelayed`, `isUnordered`) |
| GET | `/api/v1/holidays` | 공휴일/회사휴일 목록 |
| POST | `/api/v1/holidays` | 공휴일/회사휴일 등록 |
| DELETE | `/api/v1/holidays/{id}` | 공휴일/회사휴일 삭제 |
| GET | `/api/v1/members/{id}/leaves` | 개인 휴가 목록 |
| POST | `/api/v1/members/{id}/leaves` | 개인 휴가 등록 |
| DELETE | `/api/v1/members/{id}/leaves/{leaveId}` | 개인 휴가 삭제 |

#### Phase 3 신규 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/projects/{id}/baselines` | 베이스라인 목록 |
| POST | `/api/v1/projects/{id}/baselines` | 베이스라인 스냅샷 저장 |
| GET | `/api/v1/projects/{id}/baselines/{baselineId}/diff` | 현재 vs 베이스라인 비교 |

### 4.3 서비스 계층 설계

#### 4.3.1 변경 서비스

**TaskService**
- `createTask()`, `updateTask()`: `priority`, `type`, `actualEndDate`, `assigneeOrder` 처리 추가
- `calculateAutoStartDate()`: 범위를 "전체 프로젝트"로 확장, Hold/Cancelled 상태 제외, Same-Day Rule 추가, capacity 반영
- `recalculateDependentTasks()` (BFS): Hold/Cancelled 상태 태스크 건너뜀, capacity 반영

**BusinessDayCalculator**
- `calculateEndDate(startDate, manDays, capacity)` 오버로드 추가
- `isFractionalMd(BigDecimal md)` 유틸 메서드 추가
- `isBusinessDay(date, holidaySet, leaveSet)` 오버로드 추가 (Availability 반영, Phase 2)

**ProjectService**
- `getProject()`, `getAllProjects()`: `expectedEndDate`(프로젝트 내 모든 태스크의 최대 endDate, SEQUENTIAL/PARALLEL 무관), `isDelayed`(`expectedEndDate > deadline`) 계산 포함

#### 4.3.2 신규 서비스

**WarningService** (Phase 2)
```
List<WarningDto.WarningItem> getWarnings(Long projectId, Long assigneeId)
```
- 경고 타입별 체크 로직:
  - `UNORDERED_TASK`: `assigneeOrder == null`
  - `MISSING_START_DATE`: 첫 태스크 `startDate == null`
  - `SCHEDULE_CONFLICT`: 동일 담당자, 동일 날짜, 복수 full-day 태스크
  - `DEPENDENCY_VIOLATION`: 후행 startDate < 선행 endDate
  - `DEADLINE_RISK`: `expectedEndDate > deadline`
  - `ORPHAN_TASK`: 담당자 없음 + 의존관계 없음
  - `DEPENDENCY_IGNORED`: 선행이 HOLD/CANCELLED인 의존관계 존재
  - `AVAILABILITY_CONFLICT`: 태스크 기간 내 담당자 공휴일/휴가 포함 (Phase 2, AvailabilityService 도입 후 활성화)

**AvailabilityService** (Phase 2)
```
Set<LocalDate> getNonWorkingDays(Long memberId, LocalDate from, LocalDate to)
boolean isAvailable(Long memberId, LocalDate date)
```

**AssigneeOrderService** (Phase 1)
```
void reorderTasks(Long assigneeId, List<Long> taskIdsSorted)
List<TaskDto.Response> getOrderedTasksByAssignee(Long assigneeId)
```

**BaselineService** (Phase 3)
```
BaselineDto.Response createBaseline(Long projectId, String name)
BaselineDto.DiffResponse compareBaseline(Long projectId, Long baselineId)
```

### 4.4 프론트엔드 변경

#### 4.4.1 태스크 모달 확장
- Priority 드롭다운 추가 (P0/P1/P2/P3, 색상 배지)
- Type 드롭다운 추가
- Status에 Hold/Cancelled 옵션 추가
- Done 선택 시 "실제 완료일" 날짜 입력 필드 표시

#### 4.4.2 프로젝트 모달/상세 확장
- Deadline 날짜 입력 필드 추가
- 예상 완료일(expectedEndDate), 지연 여부(isDelayed) 표시

#### 4.4.3 멤버 모달 확장
- Capacity 입력 (0.5 / 1.0 라디오 또는 셀렉트)

#### 4.4.4 간트차트 개선 (Phase 1/2)
- Today marker: 현재 날짜 수직선 (CSS absolute 오버레이)
- Deadline marker: 프로젝트 deadline 날짜 수직 점선
- Status 색상: PENDING=회색, IN_PROGRESS=파랑, COMPLETED=녹색, HOLD=주황, CANCELLED=적색
- Priority 배지: 태스크 bar 레이블 옆 P0/P1/P2/P3 표시
- Dependency arrows: frappe-gantt `dependencies` 필드 활용
- Fractional MD bar: Phase 1에서는 full-day rendering으로 fallback (요구사항 §11 허용), 비례 bar는 Phase 3 이후 (§3.4 제외 범위 참조)

#### 4.4.5 경고 UI (Phase 2)
- 사이드바 또는 간트차트 상단에 경고 카운트 배지
- 경고 항목 목록 패널 (클릭 시 해당 태스크로 스크롤)
- 간트차트 bar에 경고 아이콘 오버레이

#### 4.4.6 필터 패널 (Phase 2)
- 간트차트 및 Team Board 상단에 필터 바 추가
- Priority, Type, Status, Assignee, Warning, Delayed, Unordered 체크박스/셀렉트

#### 4.4.7 담당자 큐 관리 UI (Phase 1)
- Team Board에서 담당자별 태스크 드래그앤드롭 순서 변경
- 미정렬(assigneeOrder == null) 태스크 경고 표시 (노란 배경 또는 아이콘)

---

## 5. 구현 계획

### 5.1 Phase 1 — 핵심 속성 확장 및 스케줄링 정확도 향상

**목표**: 태스크/프로젝트/멤버 속성 확장, 스케줄링 정확도 개선, 담당자 전역 큐 도입

| # | 작업 | 대상 파일 | 예상 복잡도 | 의존성 |
|---|------|---------|------------|--------|
| 1-1 | `TaskStatus`에 HOLD/CANCELLED 추가 | `TaskStatus.java` | 낮음 | - |
| 1-2 | `TaskPriority` enum 신규 생성 | `TaskPriority.java` | 낮음 | - |
| 1-3 | `TaskType` enum 신규 생성 | `TaskType.java` | 낮음 | - |
| 1-4 | Task 엔티티에 priority/type/actualEndDate/assigneeOrder 추가 | `Task.java` | 낮음 | 1-1~1-3 |
| 1-5 | Member 엔티티에 capacity 추가 | `Member.java` | 낮음 | - |
| 1-6 | Project 엔티티에 deadline 추가 | `Project.java` | 낮음 | - |
| 1-7 | DTO 전체 업데이트 (Request/Response) | `TaskDto.java`, `ProjectDto.java`, `MemberDto.java`, `GanttDataDto.java`, `TeamBoardDto.java` | 중간 | 1-4~1-6 |
| 1-8 | BusinessDayCalculator: capacity 파라미터 오버로드, isFractionalMd() 추가 | `BusinessDayCalculator.java` | 중간 | 1-5 |
| 1-9 | TaskService: calculateAutoStartDate() capacity + Same-Day Rule + 전역 큐 + Hold/Cancelled 제외 반영 | `TaskService.java` | 높음 | 1-8 |
| 1-10 | TaskService: BFS recalculate Hold/Cancelled 상태 건너뛰기 추가 | `TaskService.java` | 중간 | 1-1 |
| 1-11 | TaskRepository: 담당자 전역(전 프로젝트) 최신 endDate 쿼리 추가 — `findLatestSequentialTaskByAssigneeGlobal(assigneeId, sequentialMode, excludeTaskId)` 신규 메서드 (기존 `findLatestSequentialTaskByAssignee(projectId 포함)`는 유지) | `TaskRepository.java` | 중간 | 1-4 |
| 1-12 | ProjectService: expectedEndDate, isDelayed 계산 추가 | `ProjectService.java` | 중간 | 1-6 |
| 1-13 | AssigneeOrderService + API 구현 | `AssigneeOrderService.java`, `TaskController.java` | 중간 | 1-4 |
| 1-14 | UI: 태스크 모달 Priority/Type/Hold/Cancelled/ActualEndDate 추가 | `app.js`, `index.html` | 중간 | 1-7 |
| 1-15 | UI: 프로젝트 모달 Deadline/expectedEndDate/isDelayed 추가 | `app.js`, `index.html` | 낮음 | 1-7 |
| 1-16 | UI: 멤버 모달 Capacity 추가 | `app.js`, `index.html` | 낮음 | 1-7 |
| 1-17 | UI: 담당자 큐 드래그앤드롭 순서 변경 (Team Board) | `app.js` | 높음 | 1-13 |
| 1-18 | UI: 간트차트 Today marker, Deadline marker, Status 색상 | `app.js`, `styles.css` | 중간 | 1-7 |
| 1-19 | UI: 간트차트 Dependency arrows (frappe-gantt dependencies 필드) | `app.js` | 중간 | 1-7 |

### 5.2 Phase 2 — Warning 시스템, 필터 확장, Availability

**목표**: 경고 감지, 고급 필터, 공휴일/휴가 관리

| # | 작업 | 대상 파일 | 예상 복잡도 | 의존성 |
|---|------|---------|------------|--------|
| 2-1 | Holiday, MemberLeave 엔티티 + Repository 생성 | 신규 entity/repository | 낮음 | - |
| 2-2 | AvailabilityService 구현 | 신규 `AvailabilityService.java` | 중간 | 2-1 |
| 2-3 | BusinessDayCalculator: Availability 반영 오버로드 | `BusinessDayCalculator.java` | 중간 | 2-2 |
| 2-4 | TaskService 전체: Availability 반영 날짜 계산으로 전환 | `TaskService.java` | 높음 | 2-3 |
| 2-5 | 공휴일/멤버 휴가 관리 Controller 구현 | 신규 `HolidayController.java`, `MemberLeaveController.java` | 중간 | 2-1 |
| 2-6 | WarningService 구현 (7가지 경고 타입) | 신규 `WarningService.java` | 높음 | Phase 1 완료 |
| 2-7 | 경고 API Controller 구현 | 신규 `WarningController.java` | 낮음 | 2-6 |
| 2-8 | TaskRepository: 필터 확장 (priority/type/hasWarning/isDelayed/isUnordered) | `TaskRepository.java` | 중간 | Phase 1 |
| 2-9 | TeamBoardService: 필터 파라미터 확장 | `TeamBoardService.java` | 중간 | 2-8 |
| 2-10 | UI: 공휴일/회사휴일 관리 화면 | `app.js`, `index.html` | 중간 | 2-5 |
| 2-11 | UI: 멤버 개인 휴가 관리 | `app.js` | 중간 | 2-5 |
| 2-12 | UI: 경고 패널 및 배지 | `app.js`, `index.html`, `styles.css` | 높음 | 2-7 |
| 2-13 | UI: 필터 패널 (Priority/Type/Warning/Delayed/Unordered) | `app.js`, `index.html` | 높음 | 2-9 |

### 5.3 Phase 3 — 뷰 모드, Baseline

**목표**: 3가지 정렬 뷰 모드, Baseline 스냅샷

| # | 작업 | 대상 파일 | 예상 복잡도 | 의존성 |
|---|------|---------|------------|--------|
| 3-1 | Baseline, BaselineTask 엔티티 + Repository | 신규 | 중간 | - |
| 3-2 | BaselineService 구현 | 신규 `BaselineService.java` | 높음 | Phase 1/2 완료 |
| 3-3 | Baseline Controller | 신규 `BaselineController.java` | 낮음 | 3-2 |
| 3-4 | 뷰 모드 API: 정렬 모드 파라미터 추가 또는 전용 엔드포인트 | `TaskController.java` or 신규 | 높음 | Phase 1 |
| 3-5 | UI: 뷰 모드 전환 탭/버튼 | `app.js`, `index.html` | 중간 | 3-4 |
| 3-6 | UI: Baseline 관리 화면 | `app.js`, `index.html` | 높음 | 3-3 |

### 5.4 구현 순서 (Phase 1 상세)

```
1. enum 추가 (TaskStatus, TaskPriority, TaskType)
2. 엔티티 변경 (Task, Member, Project)
3. DTO 전체 업데이트
4. Repository 쿼리 추가
5. BusinessDayCalculator 개선
6. TaskService 로직 개선 (calculateAutoStartDate, BFS)
7. AssigneeOrderService + API
8. ProjectService 개선
9. 프론트엔드 UI (태스크/프로젝트/멤버 모달)
10. 프론트엔드 간트차트 개선
11. 프론트엔드 Team Board 드래그앤드롭
```

---

## 6. 리스크 및 고려사항

### 6.1 스케줄링 로직 변경 Breaking Change

**리스크**: `calculateAutoStartDate()`를 전 프로젝트 범위로 확장하면 기존 동작이 달라짐. 기존 태스크 날짜가 재계산으로 변경될 수 있음.

**완화**: 기존 sortOrder 기반 자동 계산은 유지하고, 새로운 `assigneeOrder` 기반 계산은 opt-in 방식으로 단계적 전환. 기존 태스크의 `assigneeOrder`는 null로 초기화 (unordered 상태). 전환 후 `calculateAutoStartDate()`의 fallback 동작(선행/담당자 태스크 없을 경우 오늘 기준 다음 영업일 반환)은 유지됨 — 단, 전역 큐 활성화 시에는 담당자의 타 프로젝트 태스크까지 조회하여 계산하므로 fallback이 실제로 발동되는 경우가 줄어듦.

### 6.2 Capacity 반영 시 기존 날짜 불일치

**리스크**: capacity 1.0이 기본값이므로 기존 태스크는 변경 없음. 그러나 capacity를 0.5로 변경 시 기존 태스크 endDate 불일치 발생.

**완화**: capacity 변경 시 해당 담당자의 모든 SEQUENTIAL 태스크 재계산 트리거 여부를 사용자에게 확인.

### 6.3 Availability 도입 시 날짜 계산 전면 교체

**리스크**: `isBusinessDay()` 로직 변경 시 기존 모든 날짜가 재계산되어야 함.

**완화**: Phase 2에서 별도 전환. 초기엔 Holiday/Leave를 "정보 표시"용으로만 활용하고, 날짜 계산 반영은 옵션으로 선택.

### 6.4 frappe-gantt 의존관계 화살표 한계

**리스크**: frappe-gantt의 `dependencies` 필드는 단순 순차 선행만 지원. 복수 선행(all predecessors) 화살표 표현이 불완전할 수 있음.

**완화**: frappe-gantt 소스 커스터마이징 또는 화살표를 SVG 오버레이로 직접 구현.

### 6.5 app.js 파일 크기

**리스크**: 현재 2,036줄. Phase 1~2 기능 추가 시 4,000~5,000줄 이상으로 증가 예상.

**완화**: 기능별 JS 파일 분리 고려 (gantt.js, team-board.js, warnings.js 등). HTML 버전 캐시 쿼리 파라미터 관리 필요.

---

## 7. 참고 사항

### 7.1 기존 코드 경로

| 항목 | 경로 |
|------|------|
| Task 엔티티 | `src/main/java/com/timeline/domain/entity/Task.java` |
| TaskStatus enum | `src/main/java/com/timeline/domain/enums/TaskStatus.java` |
| BusinessDayCalculator | `src/main/java/com/timeline/service/BusinessDayCalculator.java` |
| TaskService (스케줄링 핵심) | `src/main/java/com/timeline/service/TaskService.java` |
| TaskRepository (JPQL 쿼리) | `src/main/java/com/timeline/domain/repository/TaskRepository.java` |
| TaskDto (Request/Response) | `src/main/java/com/timeline/dto/TaskDto.java` |
| GanttDataDto | `src/main/java/com/timeline/dto/GanttDataDto.java` |
| TeamBoardDto | `src/main/java/com/timeline/dto/TeamBoardDto.java` |
| ProjectService | `src/main/java/com/timeline/service/ProjectService.java` |
| 프론트엔드 메인 JS | `src/main/resources/static/js/app.js` |

### 7.2 기존 개발 계획서 목록

| 파일 | 내용 |
|------|------|
| `docs/dev-plan/01-overview.md` | 전체 개요 |
| `docs/dev-plan/08-task-enhancements.md` | 태스크 링크, PARALLEL/SEQUENTIAL 모드 |
| `docs/dev-plan/09-auto-date-calculation.md` | 공수 기반 날짜 자동 계산, BFS 재계산 |

### 7.3 핵심 설계 결정 사항 요약

1. **담당자 전역 큐**: `assigneeOrder` 컬럼(Task 엔티티)으로 구현. null이면 미정렬 경고 대상.
2. **Same-Day Rule**: 선행 MD가 fractional이면 선행 endDate 당일을 start 후보로 사용. `BusinessDayCalculator.isFractionalMd()` 활용.
3. **Hold/Cancelled 제외**: `calculateAutoStartDate()`와 BFS에서 HOLD/CANCELLED 상태 태스크 skip.
4. **expectedEndDate**: DB 저장 안 하고 서비스에서 동적 계산 (프로젝트 내 모든 태스크의 최대 endDate, SEQUENTIAL/PARALLEL 무관).
5. **경고 시스템**: 요청 시 동적 계산. DB 저장 없음. 경고 타입 7가지.
6. **Availability**: Phase 2. Holiday/MemberLeave 엔티티로 관리. BusinessDayCalculator 오버로드 방식으로 기존 호환성 유지.
