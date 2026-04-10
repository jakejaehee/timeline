# Data Model Design

## ERD (Entity Relationship)

```
Member (1) ──< ProjectMember >── (N) Project
Project (1) ──< ProjectDomainSystem >── (N) DomainSystem
Project (1) ──────────────────────────< Task
DomainSystem (1) ─────────────────────< Task
Task (N) ──< TaskDependency >── (N) Task
Task (N) >── (1) Member (assignee)
```

## Entity 상세

### 1. Member (팀원)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT (PK) | 자동생성 |
| name | VARCHAR(100) | 이름 (NOT NULL) |
| role | VARCHAR(20) | 역할: ENGINEER, QA, PM |
| email | VARCHAR(200) | 이메일 (선택) |
| active | BOOLEAN | 활성 여부 (기본 true) |
| created_at | TIMESTAMP | 생성일 |
| updated_at | TIMESTAMP | 수정일 |

### 2. DomainSystem (도메인 시스템)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT (PK) | 자동생성 |
| name | VARCHAR(100) | 시스템명 (NOT NULL, UNIQUE) |
| description | VARCHAR(500) | 설명 |
| color | VARCHAR(7) | 간트차트 표시 색상 (예: #FF5733) |
| created_at | TIMESTAMP | 생성일 |
| updated_at | TIMESTAMP | 수정일 |

### 3. Project (프로젝트)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT (PK) | 자동생성 |
| name | VARCHAR(200) | 프로젝트명 (NOT NULL) |
| type | VARCHAR(30) | 유형: SKU_SYSTEM, BUSINESS, MUKIE |
| description | TEXT | 설명 |
| start_date | DATE | 시작일 |
| end_date | DATE | 종료일 |
| status | VARCHAR(20) | 상태: PLANNING, IN_PROGRESS, COMPLETED, ON_HOLD |
| created_at | TIMESTAMP | 생성일 |
| updated_at | TIMESTAMP | 수정일 |

### 4. ProjectMember (프로젝트-멤버 연결)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT (PK) | 자동생성 |
| project_id | BIGINT (FK) | 프로젝트 ID |
| member_id | BIGINT (FK) | 멤버 ID |
| created_at | TIMESTAMP | 생성일 |

- UNIQUE 제약: (project_id, member_id)

### 5. ProjectDomainSystem (프로젝트-도메인시스템 연결)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT (PK) | 자동생성 |
| project_id | BIGINT (FK) | 프로젝트 ID |
| domain_system_id | BIGINT (FK) | 도메인 시스템 ID |
| created_at | TIMESTAMP | 생성일 |

- UNIQUE 제약: (project_id, domain_system_id)

### 6. Task (태스크)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT (PK) | 자동생성 |
| project_id | BIGINT (FK) | 프로젝트 ID (NOT NULL) |
| domain_system_id | BIGINT (FK) | 도메인 시스템 ID (NOT NULL) |
| assignee_id | BIGINT (FK) | 담당자 Member ID |
| name | VARCHAR(300) | 태스크명 (NOT NULL) |
| description | TEXT | 상세 설명 |
| start_date | DATE | 시작일 (NOT NULL) |
| end_date | DATE | 종료일 (NOT NULL) |
| man_days | DECIMAL(5,1) | 공수 (man-day) |
| status | VARCHAR(20) | 상태: PENDING, IN_PROGRESS, COMPLETED |
| sort_order | INTEGER | 간트차트 내 정렬 순서 |
| created_at | TIMESTAMP | 생성일 |
| updated_at | TIMESTAMP | 수정일 |

### 7. TaskDependency (태스크 의존관계)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | BIGINT (PK) | 자동생성 |
| task_id | BIGINT (FK) | 후행 태스크 ID (이 태스크가 대기) |
| depends_on_task_id | BIGINT (FK) | 선행 태스크 ID (이 태스크가 먼저 완료되어야 함) |
| created_at | TIMESTAMP | 생성일 |

- UNIQUE 제약: (task_id, depends_on_task_id)

## Enum 정의

### MemberRole
```java
ENGINEER, QA, PM
```

### ProjectType
```java
SKU_SYSTEM, BUSINESS, MUKIE
```

### ProjectStatus
```java
PLANNING, IN_PROGRESS, COMPLETED, ON_HOLD
```

### TaskStatus
```java
PENDING, IN_PROGRESS, COMPLETED
```
