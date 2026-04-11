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

## Schema Sync Rule

- When JPA entities (`domain/entity/`) are modified (add/remove/rename fields, change types, add new entities), **always update `docs/schema.sql`** to reflect the current schema.

## Conventions

- **Lombok**: `@Data`, `@Builder`, `@RequiredArgsConstructor` used throughout entities and services
- **Entity pattern**: JPA entities with `@Builder.Default` for default values, `@CreatedDate`/`@LastModifiedDate` for auditing
- **Repository queries**: Mix of derived method names and `@Query` with JPQL; use `JOIN FETCH` for eager loading in custom queries
- **Controller response**: `ResponseEntity<?>` returning `Map.of("success", true/false, ...)` — no standardized response wrapper
- **Frontend JS**: No modules/bundler; functions are global, use `var` declarations, `async/await` for API calls
- **HTML version cache**: `app.js` loaded with query param version (`app.js?v=20260410a`)
