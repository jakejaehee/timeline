# 개발 계획서: 멤버 중복 배정 방지 강화 및 크로스 프로젝트 태스크 뷰

## 1. 개요

- **기능 설명**: 팀 내 여러 프로젝트에 걸쳐 동시에 진행되는 태스크들에 대해, 동일 멤버가 겹치는 기간에 두 개 이상의 태스크를 담당하지 못하도록 방지하고, 팀 전체 태스크 현황을 한 화면에서 조회할 수 있는 뷰를 제공한다.
- **개발 배경 및 목적**: 팀장이 여러 프로젝트에 걸쳐 인력을 배정할 때 발생하는 중복 배정 실수를 시스템으로 방지하고, 전체 프로젝트의 인력 현황을 한눈에 파악하여 효율적인 인력 계획을 수립할 수 있도록 지원한다.
- **작성일**: 2026-04-11

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 태스크 생성 및 수정 시, 담당자(assignee)가 동일한 기간에 다른 프로젝트 포함 어떤 태스크에도 배정되어 있지 않아야 한다.
- **FR-002**: 태스크 모달에서 담당자를 선택하는 시점에, 해당 멤버가 겹치는 기간에 이미 배정된 태스크 목록을 사전에 표시(미리보기)하여 팀장이 배정 전에 충돌 여부를 인지할 수 있어야 한다.
- **FR-003**: 담당자 충돌 발생 시, 백엔드에서 HTTP 409 Conflict와 함께 충돌 태스크 정보(프로젝트명, 태스크명, 기간)를 포함한 오류 메시지를 반환한다.
- **FR-004**: 프론트엔드에서 담당자 충돌 오류를 수신하면 사용자에게 명확한 오류 문구를 표시한다.
- **FR-005**: 사이드바에 "Team Board" 신규 메뉴를 추가하고, 전체 프로젝트의 태스크를 멤버별로 그룹핑하여 리스트 형태로 조회할 수 있는 화면을 제공한다.
- **FR-006**: Team Board에서 각 태스크 항목에 프로젝트명, 태스크명, 기간, 상태, 도메인 시스템을 표시한다.
- **FR-007**: Team Board에서 상태(PENDING / IN_PROGRESS / COMPLETED), 프로젝트, 기간 범위로 필터링할 수 있어야 한다.
- **FR-008**: Team Board에서 특정 태스크 클릭 시 해당 태스크의 상세 정보를 볼 수 있어야 한다.

### 2.2 비기능 요구사항

- **NFR-001**: Team Board 조회 API는 전체 태스크를 단일 쿼리 또는 최소한의 쿼리로 조회하여 N+1 문제를 방지한다.
- **NFR-002**: 담당자 충돌 검사는 기존 `findOverlappingTasks()` 쿼리를 재사용하여 크로스 프로젝트 범위까지 동작해야 한다 (현재 쿼리는 이미 프로젝트 구분 없이 전체 검색하므로 충돌 탐지 로직 변경 불필요, 오류 메시지에 프로젝트명 추가만 필요). 단, 현재 `findOverlappingTasks()` 쿼리에 `JOIN FETCH t.project`는 포함되어 있으나 `LEFT JOIN FETCH t.assignee`는 포함되어 있지 않으므로, 메시지 포맷 변경 시 `conflict.getProject().getName()` 호출만 추가하면 된다 (assignee 정보는 인자로 전달된 `Member` 객체를 사용).

### 2.3 가정 사항

- 멤버 중복 배정 기준은 "날짜 1일 이상 겹침"이며 기존 로직(`t.startDate <= :endDate AND t.endDate >= :startDate`)을 그대로 유지한다.
- Team Board는 읽기 전용 뷰이며, 해당 화면에서 태스크를 직접 편집하는 기능은 이번 범위에 포함하지 않는다 (상세 조회만 가능).
- 멤버가 프로젝트 멤버로 등록되지 않더라도, 태스크 담당자로 배정된 기록이 있으면 Team Board에 나타난다. 단, 필터 조건이 적용된 경우 필터를 통과하는 태스크가 없는 멤버는 목록에서 제외된다 (멤버 자체를 기준으로 필터링하는 것이 아니라, 태스크 조회 결과를 멤버별로 그룹핑하는 방식이므로).
- 현재 `validateAssigneeConflict()`는 프로젝트 범위 구분 없이 이미 전체 태스크를 대상으로 동작하고 있으므로, 백엔드 충돌 검사 로직 자체는 변경하지 않는다.

### 2.4 제외 범위 (Out of Scope)

- Team Board에서 간트차트 시각화 제공 (단순 리스트 뷰만 제공)
- 멤버별 workload(공수) 집계 및 시각화 차트
- 실시간 알림 (멤버 배정 충돌 발생 시 푸시 알림 등)
- 태스크 배정 시 멤버 자동 추천

---

## 3. 시스템 설계

### 3.1 데이터 모델

#### 신규 엔티티 없음

기존 엔티티를 그대로 활용한다.

| 엔티티 | 비고 |
|--------|------|
| `Task` | `assignee`, `project`, `domainSystem` 연관 포함 |
| `Member` | `name`, `role` 활용 |
| `Project` | `name` 활용 |
| `DomainSystem` | `name`, `color` 활용 |

#### 변경 사항

- `Task` 엔티티에 스키마 변경 없음.
- `AssigneeConflictException`의 메시지 포맷을 변경하여 프로젝트명을 포함시킨다.

  현재:
  ```
  {멤버명}님은 {startDate} ~ {endDate} 기간에 이미 '{taskName}' 태스크가 배정되어 있습니다.
  ```
  변경 후:
  ```
  {멤버명}님은 {startDate} ~ {endDate} 기간에 이미 [{projectName}] '{taskName}' 태스크가 배정되어 있습니다.
  ```

### 3.2 API 설계

#### 기존 API 변경

| Method | Endpoint | 변경 내용 |
|--------|----------|-----------|
| `POST` | `/api/v1/projects/{projectId}/tasks` | 충돌 오류 메시지에 프로젝트명 추가 (서비스 레이어 변경) |
| `PUT` | `/api/v1/tasks/{id}` | 충돌 오류 메시지에 프로젝트명 추가 (서비스 레이어 변경) |

#### 신규 API

| Method | Endpoint | 설명 | Request Params | Response |
|--------|----------|------|----------------|----------|
| `GET` | `/api/v1/team-board/tasks` | 전체 프로젝트 태스크를 멤버별 그룹핑하여 조회 | `status` (optional), `projectId` (optional), `startDate` (optional), `endDate` (optional) | `TeamBoardDto.Response` |
| `GET` | `/api/v1/members/{id}/tasks` | 특정 멤버의 배정 태스크 목록 조회 | - | `List<TeamBoardDto.TaskItem>` |

#### `/api/v1/team-board/tasks` Response 구조

```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": 1,
        "name": "홍길동",
        "role": "ENGINEER",
        "tasks": [
          {
            "id": 10,
            "name": "결제 API 개발",
            "projectId": 2,
            "projectName": "프로젝트 B",
            "domainSystemName": "결제 도메인",
            "domainSystemColor": "#4A90D9",
            "startDate": "2026-04-01",
            "endDate": "2026-04-15",
            "status": "IN_PROGRESS",
            "manDays": 10.0
          }
        ]
      }
    ],
    "unassigned": [
      {
        "id": 20,
        "name": "DB 설계",
        "projectId": 1,
        "projectName": "프로젝트 A",
        "domainSystemName": "공통 도메인",
        "domainSystemColor": "#27AE60",
        "startDate": "2026-04-10",
        "endDate": "2026-04-20",
        "status": "PENDING",
        "manDays": 5.0
      }
    ]
  }
}
```

#### `/api/v1/members/{id}/tasks` Response 구조

`TeamBoardDto.TaskItem`을 재사용한다. `TaskDto.Response`에는 `projectId` / `projectName` 필드가 없으므로, 해당 필드를 추가하는 대신 팀 보드용으로 설계된 `TeamBoardDto.TaskItem`을 공유하여 응답 구조를 통일한다.

```json
{
  "success": true,
  "data": [
    {
      "id": 10,
      "name": "결제 API 개발",
      "projectId": 2,
      "projectName": "프로젝트 B",
      "domainSystemName": "결제 도메인",
      "domainSystemColor": "#4A90D9",
      "startDate": "2026-04-01",
      "endDate": "2026-04-15",
      "status": "IN_PROGRESS",
      "manDays": 10.0
    }
  ]
}
```

### 3.3 서비스 계층

#### 변경: `TaskService.validateAssigneeConflict()`

```
현재: conflict.getName() 기반 메시지
변경: conflict.getProject().getName() + conflict.getName() 기반 메시지
```

충돌 Task 조회 쿼리(`findOverlappingTasks`)에 `JOIN FETCH t.project`가 이미 포함되어 있으므로 `conflict.getProject().getName()` 참조 시 추가 쿼리 없음. 담당자 이름은 메서드 인자로 전달된 `Member assignee` 객체에서 참조하므로 `assignee`에 대한 추가 쿼리도 불필요.

#### 신규: `TeamBoardService`

```
패키지: com.timeline.service.TeamBoardService

메서드:
- getTeamBoard(TeamBoardFilterDto filter): TeamBoardDto.Response
  - 전체 태스크를 단일 JPQL 쿼리로 조회 (project, domainSystem, assignee JOIN FETCH)
  - 필터(status, projectId, startDate, endDate) 적용
  - 담당자가 있는 태스크: memberId별 그룹핑
  - 담당자가 없는 태스크: unassigned 목록
  - 태스크 없는 멤버는 목록에서 제외 (현재 배정된 태스크가 있는 멤버만 표시)
```

#### 신규 Repository 쿼리: `TaskRepository`

`TaskRepository`에는 이미 `findByAssigneeIdWithDetails()` 메서드가 존재하므로, `/api/v1/members/{id}/tasks` 엔드포인트(T-06)는 해당 기존 메서드를 그대로 사용한다. Team Board 전체 조회용으로만 아래 신규 메서드를 추가한다.

```java
/**
 * 전체 태스크 조회 (팀 보드용) - 필터 조건 적용
 * - project, domainSystem, assignee JOIN FETCH
 * - 동적 필터: status, projectId, startDate/endDate 범위
 */
@Query("SELECT t FROM Task t " +
       "JOIN FETCH t.project " +
       "JOIN FETCH t.domainSystem " +
       "LEFT JOIN FETCH t.assignee " +
       "WHERE (:status IS NULL OR t.status = :status) " +
       "AND (:projectId IS NULL OR t.project.id = :projectId) " +
       "AND (:startDate IS NULL OR t.endDate >= :startDate) " +
       "AND (:endDate IS NULL OR t.startDate <= :endDate) " +
       "ORDER BY t.assignee.name ASC NULLS LAST, t.startDate ASC")
List<Task> findAllForTeamBoard(
    @Param("status") TaskStatus status,
    @Param("projectId") Long projectId,
    @Param("startDate") LocalDate startDate,
    @Param("endDate") LocalDate endDate
);
```

> 주의: JPQL에서 `@Param`에 `null`을 전달하면 `:param IS NULL` 조건이 참이 되어 필터가 비활성화된다. Spring Data JPA + JPQL 방식이므로 동적 쿼리가 필요하면 `@Query` 대신 `JpaSpecificationExecutor` 또는 `QueryDSL`을 사용한다. 현 프로젝트 컨벤션상 `@Query` + `IS NULL` 패턴을 우선 시도하고, 동작 이슈가 있으면 서비스 레이어에서 조건에 따라 별도 메서드를 분기 호출하는 방식으로 대체한다.

### 3.4 프론트엔드

#### 신규 섹션: Team Board

- **사이드바**: 기존 `AI Parser` 메뉴 아래에 "Team Board" 메뉴 항목 추가
  ```html
  <li>
      <a href="#" class="nav-link" data-section="team-board" onclick="showSection('team-board', this)">
          <i class="bi bi-kanban"></i> Team Board
      </a>
  </li>
  ```
- **섹션 ID**: `team-board-section`
- **레이아웃 구성**:
  - 상단: 필터 영역 (프로젝트 드롭다운, 상태 드롭다운, 기간 날짜 범위 입력, 조회 버튼)
  - 중단: 멤버별 태스크 카드 목록 (`accordion` 또는 카드 컴포넌트)
  - 하단: 담당자 미지정 태스크 섹션

#### Team Board 카드 UI 구조

```
[멤버명 (역할)] - n개 태스크
  ├── [프로젝트명] 태스크명    상태배지    시작일 ~ 종료일    nMD
  ├── [프로젝트명] 태스크명    상태배지    시작일 ~ 종료일    nMD
  └── ...

[담당자 미지정]
  ├── [프로젝트명] 태스크명    상태배지    시작일 ~ 종료일
  └── ...
```

#### 신규 JS 함수 (app.js 추가)

| 함수명 | 역할 |
|--------|------|
| `loadTeamBoard()` | Team Board 섹션 진입 시 초기 데이터 로드 |
| `applyTeamBoardFilter()` | 필터 변경 후 재조회 |
| `renderTeamBoard(data)` | 멤버별 그룹 HTML 생성 및 렌더링 |
| `showTeamBoardTaskDetail(taskId)` | 태스크 클릭 시 기존 `showTaskDetail()` 호출 |

#### 태스크 모달 담당자 충돌 사전 안내 (FR-002)

태스크 생성/수정 모달에서 담당자와 기간이 모두 입력된 상태에서 "저장" 버튼 클릭 전에, 해당 멤버의 배정 현황을 API로 조회하여 경고를 표시한다.

- 담당자 `<select>` 변경(`change`) 이벤트 또는 시작일/종료일 `<input>` 포커스 이탈(`blur`) 이벤트에서, 담당자와 시작일·종료일이 모두 입력된 경우에만 `/api/v1/members/{id}/tasks` 호출 (모두 입력되지 않은 경우 호출 생략)
- 반환된 태스크 중 날짜가 겹치는 것이 있으면 모달 내 경고 영역에 표시
  ```
  ⚠ 홍길동님은 [프로젝트 B] '결제 API 개발' (04/01 ~ 04/15) 태스크가 이미 배정되어 있습니다.
  ```
- 저장 자체는 막지 않음 (백엔드에서 최종 검증) — 단, 경고 표시로 사용자 인지 유도

### 3.5 기존 시스템 연동

| 영향 파일 | 변경 내용 |
|-----------|-----------|
| `TaskService.java` | `validateAssigneeConflict()` 메시지에 `conflict.getProject().getName()` 추가 |
| `TaskRepository.java` | `findAllForTeamBoard()` 쿼리 메서드 추가 |
| `index.html` | Team Board 섹션 HTML 추가, 사이드바 메뉴 추가 |
| `app.js` | Team Board 관련 함수 추가, `showSection()` switch 케이스 추가, 태스크 모달 충돌 미리보기 로직 추가 |

신규 파일:

| 파일 | 내용 |
|------|------|
| `com/timeline/controller/TeamBoardController.java` | Team Board API 컨트롤러 |
| `com/timeline/service/TeamBoardService.java` | Team Board 비즈니스 로직 |
| `com/timeline/dto/TeamBoardDto.java` | Team Board 요청/응답 DTO |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `TaskService` 충돌 메시지 개선 | `validateAssigneeConflict()`의 오류 메시지에 프로젝트명 포함 | 낮음 | - |
| T-02 | `TaskRepository` 팀보드 쿼리 추가 | `findAllForTeamBoard()` JPQL 메서드 추가 | 중간 | - |
| T-03 | `TeamBoardDto` 작성 | Response, TaskItem, MemberGroup, FilterRequest DTO 클래스 작성 | 낮음 | - |
| T-04 | `TeamBoardService` 구현 | 전체 태스크 조회 + 멤버별 그룹핑 로직 | 중간 | T-02, T-03 |
| T-05 | `TeamBoardController` 구현 | `GET /api/v1/team-board/tasks` 엔드포인트 | 낮음 | T-04 |
| T-06 | `GET /api/v1/members/{id}/tasks` 엔드포인트 추가 | `MemberController`에 담당 태스크 조회 엔드포인트 추가 (`TaskRepository.findByAssigneeIdWithDetails()` 기존 메서드 활용, 신규 쿼리 불필요) | 낮음 | - |
| T-07 | HTML Team Board 섹션 작성 | 필터 영역 + 멤버별 카드 영역 HTML | 중간 | T-05 |
| T-08 | JS Team Board 함수 구현 | `loadTeamBoard`, `renderTeamBoard`, `applyTeamBoardFilter` | 중간 | T-07 |
| T-09 | JS 태스크 모달 충돌 미리보기 | 담당자/기간 변경 시 배정 현황 조회 및 경고 표시 | 중간 | T-06 |
| T-10 | 사이드바 메뉴 추가 | HTML `index.html`에 Team Board nav-link 추가 | 낮음 | T-07 |
| T-11 | `showSection()` switch 케이스 추가 | `app.js`의 섹션 전환 로직에 `team-board` 케이스 추가 | 낮음 | T-08 |

### 4.2 구현 순서

1. **Step 1 - 백엔드 기반 작업**
   - T-01: `TaskService.validateAssigneeConflict()` 메시지에 프로젝트명 추가
   - T-02: `TaskRepository.findAllForTeamBoard()` 쿼리 추가
   - T-03: `TeamBoardDto` 클래스 작성

2. **Step 2 - 백엔드 서비스/컨트롤러**
   - T-04: `TeamBoardService` 구현
   - T-05: `TeamBoardController` 구현
   - T-06: `MemberController`에 `GET /api/v1/members/{id}/tasks` 추가 (기존 `TaskRepository.findByAssigneeIdWithDetails()` 활용)

3. **Step 3 - 프론트엔드 Team Board 화면**
   - T-10: 사이드바 메뉴 추가
   - T-07: `index.html` Team Board 섹션 HTML 작성
   - T-08: `app.js` Team Board JS 함수 구현
   - T-11: `showSection()` switch 케이스 추가

4. **Step 4 - 프론트엔드 태스크 모달 충돌 미리보기**
   - T-09: 태스크 모달에 충돌 사전 경고 로직 추가

### 4.3 테스트 계획

#### 단위 테스트 대상

- `TaskService.validateAssigneeConflict()`: 프로젝트명이 포함된 오류 메시지 포맷 검증
- `TeamBoardService.getTeamBoard()`: 멤버별 그룹핑 로직, 필터 적용 결과 검증, 담당자 미지정 태스크 분리 검증

#### 통합 테스트 시나리오

1. **크로스 프로젝트 충돌 방지 검증**
   - 멤버 A를 프로젝트 1의 태스크(4/1~4/10)에 배정
   - 동일 멤버 A를 프로젝트 2의 태스크(4/5~4/15)에 배정 시도
   - 기대 결과: HTTP 409, 메시지에 "[프로젝트 1] 태스크명" 포함 확인

2. **Team Board 조회 검증**
   - 여러 프로젝트, 여러 멤버, 미지정 태스크가 존재하는 상태에서 `GET /api/v1/team-board/tasks` 호출
   - 기대 결과: 멤버별 그룹핑 정상 동작, 미지정 태스크 별도 목록 확인

3. **Team Board 필터 검증**
   - status=IN_PROGRESS 필터 적용 시 해당 상태 태스크만 반환 확인
   - projectId 필터 적용 시 해당 프로젝트 태스크만 반환 확인

4. **UI 충돌 미리보기 검증**
   - 태스크 모달에서 담당자 선택 후 기간 변경 시 경고 메시지 표시 확인
   - 충돌 없는 기간으로 변경 시 경고 메시지 사라짐 확인

---

## 5. 리스크 및 고려사항

### 기술적 리스크

| 리스크 | 설명 | 대응 방안 |
|--------|------|-----------|
| JPQL `IS NULL` 동적 필터 | JPQL에서 `null` 파라미터에 대한 `IS NULL` 조건이 DB/방언에 따라 다르게 동작할 수 있음 | 동작 확인 후 문제 시 서비스 레이어에서 필터 조건별 메서드 분기 호출로 대체 |
| Team Board 대용량 데이터 | 태스크 수가 많아지면 단일 쿼리의 응답 크기가 커질 수 있음 | 현재 팀 규모(소수 멤버, 수십~수백 태스크)에서는 문제없으므로 페이지네이션은 향후 검토 |
| 태스크 모달 충돌 미리보기 API 호출 빈도 | 담당자/날짜 변경마다 API를 호출하면 불필요한 요청이 많아질 수 있음 | `blur` 이벤트(포커스 이탈) 기준으로 호출하거나, 담당자와 기간이 모두 입력된 경우에만 호출하여 요청 최소화 |

### 의존성 리스크

- 기존 `findOverlappingTasks()` 쿼리에 이미 `JOIN FETCH t.project`가 포함되어 있으므로, 메시지 변경만으로 프로젝트명(`conflict.getProject().getName()`)을 참조할 수 있음. 단, `LEFT JOIN FETCH t.assignee`는 해당 쿼리에 포함되어 있지 않으며, 담당자 이름은 메서드 인자 `Member assignee`에서 직접 참조하므로 문제 없음. 만약 해당 쿼리를 수정한 적이 있다면 `JOIN FETCH t.project` 유지 여부를 사전 확인 필요.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 |
|------|------|
| 태스크 서비스 | `src/main/java/com/timeline/service/TaskService.java` |
| 태스크 레포지토리 | `src/main/java/com/timeline/domain/repository/TaskRepository.java` |
| 태스크 컨트롤러 | `src/main/java/com/timeline/controller/TaskController.java` |
| 멤버 컨트롤러 | `src/main/java/com/timeline/controller/MemberController.java` |
| 충돌 예외 | `src/main/java/com/timeline/exception/AssigneeConflictException.java` |
| 글로벌 예외 핸들러 | `src/main/java/com/timeline/exception/GlobalExceptionHandler.java` |
| 프론트엔드 JS | `src/main/resources/static/js/app.js` |
| HTML | `src/main/resources/static/index.html` |

### 현재 구현 현황 (변경 전 상태 메모)

- `TaskRepository.findOverlappingTasks()`: 이미 프로젝트 구분 없이 `assigneeId` 기준 전체 태스크를 조회하므로, 크로스 프로젝트 충돌 검사는 이미 백엔드에서 동작하고 있음.
- `TaskService.validateAssigneeConflict()`: 오류 메시지에 프로젝트명이 빠져있어 팀장이 어떤 프로젝트의 태스크와 충돌하는지 알기 어려움 — 이것이 이번 변경의 핵심 포인트.
- Team Board 기능은 전혀 구현되어 있지 않으며, 현재 대시보드는 프로젝트 단위 간트차트만 제공.
