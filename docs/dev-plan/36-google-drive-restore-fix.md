# 개발 계획서: Google Drive 복원 실패 수정

## 1. 개요

- **기능 설명**: Google Drive 복원(`POST /api/v1/data/gdrive/restore/{fileId}`) 실행 시 발생하는 FK 제약조건 위반 오류 수정
- **개발 배경**: `DomainSystem → Squad` 리네이밍 마이그레이션이 특정 환경에서 부분적으로만 완료되어, DB에 `project_domain_system` 테이블이 잔류하는 경우 복원 시 삭제 실패 발생
- **작성일**: 2026-04-18

---

## 2. 문제 분석

### 2.1 에러 메시지

```
JDBC exception executing SQL [/* delete from Project x */ delete from project p1_0]
[ERROR: update or delete on table "project" violates foreign key constraint
"fkfku9frjx6eqnqbehklfaurxm" on table "project_domain_system"
Detail: Key (id)=(2) is still referenced from table "project_domain_system".]
```

### 2.2 근본 원인: SchemaUpdateRunner 마이그레이션 실패 시나리오

`SchemaUpdateRunner.renameDomainSystemToSquad()`의 실행 흐름은 다음과 같다:

```
1. domain_system 테이블 존재 여부 확인
   ↓ (존재하면 마이그레이션 수행)
2. task.domain_system_id → task.squad_id 컬럼 리네이밍
3. domain_system → squad 테이블 리네이밍
4. project_domain_system 테이블 존재 여부 확인
   ↓ (존재하면)
5. project_domain_system.domain_system_id → squad_id 컬럼 리네이밍
6. project_domain_system → project_squad 테이블 리네이밍  ← 이 단계에서 문제 발생 가능
```

**문제 시나리오: 마이그레이션이 중간에 성공한 경우**

아래 두 상황 중 하나에서 `project_domain_system`이 잔류할 수 있다.

**시나리오 A: 신규 배포 환경 (Hibernate ddl-auto=update가 먼저 실행)**

1. 애플리케이션 시작 시 Hibernate `ddl-auto=update`가 먼저 실행된다.
2. 엔티티가 이미 `Squad`/`ProjectSquad`로 정의되어 있으므로 Hibernate는 `squad`, `project_squad` 테이블을 신규 생성한다.
3. 이후 `SchemaUpdateRunner`가 실행될 때 `domain_system` 테이블이 존재하지 않으므로 `renameDomainSystemToSquad()`는 아무것도 하지 않고 종료된다.
4. 그런데 `project_domain_system` 테이블은 아직 DB에 남아있다 (Hibernate가 삭제해주지 않음).
5. 결과적으로 `squad` 테이블과 `project_squad` 테이블이 모두 존재하고, `project_domain_system`도 잔류한다.

**시나리오 B: 기존 DB에 마이그레이션이 일부만 성공한 경우**

1. `domain_system` → `squad` 리네이밍은 성공했으나,
2. 이전 시도에서 `project_domain_system` 관련 처리 중 예외가 발생하고 `catch`에서 무시(로그만 출력)되어 `project_domain_system`이 잔류한다.
3. 다음 시작 시에는 `domain_system` 테이블이 없으므로 `renameDomainSystemToSquad()`가 마이그레이션 자체를 건너뛴다.
4. `project_domain_system`이 영구적으로 잔류하게 된다.

### 2.3 핵심 결함: deleteAllInOrder()의 삭제 순서 누락

`DataBackupService.deleteAllInOrder()`는 다음 순서로 삭제한다:

```java
taskDependencyRepository.deleteAllInBatch();
taskLinkRepository.deleteAllInBatch();
taskRepository.deleteAllInBatch();
projectMemberRepository.deleteAllInBatch();
projectSquadRepository.deleteAllInBatch();   // → project_squad 테이블 삭제
memberLeaveRepository.deleteAllInBatch();
projectRepository.deleteAllInBatch();         // ← FK 오류 발생 지점
```

`projectSquadRepository.deleteAllInBatch()`는 `project_squad` 테이블만 삭제하고,
잔류하는 `project_domain_system` 테이블은 아무도 건드리지 않는다.
그 상태에서 `projectRepository.deleteAllInBatch()`가 `project` 테이블을 삭제하려 하면
`project_domain_system.project_id`가 여전히 `project(id)`를 참조하고 있어 FK 위반이 발생한다.

### 2.4 추가 확인: project_milestone, project_link 테이블도 동일 위험 존재

`deleteAllInOrder()`를 보면 `project_milestone`과 `project_link` 테이블 역시 삭제 대상에 포함되어 있지 않다. 이 테이블들도 `project(id)`를 FK로 참조하고 있으므로 데이터가 존재할 경우 동일한 오류가 발생할 수 있다.

현재 엔티티: `ProjectMilestone`, `ProjectLink`
- 리포지토리: `ProjectMilestoneRepository`, `ProjectLinkRepository` 가 모두 존재하나 `DataBackupService`에 주입되어 있지 않음
- 이 두 테이블은 **현재 운영 중인 정상 테이블**이므로, `project_domain_system`과 달리 레거시 처리가 아닌 `deleteAllInOrder()`에 직접 추가하는 방식으로 처리해야 한다.

### 2.5 SchemaUpdateRunner의 구조적 문제

`project_domain_system` 잔류 문제를 서버 시작 시 처리하려면 마이그레이션 조건을 변경해야 한다. 현재 조건은:

```java
if (count != null && count > 0) {  // domain_system 테이블이 존재하면
    ...
    // project_domain_system → project_squad 처리
}
```

그런데 `project_domain_system`이 잔류하는 상황은 `domain_system` 테이블이 없는 상태에서도 발생한다. 즉, `project_domain_system` 잔류 처리 로직이 `domain_system` 존재 여부와 연계되어 있어 독립적으로 실행되지 않는다.

---

## 3. 해결 방안

### 3.1 수정 1: SchemaUpdateRunner — project_domain_system 독립 처리

`renameDomainSystemToSquad()` 메서드 내부의 `project_domain_system` 처리를 `domain_system` 존재 여부 조건 블록 **밖으로** 분리한다. 즉, `domain_system` 테이블 유무와 관계없이 `project_domain_system`이 존재하면 리네이밍 또는 삭제를 수행한다.

**변경 대상 파일**: `src/main/java/com/timeline/config/SchemaUpdateRunner.java`

**변경 방향**:

```
[기존]
renameDomainSystemToSquad() {
    if (domain_system 존재) {
        domain_system → squad 리네이밍
        if (project_domain_system 존재) {
            project_domain_system → project_squad 리네이밍  ← 조건 블록 안에 있음
        }
    }
}

[변경 후]
renameDomainSystemToSquad() {
    if (domain_system 존재) {
        domain_system → squad 리네이밍
    }
    // 독립 처리: domain_system 여부와 무관하게 항상 실행
    dropOrRenameProjectDomainSystemIfExists()
}

dropOrRenameProjectDomainSystemIfExists() {
    if (project_domain_system 존재) {
        if (project_squad 존재) {
            // project_squad가 이미 있으면 project_domain_system만 삭제 (데이터 마이그레이션 후)
            DELETE FROM project_domain_system  (또는 DROP TABLE ... CASCADE)
        } else {
            // project_squad가 없으면 리네이밍
            project_domain_system.domain_system_id → squad_id 컬럼 리네이밍
            project_domain_system → project_squad 테이블 리네이밍
        }
    }
}
```

**주의사항**: `project_squad`가 이미 존재하는 상황(시나리오 A)에서 `project_domain_system`을 삭제할 때는, `project_domain_system`의 데이터가 이미 `project_squad`에 마이그레이션되었는지 확인이 필요하다. 신규 배포 환경이라면 `project_domain_system` 데이터는 구 버전 데이터이므로 DROP으로 처리해도 무방하다.

구체적 SQL:
```sql
-- project_squad가 이미 존재하는 경우: project_domain_system을 DROP (CASCADE로 FK 함께 제거)
DROP TABLE IF EXISTS project_domain_system CASCADE;
```

또는 안전하게:
```sql
-- project_domain_system 데이터를 project_squad에 병합 후 DROP
-- 컬럼명이 domain_system_id인지 squad_id인지에 따라 분기 필요
-- (시나리오 B: domain_system_id → squad_id 리네이밍이 성공한 채로 잔류)
DO $$
DECLARE
    col_name TEXT;
BEGIN
    -- 실제 컬럼명 확인
    SELECT column_name INTO col_name
    FROM information_schema.columns
    WHERE table_name = 'project_domain_system'
      AND column_name IN ('domain_system_id', 'squad_id')
    LIMIT 1;

    IF col_name = 'domain_system_id' THEN
        INSERT INTO project_squad (project_id, squad_id, created_at)
        SELECT project_id, domain_system_id, created_at
        FROM project_domain_system pds
        WHERE NOT EXISTS (
            SELECT 1 FROM project_squad ps
            WHERE ps.project_id = pds.project_id AND ps.squad_id = pds.domain_system_id
        );
    ELSIF col_name = 'squad_id' THEN
        INSERT INTO project_squad (project_id, squad_id, created_at)
        SELECT project_id, squad_id, created_at
        FROM project_domain_system pds
        WHERE NOT EXISTS (
            SELECT 1 FROM project_squad ps
            WHERE ps.project_id = pds.project_id AND ps.squad_id = pds.squad_id
        );
    END IF;

    DROP TABLE IF EXISTS project_domain_system;
END $$;
```

데이터 보존 관점에서 **병합 후 DROP** 방식을 권장한다. `domain_system_id`와 `squad_id` 두 가지 컬럼명 시나리오를 모두 처리해야 한다.

### 3.2 수정 2: DataBackupService — deleteAllInOrder() 강화

모든 `project(id)`를 참조하는 테이블을 deleteAllInOrder()에 추가하되, 두 가지 방식 중 선택한다.

**방식 A: 정상 테이블은 리포지토리로, 레거시 잔류 테이블은 Native SQL로 처리 (권장)**

`project_milestone`과 `project_link`는 JPA 엔티티와 리포지토리(`ProjectMilestoneRepository`, `ProjectLinkRepository`)가 이미 존재하므로 `deleteAllInBatch()`로 직접 삭제한다. `DataBackupService` 생성자 주입 필드에도 추가한다.

`project_domain_system`은 JPA 엔티티/리포지토리가 없으므로 `EntityManager`로 Native 쿼리 실행한다.

```java
// DataBackupService 필드 추가 (생성자 주입)
private final ProjectMilestoneRepository projectMilestoneRepository;
private final ProjectLinkRepository projectLinkRepository;

private void deleteAllInOrder() {
    // 기존 삭제 순서 유지
    taskDependencyRepository.deleteAllInBatch();
    taskLinkRepository.deleteAllInBatch();
    taskRepository.deleteAllInBatch();
    projectMemberRepository.deleteAllInBatch();
    projectSquadRepository.deleteAllInBatch();
    projectMilestoneRepository.deleteAllInBatch();   // 추가: project_milestone
    projectLinkRepository.deleteAllInBatch();         // 추가: project_link
    memberLeaveRepository.deleteAllInBatch();

    // 잔류 레거시 테이블 처리 (project_domain_system): project 삭제 전에 실행
    deleteOrphanedLegacyTables();

    projectRepository.deleteAllInBatch();
    squadMemberRepository.deleteAllInBatch();
    squadRepository.deleteAllInBatch();
    holidayRepository.deleteAllInBatch();
    memberRepository.deleteAllInBatch();
    em.flush();
}

private void deleteOrphanedLegacyTables() {
    // project_domain_system: 리네이밍 마이그레이션 누락 시 잔류 가능 (JPA 엔티티 없음)
    try {
        em.createNativeQuery(
            "DO $$ BEGIN " +
            "  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_domain_system') " +
            "  THEN DELETE FROM project_domain_system; " +
            "  END IF; " +
            "END $$"
        ).executeUpdate();
    } catch (Exception e) {
        log.warn("project_domain_system 삭제 실패 (테이블 없음): {}", e.getMessage());
    }
}
```

**방식 B: TRUNCATE ... CASCADE 사용**

`projectRepository.deleteAllInBatch()` 대신 Native SQL로 CASCADE 삭제:

```sql
TRUNCATE TABLE project CASCADE;
```

이 방식은 `project`를 참조하는 모든 테이블을 자동으로 처리하지만, 순서 제어가 어렵고 시퀀스 리셋 등 사이드이펙트가 있을 수 있어 권장하지 않는다.

**권장 방식: 방식 A** (정상 테이블은 리포지토리로, 레거시 잔류 테이블만 Native SQL로 처리)

### 3.3 수정 3: project_milestone, project_link 백업/복원 대상에 추가 (이번 버그 수정 범위 외)

현재 `DataBackupService`는 `project_milestone`과 `project_link` 데이터를 백업/복원하지 않는다. 이는 데이터 유실 위험이 있다. `deleteAllInOrder()`에 삭제 코드를 추가하는 것(수정 2)은 이번 버그 수정에 포함되지만, Export(`exportAll`)와 Import(`importAll`) 흐름에 이 테이블들의 백업/복원 로직까지 추가하는 것은 이번 버그 수정의 직접적 범위를 넘으므로 별도 이슈로 처리한다.

---

## 4. 영향 범위

| 파일 | 변경 내용 | 영향 |
|------|-----------|------|
| `SchemaUpdateRunner.java` | `renameDomainSystemToSquad()` 리팩토링 — `project_domain_system` 처리를 독립 로직으로 분리 | 서버 시작 시 실행, 기존 DB 자동 보정 |
| `DataBackupService.java` | `deleteAllInOrder()`에 `projectMilestoneRepository`, `projectLinkRepository` 삭제 추가 + `deleteOrphanedLegacyTables()`로 `project_domain_system` 방어 삭제 추가 | 복원 트랜잭션 내 실행, FK 오류 방지 |

**기존 정상 환경 영향**: `project_domain_system` 테이블이 없는 환경에서는 `IF EXISTS` 조건으로 분기하므로 아무런 영향 없음.

**데이터 손실 위험**: `project_domain_system` 데이터를 삭제하므로, 해당 테이블에 마이그레이션되지 않은 데이터가 있다면 유실될 수 있다. 단, `project_domain_system`이 잔류하는 환경은 이미 `project_squad`가 정상적으로 운영 중이므로, 잔류 테이블의 데이터는 구버전 잉여 데이터로 판단된다.

---

## 5. 구현 순서

### Step 1: SchemaUpdateRunner 수정 (서버 시작 시 자동 보정)

1. `renameDomainSystemToSquad()` 메서드 리팩토링
2. `project_domain_system` 처리를 `dropOrRenameProjectDomainSystemIfExists()` 별도 메서드로 분리
3. `domain_system` 존재 여부 조건 밖에서 호출하도록 변경

### Step 2: DataBackupService 수정 (복원 시 방어 처리)

1. `ProjectMilestoneRepository`, `ProjectLinkRepository`를 `DataBackupService` 생성자 주입 필드에 추가
2. `deleteAllInOrder()`에 `projectMilestoneRepository.deleteAllInBatch()`와 `projectLinkRepository.deleteAllInBatch()` 추가 (`memberLeaveRepository` 앞)
3. `deleteOrphanedLegacyTables()` private 메서드 추가 (`project_domain_system` 전용)
4. `deleteAllInOrder()`에서 `projectRepository.deleteAllInBatch()` 호출 직전에 `deleteOrphanedLegacyTables()` 호출

---

## 6. 테스트 방법

### 6.1 수동 검증 (DB 조작)

1. DB에 `project_domain_system` 테이블을 수동으로 생성하고 더미 데이터 삽입:

```sql
CREATE TABLE IF NOT EXISTS project_domain_system (
    id bigserial PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES project(id),
    domain_system_id bigint,
    created_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO project_domain_system (project_id, domain_system_id, created_at)
SELECT id, 1, now() FROM project LIMIT 1;
```

2. 서버 재시작 → `SchemaUpdateRunner` 로그 확인 (project_domain_system 처리 로그 출력 여부)
3. Google Drive에서 복원 실행 → 에러 없이 성공하는지 확인

### 6.2 정상 환경 회귀 테스트

- `project_domain_system` 테이블이 없는 환경에서 복원 실행 → 기존과 동일하게 성공하는지 확인

### 6.3 서버 재시작 후 자동 보정 확인

1. `project_domain_system` 존재 상태에서 서버 시작
2. 로그에서 다음 메시지 확인:
   - `스키마 보정: project_domain_system 테이블 제거 완료` (또는 리네이밍)
3. 서버 시작 후 `project_domain_system` 테이블이 사라졌는지 DB 확인:

```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'project_domain_system';
-- 결과: 0
```

---

## 7. 리스크 및 고려사항

| 리스크 | 설명 | 대응 방안 |
|--------|------|-----------|
| project_domain_system 데이터 유실 | 잔류 테이블 데이터 삭제 시 구버전 연결 정보 삭제 | 이미 project_squad로 운영 중이므로 유실 아님. 단, 데이터 병합 방식 사용 시 더 안전 |
| DO $$ 블록 미지원 DB | PostgreSQL 외 DB에서는 DO 블록 미지원 | 현재 프로젝트는 PostgreSQL 전용이므로 해당 없음 |
| information_schema 쿼리 성능 | 서버 시작 시마다 information_schema 조회 | 기존 SchemaUpdateRunner도 동일 패턴 사용 중, 문제 없음 |
| TRUNCATE vs DELETE | deleteAllInBatch()는 DELETE 사용, CASCADE 옵션 없음 | 방식 A(명시적 DELETE)로 FK 순서 제어 |

---

## 8. 참고 사항

- **관련 파일 경로**:
  - `src/main/java/com/timeline/config/SchemaUpdateRunner.java`
  - `src/main/java/com/timeline/service/DataBackupService.java`
  - `src/main/java/com/timeline/domain/entity/ProjectSquad.java`
  - `src/main/java/com/timeline/domain/repository/ProjectSquadRepository.java`
  - `src/main/java/com/timeline/domain/entity/ProjectMilestone.java`
  - `src/main/java/com/timeline/domain/repository/ProjectMilestoneRepository.java`
  - `src/main/java/com/timeline/domain/entity/ProjectLink.java`
  - `src/main/java/com/timeline/domain/repository/ProjectLinkRepository.java`
- **에러 발생 FK 이름**: `fkfku9frjx6eqnqbehklfaurxm` — Hibernate가 자동 생성한 이름으로, `project_domain_system` 테이블의 `project_id → project(id)` FK임
- **Hibernate ddl-auto=update 동작**: 테이블 추가/컬럼 추가는 자동으로 수행하지만, 테이블 삭제/리네이밍은 수행하지 않음. 이것이 `project_domain_system`이 잔류하는 근본 원인
