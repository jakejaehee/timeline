# 개발 계획서: 공수 기반 날짜 자동 계산

## 1. 개요

### 기능 설명
현재는 태스크 생성/수정 시 시작일, 종료일, 공수(MD)를 모두 사용자가 직접 입력한다. 이를 변경하여, **각 담당자의 첫 번째 태스크에 시작일을 한 번만 입력**하면, 이후 동일 담당자의 태스크들은 의존관계와 공수를 기반으로 시작일/종료일이 자동 계산되도록 한다.

### 개발 배경 및 목적
- 수작업 날짜 입력 시 실수(겹침, 계산 오류) 가 빈번하게 발생함
- 담당자가 바뀌거나 공수가 변경될 때마다 후속 태스크 날짜를 일일이 수정해야 하는 불편이 있음
- 의존관계 기반 자동 날짜 계산으로 일정 관리 효율을 높임

### 작성일
2026-04-11

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 태스크 모달에서 "첫 번째 태스크 여부" 를 자동으로 판단한다.
  - 판단 기준: 해당 프로젝트 + 담당자 기준으로 선행 SEQUENTIAL 태스크가 존재하지 않는 경우 첫 번째 태스크로 간주
- **FR-002**: 첫 번째 태스크에는 시작일 + 공수(MD)를 입력한다.
  - 종료일은 `시작일 + 공수(주말 제외)` 로 자동 계산된다.
  - 사용자에게 종료일 필드를 읽기 전용(read-only)으로 보여준다.
- **FR-003**: 첫 번째 태스크가 아닌 태스크(후속 태스크)에는 공수(MD)만 입력한다.
  - 시작일 필드와 종료일 필드는 UI에 표시하지 않거나 읽기 전용으로 비활성화한다.
  - 시작일은 `모든 선행 태스크(의존관계)의 최대 종료일 다음 영업일` 로 자동 계산된다.
  - 의존관계가 없는 경우에는 `동일 담당자의 태스크 중 종료일(endDate)이 가장 늦은 태스크의 종료일 다음 영업일` 로 자동 계산된다.
  - 종료일은 `시작일 + 공수(주말 제외)` 로 자동 계산된다.
- **FR-004**: 태스크 저장(생성/수정) 시 서버에서 시작일과 종료일을 자동 계산하여 DB에 저장한다.
- **FR-005**: 담당자나 의존관계가 변경되면 해당 태스크와 그 **후속 태스크들의 날짜를 연쇄적으로 재계산**한다.
  - 재계산 대상: 같은 프로젝트 내, 수정된 태스크를 직·간접적으로 의존하는 모든 SEQUENTIAL 태스크
- **FR-006**: 공수(MD)가 소수점인 경우(예: 0.5MD) 올림하여 영업일 수를 계산한다 (기존 AiParsingService 로직 동일).
- **FR-007**: PARALLEL 모드 태스크는 자동 계산 대상에서 제외하고, 기존과 동일하게 시작일/종료일을 직접 입력받는다.
- **FR-008**: 태스크 모달에서 담당자 선택 또는 의존관계 선택 시, 예상 시작일/종료일을 프리뷰로 표시한다.

### 2.2 비기능 요구사항

- **NFR-001**: 연쇄 재계산은 프로젝트 내 모든 관련 태스크에 대해 단일 트랜잭션으로 완료되어야 한다.
- **NFR-002**: 순환 의존관계(A->B->A) 감지 로직을 유지하거나, 재계산 시 무한루프를 방지해야 한다.
- **NFR-003**: 영업일 계산 유틸리티는 `AiParsingService` 내부에 중복 구현되어 있으므로, 공통 유틸 클래스로 분리하여 재사용한다.

### 2.3 가정 사항

- 영업일 기준: 토요일, 일요일 제외. 공휴일은 이번 범위에서 제외한다.
- "첫 번째 태스크" 판단 기준은 프로젝트 + 담당자 범위로 한정한다 (전체 시스템이 아님).
- PARALLEL 모드 태스크는 자동 계산 로직에서 완전히 제외하며 기존 입력 방식을 유지한다.
- 재계산은 저장 시점(서버 사이드)에 수행하며, 클라이언트 프리뷰는 참고용이다.
- 기존에 DB에 저장된 태스크는 마이그레이션하지 않는다. 신규 저장/수정 시점부터 적용된다.

### 2.4 제외 범위 (Out of Scope)

- 공휴일 캘린더 연동
- 담당자별 근무 캘린더(휴가, 반차 등) 반영
- 다중 선행 태스크가 **서로 다른 담당자**의 태스크인 경우의 복잡한 일정 조율 (단순히 가장 늦은 종료일 기준으로 처리)
- 기존 데이터 일괄 재계산 배치

---

## 3. 시스템 설계

### 3.1 데이터 모델

엔티티 변경 없음. `Task` 엔티티의 `startDate`, `endDate`, `manDays` 필드를 그대로 사용한다.

**변경 사항 요약**

| 항목 | 현재 | 변경 후 |
|------|------|--------|
| `startDate` | 사용자 직접 입력, nullable=false | 자동 계산 저장 (SEQUENTIAL), 직접 입력 (PARALLEL 또는 첫 번째 태스크) |
| `endDate` | 사용자 직접 입력, nullable=false | 항상 자동 계산 저장 (SEQUENTIAL), 직접 입력 (PARALLEL) |
| `manDays` | 선택 입력 | SEQUENTIAL 태스크의 경우 필수 입력으로 변경 |

**첫 번째 태스크 판단 로직**

서버에서 요청 수신 시 아래 조건으로 판단한다.

```
해당 프로젝트 + 담당자 기준으로
현재 저장하려는 태스크를 제외하고
선행 SEQUENTIAL 태스크가 0건인 경우 → 첫 번째 태스크
```

즉, DB에 해당 담당자의 SEQUENTIAL 태스크가 없거나, 오직 현재 태스크만 존재하는 경우에 해당한다.

### 3.2 API 설계

#### 기존 API 동작 변경

기존 API 경로와 메서드는 유지한다. Request/Response DTO를 확장한다.

**POST /api/v1/projects/{projectId}/tasks (태스크 생성)**
**PUT /api/v1/tasks/{id} (태스크 수정)**

| 필드 | 현재 | 변경 후 |
|------|------|--------|
| `startDate` | 필수 | SEQUENTIAL + 첫 번째 태스크일 경우에만 필수, 나머지(후속 SEQUENTIAL 태스크)는 null 허용 |
| `endDate` | 필수 | SEQUENTIAL 모드(첫 번째/후속 모두)에서는 null 전송 — 서버에서 자동 계산. PARALLEL 모드에서만 필수 |
| `manDays` | 선택 | SEQUENTIAL 태스크의 경우 필수 |

**신규 API: 날짜 프리뷰 계산**

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/projects/{projectId}/tasks/preview-dates` | 공수/의존관계/담당자 기반으로 예상 시작일·종료일 계산 (DB 저장 없음) |

Request Body:
```json
{
  "assigneeId": 1,
  "manDays": 3.0,
  "dependsOnTaskIds": [10, 11],
  "excludeTaskId": null
}
```

Response:
```json
{
  "success": true,
  "data": {
    "startDate": "2026-04-14",
    "endDate": "2026-04-16",
    "isFirstTask": false
  }
}
```

#### 기존 API 검증 로직 변경

- **기존 `createTask`/`updateTask`의 `startDate == null` 예외 검증 제거**: 현재 서비스 코드에서 `startDate`가 null이면 즉시 예외를 던지므로, 이 검증을 SEQUENTIAL 자동 계산 모드에서는 건너뛰도록 조건 분기 수정이 필요하다.
- SEQUENTIAL 모드이고, `startDate`가 null인 경우 → 자동 계산 모드로 분기
- 자동 계산 모드에서는 `manDays` 필수 검증 추가
- 기존 `validateAssigneeConflict` 는 SEQUENTIAL 자동 계산 모드에서는 호출하지 않음 — 단, 타 프로젝트 태스크와의 겹침은 §5 R-005 참고

### 3.3 서비스 계층

#### 신규: BusinessDayCalculator (공통 유틸)

패키지: `com.timeline.service`

`AiParsingService` 내부의 영업일 계산 로직을 독립 컴포넌트로 추출한다.

```
BusinessDayCalculator (Spring @Component)
  - calculateEndDate(startDate, manDays): LocalDate
  - getNextBusinessDay(date): LocalDate
  - ensureBusinessDay(date): LocalDate
  - isBusinessDay(date): boolean
```

#### 변경: TaskService

**createTask / updateTask 메서드 수정**

1. `executionMode == SEQUENTIAL` 인 경우:
   - `startDate` 가 null이면 → `calculateAutoStartDate()` 호출
   - `startDate` 가 존재하면 → 첫 번째 태스크로 판단, 해당 값 사용
   - `endDate` 는 항상 `calculateEndDate(startDate, manDays)` 로 계산
   - `manDays` null 검증 추가
2. `executionMode == PARALLEL` 인 경우: 기존 로직 유지 (startDate, endDate 직접 입력)

**신규: calculateAutoStartDate(projectId, assigneeId, dependsOnTaskIds, excludeTaskId)**

- 선행 태스크들의 종료일 중 최댓값 조회 (`dependsOnTaskIds`가 비어 있으면 이 단계는 건너뜀)
- 동일 담당자의 프로젝트 내 SEQUENTIAL 태스크 중 종료일이 가장 늦은 태스크의 종료일 조회 (excludeTaskId 제외)
- 두 값 중 더 늦은 날짜를 후보 기준일로 결정
- 후보 기준일의 다음 날에 `ensureBusinessDay()`를 적용하여 최종 시작일 반환 (`getNextBusinessDay()`가 주말 보정을 포함하므로 별도 주말 조정 불필요)

**신규: recalculateDependentTasks(taskId)**

`createTask`/`updateTask`와 **동일한 `@Transactional` 내에서** 호출하여 NFR-001(단일 트랜잭션) 요건을 충족한다. 해당 태스크를 선행으로 가지는 모든 후속 SEQUENTIAL 태스크를 BFS/위상정렬로 순회하며 날짜를 재계산하고 일괄 저장한다.

```
처리 순서:
1. taskDependencyRepository에서 해당 taskId를 dependsOnTask로 가지는 TaskDependency 목록 조회
2. 각 후속 태스크에 대해 calculateAutoStartDate() 재실행
3. endDate = calculateEndDate(newStartDate, manDays)
4. 변경이 있으면 저장 후 재귀적으로 그 후속 태스크도 처리
5. 방문 추적(Set<Long>)으로 순환 방지
```

**신규: previewDates(projectId, assigneeId, manDays, dependsOnTaskIds, excludeTaskId)**

DB에 저장하지 않고 날짜만 계산하여 반환. 태스크 모달 프리뷰용.

### 3.4 프론트엔드

#### 태스크 모달 (index.html + app.js) 변경

**필드 표시 조건 변경**

| 조건 | 시작일 필드 | 종료일 필드 | 공수 필드 |
|------|-----------|-----------|---------|
| PARALLEL 모드 | 직접 입력 (필수) | 직접 입력 (필수) | 선택 입력 |
| SEQUENTIAL + 첫 번째 태스크 | 직접 입력 (필수) | 읽기 전용 (자동 계산 표시) | 직접 입력 (필수) |
| SEQUENTIAL + 후속 태스크 | 읽기 전용 (자동 계산 표시) | 읽기 전용 (자동 계산 표시) | 직접 입력 (필수) |

**첫 번째 태스크 여부 판단 방법**

모달 오픈 직후에는 담당자가 선택되지 않은 상태이므로, `isFirstTask` 판단은 담당자 선택(`assigneeId` 변경) 시점에 수행한다.

담당자가 선택되면 `/api/v1/projects/{projectId}/tasks/preview-dates` API를 `manDays=null`, `dependsOnTaskIds=[]` 로 호출하여 `isFirstTask` 값을 확인하고, 담당자 변경 시에도 재호출하여 UI를 동적으로 업데이트한다.

> `assigneeId`가 null인 상태(담당자 미선택)에서는 프리뷰 API를 호출하지 않으며, 시작일/종료일 필드는 빈 상태로 유지한다.

**예상 날짜 프리뷰 동작**

1. 담당자(assigneeId), 공수(manDays), 의존관계 체크박스 변경 시
2. 디바운스(500ms) 후 `/api/v1/projects/{projectId}/tasks/preview-dates` 호출
3. 응답 받은 `startDate`, `endDate` 를 읽기 전용 필드에 표시
4. 프리뷰 중임을 나타내는 안내 문구 표시 (예: "저장 시 자동 계산됩니다")

**실행 모드 선택 시 동작**

- SEQUENTIAL 선택 시: 담당자/의존관계 기반 프리뷰 모드로 전환
- PARALLEL 선택 시: 시작일/종료일 직접 입력 모드로 전환 (기존 방식)

**saveTask 함수 변경**

- SEQUENTIAL 모드에서 `endDate`는 항상 null (또는 body에서 제거) 로 전송 — 서버에서 자동 계산
- SEQUENTIAL + 첫 번째 태스크인 경우: `startDate` 포함하여 전송, `endDate`는 null
- SEQUENTIAL + 후속 태스크인 경우: `startDate`, `endDate` 모두 null (또는 body에서 제거)
- PARALLEL 모드인 경우: `startDate`, `endDate` 모두 기존과 동일하게 필수 전송
- `manDays`는 SEQUENTIAL 모드에서 필수 클라이언트 검증 추가 (빈 값이면 저장 불가 처리)

**담당자 충돌 경고 (checkAssigneeConflict)**

- SEQUENTIAL 자동 계산 모드에서는 클라이언트 충돌 경고 UI를 비활성화
- PARALLEL 모드에서는 기존 충돌 경고 유지

### 3.5 기존 시스템 연동

#### AiParsingService 연동

- `calculateEndDate`, `getNextBusinessDay`, `ensureBusinessDay`, `isBusinessDay` 메서드를 `BusinessDayCalculator` 로 추출
- `AiParsingService`는 `BusinessDayCalculator` 를 주입받아 사용하도록 변경
- `calculateStartDate` 로직도 `TaskService.calculateAutoStartDate` 와 통합 고려 (또는 공통 메서드로 위임)

#### 기존 AssigneeConflictException 처리

- SEQUENTIAL 자동 계산 모드에서는 날짜가 항상 자동으로 비겹치게 계산되므로, `validateAssigneeConflict` 를 호출하지 않음
- PARALLEL 모드에서는 기존과 동일하게 호출

#### 기존 TaskRepository 쿼리 추가

- 동일 담당자의 프로젝트 내 SEQUENTIAL 태스크 중 종료일이 가장 늦은 것 단건 조회 (excludeTaskId 제외)
- 반환 타입은 `Optional<Task>` (조회 결과 없을 수 있음)
- `@Query`에서 Enum 비교는 반드시 파라미터 바인딩을 사용해야 함 (JPQL 문자열 리터럴 비교는 동작하지 않음)

```java
// 메서드 시그니처 (TaskRepository)
@Query("SELECT t FROM Task t " +
        "JOIN FETCH t.project " +
        "WHERE t.assignee.id = :assigneeId " +
        "AND t.project.id = :projectId " +
        "AND t.executionMode = :sequentialMode " +
        "AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId) " +
        "ORDER BY t.endDate DESC")
List<Task> findLatestSequentialTaskByAssignee(
        @Param("assigneeId") Long assigneeId,
        @Param("projectId") Long projectId,
        @Param("sequentialMode") TaskExecutionMode sequentialMode,
        @Param("excludeTaskId") Long excludeTaskId);

// 호출 측에서 결과 목록의 첫 번째 요소를 Optional로 취득
// Optional<Task> latest = result.isEmpty() ? Optional.empty() : Optional.of(result.get(0));
// (또는 Pageable을 활용하여 LIMIT 1 처리)
```

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | BusinessDayCalculator 추출 | AiParsingService의 영업일 계산 로직을 @Component로 분리 | 낮음 | - |
| T2 | AiParsingService 리팩토링 | BusinessDayCalculator 주입 후 내부 메서드 대체 | 낮음 | T1 |
| T3 | TaskRepository 쿼리 추가 | 담당자별 최신 SEQUENTIAL 태스크 종료일 조회 쿼리 | 낮음 | - |
| T4 | TaskDto.Request 변경 | startDate, endDate nullable 처리 | 낮음 | - |
| T5 | TaskService 자동 계산 로직 구현 | calculateAutoStartDate, 생성/수정 분기 처리 | 높음 | T1, T3, T4 |
| T6 | recalculateDependentTasks 구현 | 후속 태스크 연쇄 재계산 (BFS, 순환 방지) | 높음 | T5 |
| T7 | previewDates API 구현 | 컨트롤러 + 서비스 신규 엔드포인트 | 중간 | T5 |
| T8 | HTML 모달 필드 조건부 표시 | 시작일/종료일 read-only 처리, 안내 문구 추가 | 중간 | - |
| T9 | app.js 모달 동적 동작 구현 | 담당자/의존관계 변경 시 프리뷰 API 호출, UI 갱신 | 높음 | T7, T8 |
| T10 | saveTask 함수 변경 | SEQUENTIAL 모드에서 날짜 제거 / 첫 번째 태스크 분기 처리 | 중간 | T9 |
| T11 | 기존 충돌 검증 조건 수정 | SEQUENTIAL 자동 계산 모드에서 검증 스킵 | 낮음 | T5 |
| T12 | 통합 테스트 | 생성/수정/연쇄 재계산 시나리오 검증 | 중간 | T6, T10 |

### 4.2 구현 순서

1. **Step 1 — 공통 유틸 분리 (T1, T2)**
   - `com.timeline.service.BusinessDayCalculator` 클래스 생성
   - `AiParsingService` 에서 해당 메서드 대체

2. **Step 2 — 저장소 및 DTO 준비 (T3, T4)**
   - `TaskRepository` 에 담당자별 최신 SEQUENTIAL 태스크 종료일 조회 쿼리 추가
   - `TaskDto.Request` 의 `startDate`, `endDate` 를 nullable 처리
   - `TaskService` 의 null 검증 분기 조건 추가

3. **Step 3 — 서버 자동 계산 로직 (T5, T6, T11)**
   - `TaskService.calculateAutoStartDate()` 구현
   - `createTask`, `updateTask` 에 SEQUENTIAL/PARALLEL 분기 적용
   - `recalculateDependentTasks()` BFS 구현
   - 기존 `validateAssigneeConflict` 호출 조건 수정

4. **Step 4 — 프리뷰 API (T7)**
   - `TaskController` 에 `POST /api/v1/projects/{projectId}/tasks/preview-dates` 추가
   - `TaskService.previewDates()` 구현

5. **Step 5 — 프론트엔드 (T8, T9, T10)**
   - `index.html` 모달 필드에 `readonly` 속성 토글 구조 추가
   - `app.js` 의 `openTaskModal`, `saveTask`, `checkAssigneeConflict` 수정
   - 프리뷰 API 호출 및 디바운스 처리
   - 실행 모드 변경 이벤트 핸들러 추가

6. **Step 6 — 검증 (T12)**
   - 첫 번째 태스크 생성 시나리오
   - 후속 태스크 생성 시나리오 (의존관계 있음/없음)
   - 태스크 수정 후 연쇄 재계산 시나리오
   - PARALLEL 태스크 기존 동작 유지 확인

### 4.3 테스트 계획

**단위 테스트 대상**

- `BusinessDayCalculator`
  - 평일 시작일 + N MD → 종료일 정확성
  - 금요일 시작 + 공수가 주말을 넘기는 경우
  - 소수점 공수(0.5, 1.5) 올림 처리
  - getNextBusinessDay: 금요일 → 월요일 반환
  - ensureBusinessDay: 토요일 입력 → 월요일 반환

- `TaskService.calculateAutoStartDate()`
  - 선행 태스크 종료일 기준 다음 영업일
  - 동일 담당자 직전 태스크 기준 다음 영업일
  - 두 조건 동시 존재 시 늦은 날짜 기준

**통합 테스트 시나리오**

| 시나리오 | 검증 항목 |
|----------|---------|
| 담당자 A의 첫 태스크 생성 (startDate + manDays) | endDate 자동 계산, DB 저장 확인 |
| 담당자 A의 두 번째 태스크 생성 (manDays만, 의존관계 없음) | startDate = 첫 태스크 endDate 다음 영업일 |
| 담당자 A의 세 번째 태스크 생성 (manDays + 의존관계 있음) | startDate = 의존 태스크 endDate 다음 영업일 (더 늦은 경우) |
| 첫 번째 태스크의 manDays 변경 | 후속 태스크 startDate/endDate 연쇄 재계산 확인 |
| PARALLEL 태스크 생성 | 자동 계산 없이 기존 직접 입력 유지 |
| 순환 의존관계 방지 | BFS 순환 감지 후 무한루프 없이 종료 |

---

## 5. 리스크 및 고려사항

### 기술적 리스크

**R-001: 연쇄 재계산 성능**
- 후속 태스크가 많은 경우 다수의 UPDATE 쿼리 발생
- 완화: 변경이 실제로 발생한 경우에만 저장 (`if (!newStartDate.equals(task.getStartDate()) || ...`) 조건부 저장으로 불필요한 쿼리 방지

**R-002: 첫 번째 태스크 판단의 프로젝트 간 독립성**
- "프로젝트 + 담당자" 기준으로 판단하므로, 동일 담당자가 다른 프로젝트에 태스크를 가지고 있어도 영향 없음
- Team Board에서 태스크를 수정할 때도 동일 기준 적용

**R-003: 기존 데이터와의 혼용**
- 기존에 수동 입력된 태스크들은 자동 계산이 적용되지 않은 상태
- 해당 태스크를 수정할 경우, SEQUENTIAL 모드이면 새 로직이 적용되어 날짜가 변경될 수 있음
- 완화: 수정 시 사용자에게 "날짜가 재계산됩니다" 안내 토스트 메시지 표시

**R-004: 프리뷰 API 호출 빈도**
- 담당자, 공수, 의존관계 변경 시마다 API 호출 발생
- 완화: 500ms 디바운스 처리

**R-005: SEQUENTIAL 자동 계산 모드에서의 타 프로젝트 충돌**
- 현재 `findOverlappingTasks` 쿼리는 프로젝트 범위를 제한하지 않아, 동일 담당자가 다른 프로젝트에서 동일 기간을 수행 중이어도 충돌 검증을 건너뜀
- SEQUENTIAL 자동 계산 모드에서 `validateAssigneeConflict`를 호출하지 않기로 결정했으므로, 타 프로젝트와의 날짜 겹침은 자동으로 감지되지 않음
- 완화: 이번 기능 범위에서는 허용하며, 팀 보드에서 담당자별 일정을 시각적으로 확인하여 수동 조율한다

### 의존성 리스크

- `AiParsingService` 리팩토링 중 기존 AI 파싱 기능이 회귀하지 않도록 주의
- `BusinessDayCalculator` 추출 후 `AiParsingService` 의 기존 동작 동일성 확인 필요

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 역할 |
|------|------|
| `src/main/java/com/timeline/domain/entity/Task.java` | 태스크 엔티티 (startDate, endDate, manDays, executionMode) |
| `src/main/java/com/timeline/domain/entity/TaskDependency.java` | 태스크 의존관계 엔티티 |
| `src/main/java/com/timeline/domain/enums/TaskExecutionMode.java` | SEQUENTIAL / PARALLEL 열거형 |
| `src/main/java/com/timeline/domain/repository/TaskRepository.java` | 태스크 저장소 (findOverlappingTasks 등) |
| `src/main/java/com/timeline/domain/repository/TaskDependencyRepository.java` | 의존관계 저장소 (findByDependsOnTaskIdWithTask 활용) |
| `src/main/java/com/timeline/dto/TaskDto.java` | 태스크 Request/Response DTO |
| `src/main/java/com/timeline/service/TaskService.java` | 태스크 CRUD + 충돌 검증 서비스 |
| `src/main/java/com/timeline/service/AiParsingService.java` | 영업일 계산 로직 원본 (L591~L643) |
| `src/main/java/com/timeline/controller/TaskController.java` | 태스크 REST API 컨트롤러 |
| `src/main/java/com/timeline/exception/AssigneeConflictException.java` | 담당자 충돌 예외 |
| `src/main/resources/static/index.html` | 태스크 모달 (L475~L567) |
| `src/main/resources/static/js/app.js` | openTaskModal, saveTask, checkAssigneeConflict 함수 |

### 재사용 가능한 기존 로직

- `AiParsingService.calculateEndDate()` (L595~L617): 공수 기반 종료일 계산 — BusinessDayCalculator로 이동
- `AiParsingService.getNextBusinessDay()` (L622~L625): 다음 영업일 반환 — BusinessDayCalculator로 이동
- `AiParsingService.ensureBusinessDay()` (L630~L635): 영업일 보정 — BusinessDayCalculator로 이동
- `AiParsingService.isBusinessDay()` (L640~L643): 영업일 판단 — BusinessDayCalculator로 이동
- `AiParsingService.calculateStartDate()` (L551~L586): 시작일 계산 로직 참고 — TaskService로 유사 구현
- `TaskDependencyRepository.findByDependsOnTaskIdWithTask()`: 후속 태스크 조회에 바로 활용 가능
