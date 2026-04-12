# 개발 계획서: 태스크 선택삭제 갯수 제한 제거

## 1. 개요

- **기능 설명**: 태스크 일괄 삭제(batch delete) 시 백엔드에 존재하는 1000개 최대 제한을 제거하여 갯수 제한 없이 삭제 가능하도록 개선
- **개발 배경**: 현재 `TaskController.batchDelete()`에 `taskIdRaw.size() > 1000` 검사가 있어 1000개 초과 선택 시 에러 반환. 서비스 계층의 100개 chunk 처리 로직이 이미 대량 삭제를 안정적으로 지원하므로 상위 제한은 불필요함
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: `POST /api/v1/tasks/batch-delete` 엔드포인트에서 1000개 초과 제한 검사를 제거한다.
- FR-002: 서비스 계층의 `DELETE_CHUNK_SIZE = 100` chunk 반복 처리 로직은 그대로 유지한다.
- FR-003: 기존 유효성 검사(빈 배열, 숫자 타입 검사)는 그대로 유지한다.

### 2.2 비기능 요구사항

- NFR-001: 변경 범위를 최소화하여 회귀 위험을 줄인다 (컨트롤러 6줄 제거만으로 완결).
- NFR-002: 프론트엔드 코드(`app.js`) 변경 없음.

### 2.3 가정 사항

- 프론트엔드는 이미 갯수 제한 없이 다중 선택을 허용하고 있음 (변경 불필요).
- DB 레벨의 안전성은 chunk 처리(100개씩 루프)로 충분히 보장됨.
- 단일 트랜잭션으로 전체 삭제를 처리하므로 부분 실패 시 전체 롤백됨 (기존 동작 유지).

### 2.4 제외 범위 (Out of Scope)

- 프론트엔드 UI 변경
- chunk 크기(`DELETE_CHUNK_SIZE`) 변경
- 트랜잭션 전략 변경 (단일 트랜잭션 유지)
- 삭제 건수에 대한 경고 UI 추가

---

## 3. 시스템 설계

### 3.1 변경 대상 코드

**변경 전** (`TaskController.java`, line 122-127):

```java
if (taskIdRaw.size() > 1000) {
    return ResponseEntity.badRequest().body(Map.of(
            "success", false,
            "message", "한 번에 최대 1000개까지 삭제할 수 있습니다."
    ));
}
```

**변경 후**: 위 블록 전체 삭제.

### 3.2 API 설계 (변경 없음)

| Method | Endpoint | 설명 | Request | Response |
|--------|----------|------|---------|----------|
| POST | `/api/v1/tasks/batch-delete` | 태스크 일괄 삭제 | `{ "taskIds": [1, 2, ...] }` | `{ "success": true, "deleted": N }` |

유효성 검사 유지 항목:
- `taskIds` 필드 누락 또는 List가 아닌 경우 → 400
- `taskIds` 빈 배열 → 400
- `taskIds` 요소가 숫자가 아닌 경우 → 400

### 3.3 서비스 계층 (변경 없음)

`TaskService.deleteTasksBatch()` 동작 그대로 유지:

```
1. taskIds를 DELETE_CHUNK_SIZE(100) 단위로 분할
2. chunk별로:
   a. taskRepository.findAllById(chunk) — 존재하는 태스크만 조회
   b. taskDependencyRepository.deleteByTaskIdIn(existingIds)
   c. taskDependencyRepository.deleteByDependsOnTaskIdIn(existingIds)
   d. taskLinkRepository.deleteByTaskIdIn(existingIds)
   e. taskRepository.deleteAll(existingTasks)
3. 총 삭제 건수 반환
```

### 3.4 프론트엔드 (변경 없음)

`app.js`의 다중 선택 삭제 로직은 이미 갯수 제한이 없으므로 수정 불필요.

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| 1 | 컨트롤러 제한 검사 제거 | `TaskController.java` line 122-127 블록 삭제 | 낮음 | 없음 |

### 4.2 구현 순서

1. `TaskController.java`에서 `taskIdRaw.size() > 1000` 조건 블록(6줄) 삭제

### 4.3 테스트 계획

- 1001개 이상 taskId를 담은 요청이 성공(200)으로 응답되는지 확인
- 기존 유효성 검사(빈 배열, 비숫자 요소)는 여전히 400을 반환하는지 확인
- 실제 삭제 후 `deleted` 카운트가 정확한지 확인

---

## 5. 리스크 및 고려사항

- **메모리 사용량**: 수만 건 이상의 taskId를 요청 body로 받을 경우 JVM 힙 압박이 생길 수 있음. 그러나 일반적인 프로젝트 태스크 수가 수천 건 이내임을 고려하면 현실적 위험은 낮음.
- **트랜잭션 시간**: chunk 처리로 분산되지만 단일 `@Transactional` 내에서 실행되므로, 매우 많은 건수(예: 10만 건)에서는 트랜잭션 타임아웃이 발생할 수 있음. 현재 사용 패턴상 위험도는 낮음.
- **완화 방안**: 필요 시 향후 타임아웃 설정(`@Transactional(timeout=...)`) 또는 페이지 단위 분리 처리로 확장 가능.

---

## 6. 참고 사항

- 변경 파일: `src/main/java/com/timeline/controller/TaskController.java`
- 변경 없는 파일: `src/main/java/com/timeline/service/TaskService.java`, `src/main/resources/static/js/app.js`
- 관련 계획서: `docs/dev-plan/26-batch-delete-chunk-status-filter-jira-status-filter.md` (chunk 처리 도입 배경)
