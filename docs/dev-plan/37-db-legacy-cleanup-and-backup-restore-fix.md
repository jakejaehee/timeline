# 개발 계획서: DB 레거시 정리 및 백업/복원 전면 수정

## 1. 개요

- **기능 설명**: DomainSystem → Squad 리네이밍 이후 DB에 잔류하는 레거시 아티팩트를 완전히 제거하고, Google Drive 백업/복원이 정상 동작하도록 DataBackupService를 전면 수정한다. 아울러 docs/schema.sql을 현재 엔티티 코드와 완전히 동기화한다.
- **개발 배경**: Google Drive 복원 시 `project_domain_system` 테이블에 걸린 FK 제약조건이 프로젝트 삭제를 막아 복원이 실패한다. 또한 `project_milestone`, `project_link` 두 테이블이 백업에서 누락되어 있어 복원 후 데이터가 손실된다.
- **작성일**: 2026-04-18

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: SchemaUpdateRunner가 `project_domain_system` 테이블 잔류 여부를 확인하여, 존재하면 데이터를 정리(삭제)하고 테이블을 DROP한다.
- FR-002: SchemaUpdateRunner가 `task.domain_system_id` 컬럼 잔류 여부를 확인하여, 존재하면 컬럼을 DROP한다. PostgreSQL의 `DROP COLUMN`은 NOT NULL 제약을 컬럼과 함께 제거하므로 별도 nullable 변경이 불필요하다.
- FR-003: SchemaUpdateRunner가 `ENGINEER` role을 가진 member를 `EM`으로 일괄 UPDATE한다.
- FR-004: 위 세 가지 정리 로직은 `domain_system` 테이블 존재 여부와 무관하게 항상 독립적으로 실행된다.
- FR-005: DataBackupService.exportAll()이 `project_milestone`, `project_link` 데이터를 포함하여 내보낸다.
- FR-006: DataBackupService.importAll()이 복원 전 삭제 순서에서 `project_domain_system`(레거시, 방어적), `project_milestone`, `project_link`를 포함한다. `project_domain_system`, `project_milestone`, `project_link`는 모두 `project_id FK`를 가지므로 `project` 삭제 전에 먼저 삭제한다.
- FR-007: DataBackupService.importAll()이 복원 시 member의 role 값이 `ENGINEER`인 경우 `EM`으로 변환하여 삽입한다.
- FR-008: DataBackupService.insertProjects()가 현재 Project 엔티티의 모든 컬럼(jira_epic_key, quarter, ppl_id, epl_id, total_man_days_override, ktlo, sort_order)을 포함하여 INSERT한다.
- FR-009: DataBackupService.resetSequences()에 `project_milestone`, `project_link`의 sequence를 추가한다.
- FR-010: BackupDto.Snapshot에 `projectMilestones`, `projectLinks` 리스트 필드가 추가된다.
- FR-011: BackupDto.ImportResult에 `projectMilestones`, `projectLinks` 카운트 필드가 추가된다.
- FR-012: docs/schema.sql이 현재 엔티티 코드와 완전히 일치하도록 동기화된다.
- FR-013: BackupDto.MemberRow와 insertMembers() SQL에 `team` 컬럼을 추가한다. 현재 코드에 누락된 `Member.team` 필드를 백업/복원에 포함한다.

### 2.2 비기능 요구사항

- NFR-001: 모든 SchemaUpdateRunner 정리 로직은 멱등성(idempotent)을 보장해야 한다. 이미 정리된 상태에서 재실행해도 오류가 없어야 한다.
- NFR-002: 복원 실패 시 트랜잭션 롤백으로 데이터 일관성을 보장해야 한다.
- NFR-003: 구버전 백업 파일(project_milestone/project_link 필드 없음)을 복원할 때도 정상 동작해야 한다(null-safe 처리).

### 2.3 가정 사항

- `project_domain_system` 테이블이 실제로 존재하는 환경에서 실행된다.
- `task.domain_system_id` 컬럼이 일부 환경에서 잔류할 수 있다.
- `ENGINEER` role을 가진 member 레코드가 일부 환경에서 존재할 수 있다.
- `ProjectMilestoneRepository`, `ProjectLinkRepository`는 이미 존재한다(확인됨).
- `Member` 엔티티에 `team VARCHAR(100)` 컬럼이 존재한다. 현재 `BackupDto.MemberRow`와 `insertMembers()` SQL에 해당 컬럼이 누락되어 있으므로 이번 작업에서 함께 보완한다.

### 2.4 제외 범위 (Out of Scope)

- 백업 파일 포맷 버전 업(schemaVersion "1.0" → "2.0") — 하위 호환성 유지를 위해 버전을 올리지 않는다.
- google_drive_config, jira_config 테이블의 백업/복원 — 설정값은 환경별로 다르므로 제외.
- DataBackupService의 트랜잭션 분리 최적화 — 현재 단일 트랜잭션 방식 유지.

---

## 3. 시스템 설계

### 3.1 현황 분석 — 문제점 목록

#### 문제 A: SchemaUpdateRunner 레거시 정리 누락

현재 `renameDomainSystemToSquad()`는 `domain_system` 테이블이 존재할 때만 실행된다. 이 메서드 내부에서는 `domain_system → squad` 리네이밍과 함께, `project_domain_system` 테이블이 존재하면 `project_squad`로 리네이밍하는 처리도 포함되어 있다.

그러나 다음 두 가지 경우에 `project_domain_system`이 잔류할 수 있다:
- **경우 1**: `domain_system` 테이블이 이미 존재하지 않는 환경(리네이밍 완료 후 재배포 등)에서는 이 블록 전체가 실행되지 않아 `project_domain_system` DROP도 수행되지 않는다.
- **경우 2**: `domain_system`이 존재하는 환경에서 `project_domain_system → project_squad` 리네이밍이 실패(예: `project_squad`가 이미 존재)한 경우, `project_domain_system` 테이블이 그대로 남는다.

결과적으로:

| 잔류 아티팩트 | 증상 |
|---|---|
| `project_domain_system` 테이블 | project 삭제 시 FK 위반으로 복원 실패 |
| `task.domain_system_id` 컬럼 | NOT NULL 제약이 있어 새 task INSERT 불가 가능성 |
| member.role = `'ENGINEER'` | CHECK 제약 위반으로 복원 실패 가능성 |

이 세 가지 정리 작업은 `domain_system` 테이블 존재 여부와 **독립적으로** 항상 실행되어야 한다.

#### 문제 B: DataBackupService 누락 테이블

| 테이블 | Export | Import | deleteAllInOrder | resetSequences |
|---|---|---|---|---|
| project_milestone | 누락 | 누락 | 누락 | 누락 |
| project_link | 누락 | 누락 | 누락 | 누락 |
| project_domain_system | — | 방어적 삭제 필요 | 누락 | — |

#### 문제 C: insertProjects() 컬럼 불일치

현재 `insertProjects()`의 INSERT SQL은 다음 컬럼만 포함한다:
```
id, name, description, start_date, end_date, status, jira_board_id, created_at, updated_at
```

그러나 현재 `Project` 엔티티에는 다음 컬럼이 추가로 존재한다:
- `jira_epic_key` (VARCHAR 100)
- `quarter` (VARCHAR 200)
- `ppl_id` (FK → member.id)
- `epl_id` (FK → member.id)
- `total_man_days_override` (NUMERIC 10,1)
- `ktlo` (BOOLEAN NOT NULL DEFAULT false)
- `sort_order` (INTEGER)

누락된 컬럼 중 `ktlo`는 NOT NULL이므로, 해당 컬럼 없이 INSERT 시 오류가 발생한다. 이것이 복원 실패의 직접 원인 중 하나다.

#### 문제 D: BackupDto.ProjectRow 필드 불일치

`BackupDto.ProjectRow`에도 위 컬럼들이 없어, export 시점에 데이터가 누락된다.

#### 문제 E: BackupDto.MemberRow와 insertMembers()에 team 컬럼 누락

`Member` 엔티티에 `team VARCHAR(100)` 필드가 존재하지만, `BackupDto.MemberRow`에 해당 필드가 없고 `insertMembers()`의 INSERT SQL에도 `team` 컬럼이 없다. 결과적으로 백업 시 team 값이 JSON에 포함되지 않고, 복원 시에도 team 값이 유실된다.

### 3.2 변경 대상 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `SchemaUpdateRunner.java` | 수정 — 레거시 정리 3종 분리 독립 실행 |
| `DataBackupService.java` | 수정 — project_milestone/project_link 추가, project INSERT 컬럼 보완, ENGINEER→EM 변환, member INSERT에 team 컬럼 추가 |
| `BackupDto.java` | 수정 — ProjectRow 필드 추가, MemberRow에 team 필드 추가, Snapshot/ImportResult에 milestone/link 추가 |
| `docs/schema.sql` | 수정 — 현재 엔티티와 완전 동기화 (실질적 변경 없음, 이미 최신 상태 확인) |

---

## 4. 구현 계획

### 4.1 파일별 상세 변경 사항

---

#### 파일 1: `SchemaUpdateRunner.java`

**변경 목표**: 레거시 정리 3종을 독립 메서드로 분리하여 항상 실행

**현재 구조의 문제**:
`renameDomainSystemToSquad()` 메서드 안에 `domain_system` 테이블 존재 확인 블록이 있고, 레거시 정리(project_domain_system DROP, task.domain_system_id DROP, ENGINEER→EM 변환) 로직이 그 블록 안에 위치하거나 아예 없다.

**변경 후 `run()` 메서드**:
```java
@Override
public void run(ApplicationArguments args) {
    // 1. domain_system → squad 리네이밍 (이미 완료된 환경에서는 skip)
    renameDomainSystemToSquad();

    // 2. 레거시 아티팩트 정리 (domain_system 존재 여부와 무관하게 항상 실행)
    cleanupLegacyProjectDomainSystem();   // 신규 메서드
    dropColumnIfExists("task", "domain_system_id");  // 신규 호출
    convertEngineerRoleToEM();            // 신규 메서드

    // 3. 기존 컬럼 보정 (현재와 동일)
    dropColumnIfExists("project", "project_type");
    alterColumnNullable("task", "squad_id");
    // ... (이하 기존 내용 동일)
}
```

**신규 메서드 1: `cleanupLegacyProjectDomainSystem()`**
```
목적: project_domain_system 테이블이 존재하면 DROP

구현 로직:
1. information_schema.tables에서 project_domain_system 존재 확인
2. 존재하면:
   a. DROP TABLE project_domain_system CASCADE
      (CASCADE로 내부 FK 제약조건까지 함께 제거. project_domain_system을
       참조하는 테이블은 없으므로 CASCADE로 인한 연쇄 삭제 없음)
3. try-catch로 감싸서 멱등성 보장
4. 완료 log.info 출력
```

**신규 메서드 2: `convertEngineerRoleToEM()`**
```
목적: member 테이블에서 role = 'ENGINEER'인 레코드를 'EM'으로 UPDATE

구현 로직:
1. SELECT COUNT(*) FROM member WHERE role = 'ENGINEER' 로 대상 확인
2. 대상이 있으면 UPDATE member SET role = 'EM' WHERE role = 'ENGINEER'
3. 변환 건수 log.info 출력
4. try-catch로 감싸서 예외 발생 시 log.warn
```

**기존 `task.domain_system_id` 처리 변경**:
- 현재: `renameDomainSystemToSquad()` 내부에서 `domain_system_id → squad_id` RENAME 수행
- 변경 후: RENAME 로직은 기존 위치 유지 (domain_system 존재 시 실행). 단, RENAME이 아닌 DROP(`dropColumnIfExists("task", "domain_system_id")`)을 `run()` 메서드에서 독립 호출하여, 이미 리네이밍이 완료된 환경에서도 잔류 여부를 확인하고 DROP

**주의 사항**:
- `dropColumnIfExists("task", "domain_system_id")` 실행 전에 해당 컬럼에 NOT NULL 제약이 있을 수 있다. PostgreSQL의 `DROP COLUMN`은 컬럼에 걸린 NOT NULL 등 모든 제약조건을 함께 제거하므로 별도 `alterColumnNullable` 선행이 불필요하다.
- `project_domain_system` DROP 시에는 `DROP TABLE ... CASCADE`를 사용한다. FK 제약조건 이름을 사전에 알 필요 없이 단일 구문으로 처리 가능하며, 이 테이블을 참조하는 다른 테이블이 없으므로 CASCADE로 인한 연쇄 삭제는 발생하지 않는다.

---

#### 파일 2: `BackupDto.java`

**변경 0: `MemberRow`에 누락 필드 추가**

`Member` 엔티티에 `team VARCHAR(100)` 필드가 존재하나 현재 `MemberRow`에 누락되어 있다.

```java
// MemberRow에 추가할 필드
private String team;
```

**변경 1: `ProjectRow`에 누락 필드 추가**

```java
// 추가할 필드
private String jiraEpicKey;
private String quarter;
private Long pplId;
private Long eplId;
private BigDecimal totalManDaysOverride;
private Boolean ktlo;
private Integer sortOrder;
```

**변경 2: `Snapshot`에 신규 필드 추가**

```java
private List<ProjectMilestoneRow> projectMilestones;
private List<ProjectLinkRow> projectLinks;
```

**변경 3: 신규 inner class `ProjectMilestoneRow` 추가**

```java
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public static class ProjectMilestoneRow {
    private Long id;
    private Long projectId;
    private String name;
    private String type;           // MilestoneType enum → String
    private LocalDate startDate;
    private LocalDate endDate;
    private Integer days;
    private String qaAssignees;
    private Integer sortOrder;
    private LocalDateTime createdAt;
}
```

**변경 4: 신규 inner class `ProjectLinkRow` 추가**

```java
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public static class ProjectLinkRow {
    private Long id;
    private Long projectId;
    private String url;
    private String label;
    private LocalDateTime createdAt;
}
```

**변경 5: `ImportResult`에 카운트 필드 추가**

```java
private int projectMilestones;
private int projectLinks;
```

`toSummaryMessage()`도 두 필드를 포함하도록 수정.

---

#### 파일 3: `DataBackupService.java`

**변경 1: Repository 주입 추가**

```java
private final ProjectMilestoneRepository projectMilestoneRepository;
private final ProjectLinkRepository projectLinkRepository;
```

**변경 2: `exportAll()` — 두 테이블 추가**

```java
.projectMilestones(projectMilestoneRepository.findAll().stream()
        .map(this::toProjectMilestoneRow).collect(Collectors.toList()))
.projectLinks(projectLinkRepository.findAll().stream()
        .map(this::toProjectLinkRow).collect(Collectors.toList()))
```

**변경 3: `importAll()` — 삽입 호출 추가**

```java
int projectMilestoneCount = insertProjectMilestones(safe(snapshot.getProjectMilestones()));
int projectLinkCount = insertProjectLinks(safe(snapshot.getProjectLinks()));
```

`ImportResult` 빌더에도 두 카운트 추가.

**변경 4: `deleteAllInOrder()` — 삭제 순서 수정**

삭제 순서는 FK 의존관계 역순을 철저히 따른다.

```
현재 순서:
  taskDependency → taskLink → task
  → projectMember → projectSquad → memberLeave
  → project → squadMember → squad → holiday → member

변경 후 순서:
  taskDependency → taskLink → task
  → projectMember → projectSquad
  → projectMilestone (신규)
  → projectLink (신규)
  → [레거시 방어] project_domain_system (Native SQL로 방어적 삭제) ← project 삭제 전 필수
  → memberLeave
  → project
  → squadMember → squad → holiday → member
```

**삭제 순서 근거**: `project_domain_system`, `project_milestone`, `project_link`는 모두 `project_id` FK를 가지므로 `project` 삭제 전에 먼저 삭제해야 FK 위반이 발생하지 않는다. 특히 `project_domain_system` 방어적 삭제를 `project` 삭제 후로 배치하면 `project` 삭제 시 FK 위반이 재발한다.

`project_domain_system` 방어적 삭제는 Repository가 없으므로 `EntityManager` Native SQL 사용:

```java
// 방어적: project_domain_system 테이블이 잔류해 있을 경우 삭제
try {
    em.createNativeQuery("DELETE FROM project_domain_system").executeUpdate();
} catch (Exception ignored) {
    // 테이블이 없거나 이미 삭제된 경우 무시
}
```

**변경 5: `insertProjects()` — 컬럼 전면 보완**

기존 INSERT SQL을 아래로 교체:

```sql
INSERT INTO project (
  id, name, description, start_date, end_date, status,
  jira_board_id, jira_epic_key, quarter,
  ppl_id, epl_id,
  total_man_days_override, ktlo, sort_order,
  created_at, updated_at
) VALUES (
  :id, :name, :description, :startDate, :endDate, :status,
  :jiraBoardId, :jiraEpicKey, :quarter,
  :pplId, :eplId,
  :totalManDaysOverride, :ktlo, :sortOrder,
  :createdAt, :updatedAt
)
```

파라미터 바인딩:
- `ktlo`: null일 경우 `false`를 기본값으로 처리 (`r.getKtlo() != null ? r.getKtlo() : false`)

**변경 6: `toProjectRow()` — 누락 필드 매핑 추가**

```java
.jiraEpicKey(p.getJiraEpicKey())
.quarter(p.getQuarter())
.pplId(p.getPpl() != null ? p.getPpl().getId() : null)
.eplId(p.getEpl() != null ? p.getEpl().getId() : null)
.totalManDaysOverride(p.getTotalManDaysOverride())
.ktlo(p.getKtlo())
.sortOrder(p.getSortOrder())
```

**변경 7: `insertMembers()` — team 컬럼 추가 및 ENGINEER → EM 변환**

INSERT SQL에 `team` 컬럼을 추가한다. 현재 SQL은 `team`을 포함하지 않아 export된 team 값이 복원 시 유실된다.

```sql
INSERT INTO member (id, name, role, team, email, capacity, active, queue_start_date, created_at, updated_at)
VALUES (:id, :name, :role, :team, :email, :capacity, :active, :queueStartDate, :createdAt, :updatedAt)
```

아울러 INSERT 직전 role 변환도 함께 수행한다:

```java
String role = r.getRole();
if ("ENGINEER".equals(role)) {
    role = "EM";
    log.info("Import 중 ENGINEER → EM 변환: memberId={}", r.getId());
}
```

`toMemberRow()`에도 `team` 매핑을 추가한다:

```java
.team(m.getTeam())
```

**변경 8: `resetSequences()` — 두 테이블 추가**

```java
String[] tables = {
    "member", "squad", "squad_member", "project", "holiday",
    "project_member", "project_squad",
    "project_milestone", "project_link",  // 신규
    "task", "member_leave", "task_link", "task_dependency"
};
```

**변경 9: 신규 Entity → Row 변환 메서드 추가**

```java
private BackupDto.ProjectMilestoneRow toProjectMilestoneRow(ProjectMilestone m) { ... }
private BackupDto.ProjectLinkRow toProjectLinkRow(ProjectLink pl) { ... }
```

**변경 10: 신규 INSERT 메서드 추가**

```java
private int insertProjectMilestones(List<BackupDto.ProjectMilestoneRow> rows) { ... }
private int insertProjectLinks(List<BackupDto.ProjectLinkRow> rows) { ... }
```

INSERT SQL:
```sql
-- project_milestone
INSERT INTO project_milestone (id, project_id, name, type, start_date, end_date,
  days, qa_assignees, sort_order, created_at)
VALUES (:id, :projectId, :name, :type, :startDate, :endDate,
  :days, :qaAssignees, :sortOrder, :createdAt)

-- project_link
INSERT INTO project_link (id, project_id, url, label, created_at)
VALUES (:id, :projectId, :url, :label, :createdAt)
```

---

#### 파일 4: `docs/schema.sql`

현재 `docs/schema.sql`(2026-04-12 생성)과 현재 엔티티 코드를 비교한 결과, **실질적인 차이가 없음**을 확인하였다. schema.sql은 이미 최신 상태이므로 별도 수정이 불필요하다.

확인 결과 일치 항목:
- `squad`: name, description, color, created_at, updated_at
- `member`: 모든 컬럼 + role CHECK (BE/FE/QA/PM/EM/PLACEHOLDER)
- `project`: jira_epic_key, quarter, ppl_id, epl_id, total_man_days_override, ktlo, sort_order 모두 포함
- `project_milestone`: type, start_date, end_date, days, qa_assignees, sort_order 모두 포함
- `project_link`, `task_link`: 포함
- `google_drive_config`: client_id, client_secret, refresh_token, folder_id 포함
- `jira_config`: 포함

단, schema.sql 상단의 생성일 주석을 현재 날짜(2026-04-18)로 갱신하는 것이 적절하다.

---

### 4.2 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | SchemaUpdateRunner — cleanupLegacyProjectDomainSystem() 추가 | project_domain_system 테이블 존재 시 DROP | 낮음 | 없음 |
| T-02 | SchemaUpdateRunner — convertEngineerRoleToEM() 추가 | ENGINEER → EM UPDATE | 낮음 | 없음 |
| T-03 | SchemaUpdateRunner — task.domain_system_id 독립 DROP 호출 | run()에서 dropColumnIfExists 직접 호출 | 낮음 | 없음 |
| T-04 | BackupDto — ProjectRow 필드 추가 | 7개 필드 추가 | 낮음 | 없음 |
| T-05 | BackupDto — ProjectMilestoneRow, ProjectLinkRow 추가 | 신규 inner class 2개 | 낮음 | 없음 |
| T-06 | BackupDto — Snapshot, ImportResult 필드 추가 | 각 2개 필드 | 낮음 | T-05 |
| T-07 | DataBackupService — Repository 주입 추가 | ProjectMilestoneRepository, ProjectLinkRepository | 낮음 | T-05, T-06 |
| T-08 | DataBackupService — toProjectRow() 보완 | 7개 필드 매핑 추가 | 낮음 | T-04 |
| T-09 | DataBackupService — insertProjects() SQL 전면 교체 | 컬럼 7개 추가, ktlo null-safe | 중간 | T-04 |
| T-10 | DataBackupService — deleteAllInOrder() 수정 | milestone/link 추가, project_domain_system 방어 | 중간 | T-07 |
| T-11 | DataBackupService — exportAll() 두 테이블 추가 | milestone/link export | 낮음 | T-07 |
| T-12 | DataBackupService — insertProjectMilestones/Links 추가 | 신규 INSERT 메서드 2개 | 낮음 | T-05, T-07 |
| T-13 | DataBackupService — importAll() 두 테이블 삽입 호출 | milestone/link import | 낮음 | T-12 |
| T-14 | BackupDto — MemberRow에 team 필드 추가 | Member.team 누락 보완 | 낮음 | 없음 |
| T-15 | DataBackupService — insertMembers() team 컬럼 추가 + ENGINEER→EM 변환 | INSERT SQL 수정, toMemberRow() 보완, role 변환 로직 추가 | 낮음 | T-14 |
| T-16 | DataBackupService — resetSequences() 테이블 추가 | milestone/link sequence | 낮음 | 없음 |
| T-17 | docs/schema.sql — 생성일 주석 갱신 | 날짜만 수정 | 낮음 | 없음 |

### 4.3 구현 순서

```
Step 1: BackupDto 수정 (T-04, T-05, T-06, T-14)
  → 컴파일 기준점 확립

Step 2: DataBackupService 수정 (T-07 ~ T-13, T-15, T-16)
  → 의존성: BackupDto 변경 완료 후

Step 3: SchemaUpdateRunner 수정 (T-01, T-02, T-03)
  → DataBackupService와 독립적으로 병렬 작업 가능

Step 4: docs/schema.sql 생성일 갱신 (T-17)
  → 마지막

Step 5: 컴파일 검증
  → ./gradlew compileJava
```

### 4.4 테스트 계획

#### 로컬 환경 테스트 (수동)

**시나리오 A: 레거시 잔류 환경 시뮬레이션**
1. `psql`에서 수동으로 `project_domain_system` 테이블 생성
2. 애플리케이션 재시작
3. 로그에서 `cleanupLegacyProjectDomainSystem` 실행 및 DROP 확인
4. `information_schema.tables`에서 `project_domain_system` 없음 확인

**시나리오 B: task.domain_system_id 잔류 시뮬레이션**
1. `psql`에서 수동으로 `ALTER TABLE task ADD COLUMN domain_system_id BIGINT NOT NULL DEFAULT 0`
2. 애플리케이션 재시작
3. 로그에서 `domain_system_id 컬럼 삭제` 완료 확인

**시나리오 C: ENGINEER role 잔류 시뮬레이션**
1. `UPDATE member SET role = 'ENGINEER' WHERE id = <any_id>`
2. 애플리케이션 재시작
3. 로그에서 `ENGINEER → EM 변환 N건` 확인
4. `SELECT role FROM member WHERE id = <id>` → `EM` 확인

**시나리오 D: 백업 → 복원 E2E 테스트**
1. 프로젝트에 milestone, project_link 데이터 추가
2. Google Drive 백업 실행
3. 백업 JSON 파일 열어서 `projectMilestones`, `projectLinks` 배열 존재 확인
4. `project` 항목에 `ktlo`, `jiraEpicKey`, `pplId` 등 필드 존재 확인
5. 복원 실행
6. 복원 완료 후 milestone, project_link 데이터 정상 복원 확인

**시나리오 E: 구버전 백업 파일 복원 (하위 호환성)**
1. `projectMilestones`, `projectLinks` 필드가 없는 구버전 JSON으로 복원 시도
2. `safe()` 메서드로 null → empty list 처리되어 오류 없이 완료 확인

#### 컴파일 검증

```bash
./gradlew compileJava
```

오류 없이 통과 확인.

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 리스크 | 설명 | 완화 방안 |
|---|---|---|
| project_domain_system FK 이름 불명확 | PostgreSQL이 자동 생성한 FK 이름을 모를 수 있음 | `DROP TABLE ... CASCADE` 사용 또는 `information_schema.table_constraints`로 이름 조회 후 DROP |
| ktlo NOT NULL 위반 | 구버전 백업의 ProjectRow에 ktlo 없음 | `r.getKtlo() != null ? r.getKtlo() : false` null-safe 처리 |
| pplId/eplId FK 위반 | 복원 시 member 삽입 전에 project를 삽입하려 하면 FK 위반 | insertMembers() → insertProjects() 순서 유지 (현재 순서 이미 올바름) |
| project_milestone createdAt | project_milestone에는 updatedAt 컬럼이 없음 | INSERT SQL에 updated_at 포함하지 않도록 주의 |

### 5.2 의존성 리스크

- `ProjectMilestoneRepository.findAll()`, `ProjectLinkRepository.findAll()` — 이미 존재하는 Repository이므로 위험 없음.
- `SquadMemberRepository` — 이미 DataBackupService에서 사용 중이므로 패턴 그대로 적용 가능.

### 5.3 project_domain_system DROP 전략

`cleanupLegacyProjectDomainSystem()`에서는 `DROP TABLE IF EXISTS project_domain_system CASCADE`를 사용한다.

- `CASCADE` 키워드는 테이블 내부의 FK 제약조건(다른 테이블을 참조하는 방향)을 함께 제거한다.
- `project_domain_system`을 **참조하는** 다른 테이블은 없으므로, CASCADE로 인한 연쇄 삭제(다른 테이블의 데이터 삭제)는 발생하지 않는다.
- FK 제약조건 이름을 사전에 알 필요가 없어 코드가 단순하다.
- 이미 `renameDomainSystemToSquad()`에서 `fk_pds_domain_system`, `fk_pds_squad` DROP을 시도하므로, 재시도해도 `IF EXISTS` 조건으로 오류 없이 통과한다.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 |
|---|---|
| SchemaUpdateRunner | `src/main/java/com/timeline/config/SchemaUpdateRunner.java` |
| DataBackupService | `src/main/java/com/timeline/service/DataBackupService.java` |
| BackupDto | `src/main/java/com/timeline/dto/BackupDto.java` |
| ProjectMilestoneRepository | `src/main/java/com/timeline/domain/repository/ProjectMilestoneRepository.java` |
| ProjectLinkRepository | `src/main/java/com/timeline/domain/repository/ProjectLinkRepository.java` |
| Project 엔티티 | `src/main/java/com/timeline/domain/entity/Project.java` |
| ProjectMilestone 엔티티 | `src/main/java/com/timeline/domain/entity/ProjectMilestone.java` |
| ProjectLink 엔티티 | `src/main/java/com/timeline/domain/entity/ProjectLink.java` |
| schema.sql | `docs/schema.sql` |

### 이전 관련 계획서

- `docs/dev-plan/18-data-export-import.md`: 초기 Export/Import 설계
- `docs/dev-plan/36-google-drive-restore-fix.md`: Google Drive 복원 버그 이전 수정 이력
