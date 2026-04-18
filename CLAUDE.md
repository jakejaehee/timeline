# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Build (compile check)
./gradlew compileJava

# Run application (port 2403)
./gradlew bootRun

# Run tests
./gradlew test

# Full build with tests
./gradlew build
```

- Web UI: http://localhost:2403
- Java 17, Spring Boot 3.5, Gradle
- PostgreSQL 16 required (configured via .env or env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`)
- Flyway migrations exist in `src/main/resources/db/migration/` but are **disabled** — Hibernate `ddl-auto: update` handles schema

## Architecture Overview

Spring Boot monolith with vanilla JS frontend (no React/Vue). Single-page app served from `src/main/resources/static/`.

### Package Structure (`src/main/java/com/timeline/`)

```
controller/          REST API endpoints (/api/v1/*)
service/             Business logic services
domain/
  entity/            JPA entities
  enums/             Enum types
  repository/        Spring Data JPA repositories
  model/             In-memory domain models
dto/                 Data Transfer Objects
config/              Spring configuration, properties classes
exception/           Custom exceptions + GlobalExceptionHandler
```

### Frontend (`src/main/resources/static/`)

- `index.html` — Single HTML page with sidebar navigation
- `js/app.js` — All UI logic in vanilla JS, fetches REST APIs with `fetch()`
- `css/styles.css` — Custom styles on top of Bootstrap 5.3

## Schema & Backup Sync Rule

### docs/schema.sql 동기화
- JPA 엔티티(`domain/entity/`)를 수정(필드 추가/삭제/이름변경, 타입변경, 새 엔티티)할 때 **반드시 `docs/schema.sql`도 함께 수정**하여 현재 스키마를 반영
- `docs/schema.sql`은 DB의 **전체 테이블 정의**를 담고 있어야 함 (설정 테이블 포함)

### BackupDto / DataBackupService 동기화
- 테이블이나 컬럼이 추가/변경되면 **반드시 `BackupDto`와 `DataBackupService`도 함께 수정**
- `BackupDto.Snapshot`에 모든 데이터 테이블의 Row 클래스가 포함되어야 함
- `DataBackupService.exportAll()`에서 모든 테이블을 빠짐없이 export
- `DataBackupService.importAll()`에서 모든 테이블을 빠짐없이 import (FK 순서 준수)
- `DataBackupService.deleteAllInOrder()`에서 모든 테이블을 FK 역순으로 삭제
- `DataBackupService.resetSequences()`에서 모든 테이블의 sequence 리셋
- 각 Row 클래스는 해당 테이블의 **모든 컬럼**을 포함해야 함 (누락 금지)

## Conventions

- **Lombok**: `@Data`, `@Builder`, `@RequiredArgsConstructor` used throughout entities and services
- **Entity pattern**: JPA entities with `@Builder.Default` for default values, `@CreatedDate`/`@LastModifiedDate` for auditing
- **Repository queries**: Mix of derived method names and `@Query` with JPQL; use `JOIN FETCH` for eager loading in custom queries
- **Controller response**: `ResponseEntity<?>` returning `Map.of("success", true/false, ...)` — no standardized response wrapper
- **Frontend JS**: No modules/bundler; functions are global, use `var` declarations, `async/await` for API calls
- **HTML version cache**: `app.js` loaded with query param version (`app.js?v=20260410a`)
