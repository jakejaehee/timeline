# 개발 계획서: Jira Import 버그 수정 (상태 매핑 누락 + end_date NOT NULL)

## 1. 개요

### 기능 설명

Jira 이슈 가져오기(Import) 기능에서 발견된 두 가지 버그를 수정한다.

- **버그 1**: Jira 한글 상태명("완료", "진행 중" 등)이 STATUS_MAP에 없어 모두 TODO로 매핑됨
- **버그 2**: Jira `dueDate`가 null인 이슈를 Import할 때 `end_date NOT NULL` 제약 조건 위반으로 DB insert 실패

### 개발 배경 및 목적

Jira Cloud 인스턴스가 한국어로 설정된 환경에서 이슈를 가져오면, Jira API가 상태명을 한글로 반환한다. 현재 `STATUS_MAP`은 영문 상태명만 포함하고 있어 한글 상태가 모두 `TODO`로 잘못 매핑된다. 또한 `dueDate`가 없는 이슈는 `task.end_date`에 null이 들어가 DB 제약 조건을 위반하여 import가 중단된다.

### 작성일

2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: `STATUS_MAP`에 한글 Jira 상태명을 추가하여 한국어 Jira 인스턴스에서도 상태가 올바르게 매핑되어야 한다.
- **FR-002**: Jira `dueDate`가 null인 이슈를 import할 때 DB 오류 없이 처리되어야 한다.
- **FR-003**: `dueDate`가 null인 경우 import 자체는 정상 완료되며, 사용자가 나중에 직접 날짜를 입력할 수 있어야 한다.
- **FR-004**: `startDate`도 null일 수 있으므로 동일한 패턴으로 처리한다.
- **FR-005**: Preview 화면에서도 수정된 상태 매핑이 즉시 반영된다.

### 2.2 비기능 요구사항

- **NFR-001**: 기존 영문 STATUS_MAP 동작에 영향을 주지 않아야 한다.
- **NFR-002**: 날짜 fallback 처리는 명시적 로그를 남겨 추후 디버깅이 가능해야 한다.
- **NFR-003**: Task 엔티티 및 DB 스키마 변경 없이 애플리케이션 계층에서만 처리한다.

### 2.3 가정 사항

- Jira Cloud 한국어 설정 시 상태명은 "할 일", "진행 중", "완료" 등 표준 번역을 사용한다고 가정한다.
  - 실제 Jira Cloud 한국어 기본 워크플로 상태명을 기준으로 매핑 테이블을 구성한다.
- `docs/schema.sql`의 `start_date date NOT NULL`, `end_date date NOT NULL` 표기는 실제 DB의 현재 제약 조건을 반영하므로, 날짜가 없는 이슈는 오늘 날짜(`LocalDate.now()`)를 fallback으로 사용한다.
  - 사용자에게 빈 날짜로 import된 태스크가 오늘 날짜로 들어왔음을 ImportResult 로그나 `warnings` 필드로 알릴 수 있도록 확장 가능하게 구현한다.

### 2.4 제외 범위 (Out of Scope)

- Task 엔티티의 `startDate`, `endDate` 컬럼을 nullable로 변경하는 DB 스키마 마이그레이션 (별도 계획 필요)
- 커스텀 Jira 워크플로의 임의 상태명 매핑 (UI에서 직접 매핑 설정 기능)
- UPDATE 시 기존 날짜 보존 여부 정책 변경 (현재: Jira 값으로 덮어씀)

---

## 3. 시스템 설계

### 3.1 데이터 모델

엔티티 변경 없음. `docs/schema.sql` 변경 없음.

현재 DB 제약 조건 확인:
- `task.start_date date NOT NULL`
- `task.end_date date NOT NULL`

Task 엔티티(`Task.java`)의 `startDate`, `endDate` 필드는 `@Column(name = "start_date")` / `@Column(name = "end_date")`만 선언되어 있고 `nullable` 속성이 명시되지 않았다. Hibernate `@Column`의 `nullable` 기본값은 `true`(nullable 허용)이므로, Hibernate가 생성하는 DDL에서도 해당 컬럼은 nullable이다.

실제 NOT NULL 제약은 수동 관리되는 `docs/schema.sql`에만 `start_date date NOT NULL`, `end_date date NOT NULL`로 명시되어 있으며, 현재 운영 DB가 이 스키마로 생성되어 있으므로 null 삽입 시 DB 레벨에서 오류가 발생한다. 이번 수정에서는 엔티티를 변경하지 않고, import 서비스에서 null을 fallback 값으로 대체한다.

### 3.2 API 설계

API 엔드포인트 변경 없음. 내부 로직만 수정한다.

### 3.3 서비스 계층

#### 변경 대상 파일

`src/main/java/com/timeline/service/JiraImportService.java` 한 파일만 수정한다.

#### 버그 1 수정: 한글 상태명 추가

`STATUS_MAP`에 한글 Jira 상태명 항목을 추가한다.

Jira Cloud 한국어 기본 워크플로 상태명 매핑:

| Jira 한글 상태명 | 영문 원본 (참고) | Timeline TaskStatus |
|----------------|----------------|---------------------|
| 할 일 | To Do | TODO |
| 열려 있음 | Open | TODO |
| 백로그 | Backlog | TODO |
| 진행 중 | In Progress | IN_PROGRESS |
| 검토 중 | In Review | IN_PROGRESS |
| 완료 | Done | COMPLETED |
| 해결됨 | Resolved | COMPLETED |
| 닫힘 | Closed | COMPLETED |
| 보류 | On Hold | HOLD |
| 차단됨 | Blocked | HOLD |
| 취소됨 | Cancelled | CANCELLED |
| 하지 않음 | Won't Do | CANCELLED |

기존 `Map.ofEntries()`에 한글 항목을 추가한다. `mapStatus()` 메서드는 `jiraStatus.toLowerCase().trim()`을 적용한 값으로 `STATUS_MAP`을 조회한다. 한글 문자열에 `toLowerCase()`를 적용해도 원문과 동일하게 유지되므로, `STATUS_MAP`의 한글 키는 Jira API가 반환하는 상태명 그대로 등록하면 된다. `trim()`에 의해 앞뒤 공백은 제거된다.

#### 버그 2 수정: null 날짜 fallback 처리

`importIssues()` 내 CREATE/UPDATE 분기에서 `issue.getDueDate()` 및 `issue.getStartDate()`가 null인 경우를 처리하는 헬퍼 메서드를 추가한다.

```java
/**
 * Jira dueDate/startDate null 시 오늘 날짜로 fallback
 * (task.start_date, task.end_date 는 NOT NULL 제약)
 */
private LocalDate resolveDate(LocalDate date, String fieldName, String jiraKey) {
    if (date != null) return date;
    LocalDate today = LocalDate.now();
    log.warn("Jira 이슈 {} 의 {} 가 null이어서 오늘 날짜({})로 대체합니다.", jiraKey, fieldName, today);
    return today;
}
```

CREATE 분기 (현재 코드의 아래 두 라인을 교체):

AS-IS:
```java
.startDate(issue.getStartDate())
.endDate(issue.getDueDate())
```

TO-BE:
```java
.startDate(resolveDate(issue.getStartDate(), "startDate", issue.getKey()))
.endDate(resolveDate(issue.getDueDate(),   "endDate",   issue.getKey()))
```

UPDATE 분기 (현재 코드의 아래 두 라인을 교체):

AS-IS:
```java
existing.setStartDate(issue.getStartDate());
existing.setEndDate(issue.getDueDate());
```

TO-BE:
```java
existing.setStartDate(resolveDate(issue.getStartDate(), "startDate", issue.getKey()));
existing.setEndDate(resolveDate(issue.getDueDate(),   "endDate",   issue.getKey()));
```

### 3.4 프론트엔드

변경 없음. Preview 화면은 `mappedStatus` 필드를 표시하므로 백엔드 STATUS_MAP 수정만으로 즉시 반영된다.

### 3.5 기존 시스템 연동

영향 범위 최소화:
- `JiraApiClient`: 변경 없음. `parseLocalDate()`는 Jira 필드가 null이거나 파싱 실패 시 `null`을 반환하도록 null-safe하게 구현되어 있다. 이 null 값이 `JiraDto.JiraIssue.startDate` / `dueDate` 필드에 그대로 전달되고, `JiraImportService`가 이를 `Task` 엔티티에 설정할 때 DB NOT NULL 제약에 의해 버그가 발생한다.
- `JiraDto`: 변경 없음
- `TaskRepository`, `ProjectRepository`: 변경 없음
- `Task` 엔티티: 변경 없음
- `docs/schema.sql`: 변경 없음

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | STATUS_MAP 한글 항목 추가 | `JiraImportService.STATUS_MAP`에 12개 한글 상태명 항목 추가 | 낮음 | 없음 |
| T-02 | null 날짜 fallback 메서드 추가 | `resolveDate()` private 메서드 구현 | 낮음 | 없음 |
| T-03 | CREATE 분기 날짜 적용 | `Task.builder()`의 startDate, endDate에 `resolveDate()` 적용 | 낮음 | T-02 |
| T-04 | UPDATE 분기 날짜 적용 | `existing.setStartDate()`, `existing.setEndDate()`에 `resolveDate()` 적용 | 낮음 | T-02 |
| T-05 | 동작 확인 | 한글 상태 Jira 이슈 + dueDate null 이슈로 Preview/Import 테스트 | 낮음 | T-01, T-03, T-04 |

### 4.2 구현 순서

1. `JiraImportService.java`의 `STATUS_MAP` 상수에 한글 항목 추가 (T-01)
2. 같은 파일 하단 private 메서드 영역에 `resolveDate()` 추가 (T-02)
3. `importIssues()` 내 CREATE 분기의 `.startDate()`, `.endDate()` 라인 수정 (T-03)
4. `importIssues()` 내 UPDATE 분기의 `existing.setStartDate()`, `existing.setEndDate()` 라인 수정 (T-04)
5. 빌드 확인 후 테스트 (T-05)

### 4.3 테스트 계획

#### 버그 1 확인 시나리오

1. Jira 이슈의 상태가 "완료"인 경우 → Preview에서 `mappedStatus: "COMPLETED"` 확인
2. Jira 이슈의 상태가 "진행 중"인 경우 → Preview에서 `mappedStatus: "IN_PROGRESS"` 확인
3. Jira 이슈의 상태가 매핑 테이블에 없는 알 수 없는 값인 경우 → `mappedStatus: "TODO"` (기본값) 확인

#### 버그 2 확인 시나리오

1. Jira 이슈의 `dueDate`가 null인 경우 → Import 성공, `task.end_date`에 오늘 날짜 저장 확인
2. Jira 이슈의 `startDate`가 null인 경우 → Import 성공, `task.start_date`에 오늘 날짜 저장 확인
3. `dueDate`와 `startDate` 모두 null인 경우 → Import 성공, 두 필드 모두 오늘 날짜로 저장 확인
4. 두 날짜 모두 정상 값이 있는 경우 → 기존과 동일하게 Jira 값 그대로 저장 확인

#### 빌드

```bash
./gradlew compileJava
```

---

## 5. 리스크 및 고려사항

### 기술적 리스크

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| Jira 한글 상태명 불일치 | Jira Cloud는 관리자가 상태명을 자유롭게 변경할 수 있어, 실제 인스턴스의 상태명이 표준 번역과 다를 수 있음 | `mapStatus()`의 fallback이 TODO이므로 최악의 경우 TODO로 매핑. 향후 UI에서 커스텀 매핑 설정 기능을 추가하는 것을 권장 (별도 계획 필요) |
| startDate fallback 의도 오염 | startDate와 endDate 모두 오늘로 fallback되면 task 생성은 되지만 날짜가 실제 의미를 잃음 | WARN 레벨 로그로 명시. 향후 `task.start_date`, `task.end_date`를 nullable로 변경하는 스키마 개선이 근본 해결책 |

### 의존성 리스크

없음. 외부 라이브러리 추가 없이 순수 Java 코드 수정만으로 해결된다.

---

## 6. 참고 사항

### 관련 파일 경로

```
src/main/java/com/timeline/service/JiraImportService.java   <- 수정 대상 (유일)
src/main/java/com/timeline/service/JiraApiClient.java       <- 참고 (변경 없음)
src/main/java/com/timeline/domain/entity/Task.java          <- 참고 (변경 없음)
src/main/java/com/timeline/dto/JiraDto.java                 <- 참고 (변경 없음)
docs/schema.sql                                             <- 참고 (변경 없음)
docs/dev-plan/19-jira-integration.md                        <- 원래 Jira 연동 계획서
```

### 최종 STATUS_MAP 전체 목록 (수정 후)

```java
private static final Map<String, TaskStatus> STATUS_MAP = Map.ofEntries(
    // 영문 상태명
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
    Map.entry("won't do",    TaskStatus.CANCELLED),
    // 한글 상태명 (Jira Cloud 한국어 기본 워크플로)
    Map.entry("할 일",        TaskStatus.TODO),
    Map.entry("열려 있음",     TaskStatus.TODO),
    Map.entry("백로그",       TaskStatus.TODO),
    Map.entry("진행 중",      TaskStatus.IN_PROGRESS),
    Map.entry("검토 중",      TaskStatus.IN_PROGRESS),
    Map.entry("완료",         TaskStatus.COMPLETED),
    Map.entry("해결됨",       TaskStatus.COMPLETED),
    Map.entry("닫힘",         TaskStatus.COMPLETED),
    Map.entry("보류",         TaskStatus.HOLD),
    Map.entry("차단됨",       TaskStatus.HOLD),
    Map.entry("취소됨",       TaskStatus.CANCELLED),
    Map.entry("하지 않음",    TaskStatus.CANCELLED)
);
```
