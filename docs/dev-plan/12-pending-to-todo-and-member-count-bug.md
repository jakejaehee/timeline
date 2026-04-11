# 개발 계획서: TaskStatus PENDING→TODO 변경 + Projects 멤버수 버그 수정

- 작성일: 2026-04-11
- 작성자: Dev Plan Agent

---

## 1. 개요

두 가지 독립적인 작업을 하나의 계획서에 기술한다.

| 작업 | 유형 | 영향 범위 |
|------|------|-----------|
| TaskStatus.PENDING → TODO 이름 변경 | 리팩토링 | Backend enum + DB + Frontend |
| Projects 화면 멤버수 0 표시 버그 수정 | 버그픽스 | Backend API + Frontend |

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: `TaskStatus` enum 값 `PENDING`을 `TODO`로 변경한다.
- **FR-002**: `PENDING`을 참조하는 백엔드 코드(엔티티, 서비스, 주석 등) 전체를 `TODO`로 수정한다.
- **FR-003**: `PENDING`을 참조하는 프론트엔드 코드(HTML `<option>`, JS 기본값, CSS 클래스) 전체를 `TODO`로 수정한다.
- **FR-004**: DB에 저장된 기존 `'PENDING'` 문자열 값을 `'TODO'`로 마이그레이션한다.
- **FR-005**: Projects 목록 API(`GET /api/v1/projects`)가 멤버 정보를 포함하도록 수정한다.
- **FR-006**: Projects 화면에서 각 프로젝트의 멤버수가 올바르게 표시되어야 한다.

### 2.2 비기능 요구사항

- **NFR-001**: Hibernate `ddl-auto: update` 사용 중이므로 enum 컬럼 값 변경은 SQL UPDATE 스크립트로 처리한다.
- **NFR-002**: 멤버수 조회는 N+1 문제 없이 효율적으로 처리되어야 한다.
- **NFR-003**: 기존 태스크 생성/수정 API의 기본 상태값 처리 로직이 변경 후에도 정상 동작해야 한다.

### 2.3 가정 사항

- DB는 `ddl-auto: update`로 관리되며 별도 Flyway 마이그레이션 파일은 사용하지 않는다.
- DB에 이미 `status = 'PENDING'`인 task 레코드가 존재할 수 있으므로 SQL UPDATE가 필요하다.
- PENDING → TODO 변경은 의미상 "아직 시작 안 한 상태"로 동일하며, 비즈니스 로직 변경 없이 이름만 교체한다.

### 2.4 제외 범위 (Out of Scope)

- TaskStatus enum에 새 값 추가 또는 다른 값의 변경은 이번 범위에 포함하지 않는다.
- 멤버수 외 다른 프로젝트 목록 컬럼(domainSystems 수 등)의 변경은 포함하지 않는다.

---

## 3. 버그 분석 및 원인 파악

### 3.1 Issue 1: PENDING → TODO 변경 대상 목록

코드베이스 전체 검색 결과, `PENDING`이 사용된 위치는 다음과 같다.

#### Backend

| 파일 | 라인 | 내용 |
|------|------|------|
| `domain/enums/TaskStatus.java` | 7 | `PENDING,` — enum 값 선언 |
| `domain/entity/Task.java` | 63 | `private TaskStatus status = TaskStatus.PENDING;` — 기본값 |
| `service/TaskService.java` | 238 | `// status가 null이면 @Builder.Default(PENDING)가 적용됨` — 주석 |
| `service/WarningService.java` | — | PENDING 직접 참조 없음. `INACTIVE_STATUSES`는 HOLD/CANCELLED만 포함하므로 변경 불필요 (확인 완료) |

#### Frontend (app.js)

| 파일 | 라인 | 내용 |
|------|------|------|
| `js/app.js` | 1340 | `document.getElementById('task-status').value = 'PENDING';` — 신규 태스크 기본값 |
| `js/app.js` | 1407 | `t.status \|\| 'PENDING'` — 기존 태스크 불러올 때 폴백값 |

#### Frontend (index.html)

| 파일 | 라인 | 내용 |
|------|------|------|
| `index.html` | 339 | `<option value="PENDING">PENDING</option>` — Team Board 필터 상태 드롭다운 |
| `index.html` | 768 | `<option value="PENDING">PENDING</option>` — 태스크 모달 상태 드롭다운 |

#### CSS (styles.css)

| 파일 | 라인 | 내용 |
|------|------|------|
| `css/styles.css` | 206 | `.badge-PENDING { ... }` — PENDING 배지 스타일 |

#### DB (런타임 데이터)

- `task` 테이블의 `status` 컬럼에 저장된 `'PENDING'` 문자열 값

### 3.2 Issue 2: Projects 멤버수 0 표시 버그

**원인 분석:**

`loadProjects()` 함수(app.js 508라인)는 `GET /api/v1/projects` 응답의 `p.members` 필드를 참조한다.

```javascript
// app.js:508
var memberCount = (p.members && p.members.length) ? p.members.length : 0;
```

그러나 백엔드 `ProjectService.getAllProjects()`를 보면:

```java
// ProjectService.java:46-49
.map(project -> {
    LocalDate expectedEndDate = calculateExpectedEndDate(project.getId());
    return ProjectDto.Response.from(project, null, null, expectedEndDate);
                                              ^^^^  ^^^^
                                      members=null  domainSystems=null
})
```

`from(project, null, null, expectedEndDate)` 오버로드는 `members`를 `null`로 전달한다. 결과적으로 JSON 응답의 `members` 필드가 `null`이 되어 프론트엔드에서 `0명`으로 표시된다.

**반면** 단건 조회(`GET /api/v1/projects/{id}`)는 `getProject()` 메서드가 `projectMemberRepository.findByProjectIdWithMember(id)`를 호출하여 실제 멤버 목록을 포함하므로 정상 동작한다.

**수정 방향:**

`getAllProjects()`에서 각 프로젝트의 멤버 수를 포함하여 반환해야 한다. 두 가지 접근 방법이 있다.

- **방법 A** (권장): `getAllProjects()`에서 각 프로젝트 ID별 멤버 목록을 조회하여 `members` 필드를 채워 반환한다.
- **방법 B**: 멤버 수만 필요하므로 `ProjectDto.Response`에 `memberCount` 필드를 추가하고, `projectMemberRepository.countByProjectId(projectId)`로 카운트만 조회한다.

방법 A는 기존 DTO 구조 변경 없이 일관성을 유지하지만 N+1 문제가 발생할 수 있다. 방법 B는 카운트 쿼리 하나로 효율적이고, 목록 화면에서 멤버 상세정보가 불필요하므로 더 적합하다.

**최종 결정: 방법 B 채택** — `memberCount` 필드 추가 + count 쿼리로 효율적으로 처리한다.

---

## 4. 시스템 설계

### 4.1 데이터 모델 변경

#### Issue 1: DB 데이터 마이그레이션

Hibernate `ddl-auto: update`는 enum 컬럼 자체를 자동으로 수정하지 않는다. 기존 `'PENDING'` 데이터를 `'TODO'`로 변경하는 SQL을 수동으로 실행해야 한다.

```sql
-- task 테이블의 기존 PENDING 데이터를 TODO로 변경
UPDATE task SET status = 'TODO' WHERE status = 'PENDING';
```

> **주의**: 이 SQL은 애플리케이션 재시작 전에 실행해야 한다. 재시작 후에는 Hibernate가 `'PENDING'` 값을 읽으려 할 때 enum 변환 오류(`No enum constant`)가 발생한다.

#### Issue 2: ProjectDto.Response 필드 추가

```java
// ProjectDto.Response에 memberCount 필드 추가
private Integer memberCount;
```

### 4.2 API 설계

| Method | Endpoint | 변경 내용 |
|--------|----------|-----------|
| `GET` | `/api/v1/projects` | 응답 JSON에 `memberCount` 필드 추가 |
| `GET` | `/api/v1/projects/{id}` | 변경 없음 (이미 `members` 배열 포함) |

응답 예시 (변경 후):
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "프로젝트명",
      "memberCount": 3,
      "members": null,
      "domainSystems": null,
      ...
    }
  ]
}
```

> 참고: `members`와 `domainSystems` 필드는 목록 조회 시 여전히 `null`로 직렬화된다. 현재 프로젝트에 `@JsonInclude(NON_NULL)` 설정이 없으므로 null 필드가 JSON에 포함된다. 프론트엔드 `loadProjects()`는 `p.members` 대신 `p.memberCount`를 사용하도록 수정하므로 `members: null`은 무해하다.

### 4.3 서비스 계층 변경

#### Issue 2: ProjectService.getAllProjects() 수정

```java
public List<ProjectDto.Response> getAllProjects() {
    return projectRepository.findAllByOrderByCreatedAtDesc().stream()
            .map(project -> {
                LocalDate expectedEndDate = calculateExpectedEndDate(project.getId());
                // 변경 전: return ProjectDto.Response.from(project, null, null, expectedEndDate);
                // 변경 후: memberCount를 포함한 신규 오버로드 호출
                long memberCount = projectMemberRepository.countByProjectId(project.getId());
                return ProjectDto.Response.from(project, memberCount, expectedEndDate);
            })
            .collect(Collectors.toList());
}
```

#### Issue 2: ProjectMemberRepository에 count 쿼리 추가

```java
// ProjectMemberRepository에 추가
// Spring Data JPA 파생 메서드: long 반환
long countByProjectId(Long projectId);
```

#### Issue 2: ProjectDto.Response 팩토리 메서드 추가

기존 코드에 이미 3-파라미터 오버로드 `from(Project, List<MemberDto.Response>, List<DomainSystemDto.Response>)`가 존재하므로, 신규 오버로드는 `expectedEndDate`를 함께 받는 별도 시그니처로 추가한다.

```java
// memberCount + expectedEndDate를 받는 신규 오버로드 추가
// (기존 3-param 오버로드와 파라미터 타입이 달라 충돌 없음)
public static Response from(Project project, long memberCount, LocalDate expectedEndDate) {
    Boolean delayed = null;
    if (expectedEndDate != null && project.getDeadline() != null) {
        delayed = expectedEndDate.isAfter(project.getDeadline());
    }
    return Response.builder()
            .id(project.getId())
            .name(project.getName())
            .type(project.getType())
            .description(project.getDescription())
            .startDate(project.getStartDate())
            .endDate(project.getEndDate())
            .deadline(project.getDeadline())
            .expectedEndDate(expectedEndDate)
            .isDelayed(delayed)
            .status(project.getStatus())
            .memberCount((int) memberCount)  // long → int 명시적 캐스팅
            .build();
}
```

### 4.4 프론트엔드 변경

#### Issue 1: PENDING → TODO 변경 목록

| 파일 | 위치 | 변경 전 | 변경 후 |
|------|------|---------|---------|
| `index.html` | 라인 339 | `<option value="PENDING">PENDING</option>` | `<option value="TODO">TODO</option>` |
| `index.html` | 라인 768 | `<option value="PENDING">PENDING</option>` | `<option value="TODO">TODO</option>` |
| `app.js` | 라인 1340 | `'PENDING'` | `'TODO'` |
| `app.js` | 라인 1407 | `t.status \|\| 'PENDING'` | `t.status \|\| 'TODO'` |
| `styles.css` | 라인 206 | `.badge-PENDING { ... }` | `.badge-TODO { ... }` |

#### Issue 2: memberCount 필드 사용으로 변경

```javascript
// app.js:508 변경 전
var memberCount = (p.members && p.members.length) ? p.members.length : 0;

// app.js:508 변경 후
var memberCount = p.memberCount != null ? p.memberCount : 0;
```

#### app.js 버전 업

현재 `index.html`의 로드 URL은 `app.js?v=20260412b`이다. 오늘 날짜(2026-04-11) 기준으로 새 버전 문자열을 사용한다.

```html
<!-- index.html 변경 전 -->
<script src="/js/app.js?v=20260412b"></script>

<!-- index.html 변경 후 -->
<script src="/js/app.js?v=20260411a"></script>
```

> 참고: 기존 버전 문자열 `20260412b`는 미래 날짜(4월 12일)로 기재되어 있어 오늘 기준 버전인 `20260411a`로 정정한다.

---

## 5. 구현 계획

### 5.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | DB 마이그레이션 SQL 실행 | `UPDATE task SET status = 'TODO' WHERE status = 'PENDING'` | 낮음 | 없음 (앱 재시작 전) |
| T-02 | TaskStatus enum 변경 | `PENDING` → `TODO` | 낮음 | T-01 완료 후 |
| T-03 | Task.java 기본값 변경 | `TaskStatus.PENDING` → `TaskStatus.TODO` | 낮음 | T-02 |
| T-04 | TaskService.java 주석 수정 | 주석 내 PENDING 문자열 수정 | 매우 낮음 | T-02 |
| T-05 | ProjectMemberRepository count 쿼리 추가 | `countByProjectId` 메서드 추가 | 낮음 | 없음 |
| T-06 | ProjectDto.Response 수정 | `memberCount` 필드 추가 + 팩토리 메서드 추가 | 낮음 | T-05 |
| T-07 | ProjectService.getAllProjects() 수정 | memberCount 포함 응답 반환 | 낮음 | T-05, T-06 |
| T-08 | index.html PENDING → TODO | `<option>` 값 2곳 수정 | 낮음 | T-02 |
| T-09 | app.js PENDING → TODO + memberCount | 기본값 2곳 + memberCount 사용으로 수정 | 낮음 | T-02, T-07 |
| T-10 | styles.css PENDING → TODO | `.badge-PENDING` → `.badge-TODO` | 낮음 | T-02 |
| T-11 | index.html 버전 문자열 업데이트 | `v=20260412b` → `v=20260411a` (index.html 수정) | 매우 낮음 | T-09 |
| T-12 | 컴파일 검증 | `./gradlew compileJava` | - | T-02~T-07 |

### 5.2 구현 순서

1. **Step 1: DB 마이그레이션 (T-01)**
   - **앱 서버를 완전히 내린 상태에서** SQL 실행 (실행 중 enum 변환 오류 방지)
   - `UPDATE task SET status = 'TODO' WHERE status = 'PENDING';`
   - 실행 후 영향 행 수 확인

2. **Step 2: Backend 변경 (T-02 ~ T-07)**
   - `TaskStatus.java`: `PENDING` → `TODO`
   - `Task.java`: `TaskStatus.PENDING` → `TaskStatus.TODO`
   - `TaskService.java`: 주석 수정
   - `ProjectMemberRepository.java`: `countByProjectId` 추가
   - `ProjectDto.java`: `memberCount` 필드 + 팩토리 메서드 추가
   - `ProjectService.java`: `getAllProjects()` 수정

3. **Step 3: 컴파일 검증 (T-12)**
   - `./gradlew compileJava`로 오류 없음 확인

4. **Step 4: Frontend 변경 (T-08 ~ T-11)**
   - `index.html`: PENDING 옵션 2곳 TODO로 변경
   - `app.js`: PENDING 문자열 2곳 + memberCount 참조 수정
   - `index.html`: 버전 문자열 `v=20260412b` → `v=20260411a`
   - `styles.css`: `.badge-PENDING` → `.badge-TODO`

### 5.3 테스트 계획

| 시나리오 | 검증 방법 |
|---------|----------|
| 신규 태스크 생성 시 기본 상태가 TODO인지 확인 | API `POST /api/v1/tasks` 호출 후 응답 `status` 필드 확인 |
| 태스크 모달 열 때 상태 드롭다운 기본값이 TODO인지 확인 | 브라우저 직접 확인 |
| 기존 DB의 PENDING 데이터가 TODO로 변환되었는지 확인 | DB 조회 또는 태스크 목록 API 응답 확인 |
| TODO 배지가 보라색으로 올바르게 표시되는지 확인 | 브라우저 직접 확인 |
| Projects 목록에서 멤버수가 정확히 표시되는지 확인 | 멤버가 있는 프로젝트의 목록 화면 확인 |
| `GET /api/v1/projects` 응답에 `memberCount` 필드 포함 확인 | API 직접 호출 후 JSON 응답 확인 |
| 멤버가 없는 프로젝트는 0명으로 표시되는지 확인 | 브라우저 직접 확인 |

---

## 6. 리스크 및 고려사항

### 6.1 DB 마이그레이션 타이밍 리스크

- **리스크**: 앱 재시작 후 DB에 `'PENDING'` 데이터가 남아있으면 Hibernate가 `No enum constant TaskStatus.PENDING` 예외를 발생시켜 장애가 발생한다.
- **완화**: T-01(DB UPDATE)을 T-02(enum 변경)보다 반드시 먼저 실행한다. 배포 시 순서: DB SQL 실행 → 코드 배포 → 앱 재시작.

### 6.2 N+1 문제 (멤버수 조회)

- **현황**: `getAllProjects()`에서 프로젝트 수만큼 `countByProjectId` 쿼리가 발생한다.
- **판단**: 방법 B(`countByProjectId`)는 단순 count 쿼리이므로 비용이 낮다. 프로젝트 수가 수백 개가 되기 전까지는 허용 가능한 수준이다.
- **개선 여지**: 향후 프로젝트 수가 많아지면 `@Query("SELECT pm.project.id, COUNT(pm) FROM ProjectMember pm GROUP BY pm.project.id")`와 같은 집계 쿼리 하나로 전체 프로젝트 카운트를 한 번에 조회하는 방식으로 대체 가능하다.

### 6.3 getAllProjects()의 members=null 유지

- 목록 조회 시 `members` 필드는 여전히 `null`이다. `memberCount`만 추가하는 방식이므로 기존 코드 중 목록 응답에서 `p.members`를 사용하는 부분이 있다면 주의가 필요하다.
- 확인 결과, `loadProjects()` 외에 목록 응답의 `members`를 직접 사용하는 JS 코드는 없다.

---

## 7. 참고 사항

### 관련 파일 경로

| 파일 | 절대 경로 |
|------|-----------|
| TaskStatus enum | `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/domain/enums/TaskStatus.java` |
| Task entity | `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/domain/entity/Task.java` |
| TaskService | `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/service/TaskService.java` |
| ProjectService | `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/service/ProjectService.java` |
| ProjectDto | `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/dto/ProjectDto.java` |
| ProjectMemberRepository | `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/domain/repository/ProjectMemberRepository.java` |
| app.js | `/Users/jakejaehee/project/timeline/src/main/resources/static/js/app.js` |
| index.html | `/Users/jakejaehee/project/timeline/src/main/resources/static/index.html` |
| styles.css | `/Users/jakejaehee/project/timeline/src/main/resources/static/css/styles.css` |
