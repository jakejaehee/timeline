# API Design

모든 API는 `/api/v1` 접두사를 사용한다.

## 1. Member API

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/v1/members | 전체 멤버 목록 |
| GET | /api/v1/members/{id} | 멤버 상세 |
| POST | /api/v1/members | 멤버 생성 |
| PUT | /api/v1/members/{id} | 멤버 수정 |
| DELETE | /api/v1/members/{id} | 멤버 삭제 |

### Request Body (POST/PUT)
```json
{
  "name": "홍길동",
  "role": "ENGINEER",
  "email": "hong@company.com"
}
```

## 2. Domain System API

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/v1/domain-systems | 전체 도메인 시스템 목록 |
| GET | /api/v1/domain-systems/{id} | 도메인 시스템 상세 |
| POST | /api/v1/domain-systems | 도메인 시스템 생성 |
| PUT | /api/v1/domain-systems/{id} | 도메인 시스템 수정 |
| DELETE | /api/v1/domain-systems/{id} | 도메인 시스템 삭제 |

### Request Body (POST/PUT)
```json
{
  "name": "scm-hub",
  "description": "SCM Hub 시스템",
  "color": "#4A90D9"
}
```

## 3. Project API

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/v1/projects | 전체 프로젝트 목록 |
| GET | /api/v1/projects/{id} | 프로젝트 상세 (멤버, 도메인시스템 포함) |
| POST | /api/v1/projects | 프로젝트 생성 |
| PUT | /api/v1/projects/{id} | 프로젝트 수정 |
| DELETE | /api/v1/projects/{id} | 프로젝트 삭제 |
| POST | /api/v1/projects/{id}/members | 프로젝트에 멤버 추가 |
| DELETE | /api/v1/projects/{id}/members/{memberId} | 프로젝트에서 멤버 제거 |
| POST | /api/v1/projects/{id}/domain-systems | 프로젝트에 도메인 시스템 추가 |
| DELETE | /api/v1/projects/{id}/domain-systems/{domainSystemId} | 프로젝트에서 도메인 시스템 제거 |

### Request Body (POST/PUT Project)
```json
{
  "name": "SKU 시스템 개선",
  "type": "SKU_SYSTEM",
  "description": "SKU 관련 기능 개선 프로젝트",
  "startDate": "2026-04-15",
  "endDate": "2026-06-30",
  "status": "PLANNING"
}
```

### Request Body (POST members)
```json
{
  "memberId": 1
}
```

### Request Body (POST domain-systems)
```json
{
  "domainSystemId": 1
}
```

## 4. Task API

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/v1/projects/{projectId}/tasks | 프로젝트의 전체 태스크 (간트차트용) |
| GET | /api/v1/tasks/{id} | 태스크 상세 |
| POST | /api/v1/projects/{projectId}/tasks | 태스크 생성 |
| PUT | /api/v1/tasks/{id} | 태스크 수정 |
| DELETE | /api/v1/tasks/{id} | 태스크 삭제 |
| POST | /api/v1/tasks/{id}/dependencies | 의존관계 추가 |
| DELETE | /api/v1/tasks/{id}/dependencies/{dependsOnTaskId} | 의존관계 제거 |

### Request Body (POST/PUT Task)
```json
{
  "name": "API 개발",
  "domainSystemId": 1,
  "assigneeId": 3,
  "startDate": "2026-04-15",
  "endDate": "2026-04-25",
  "manDays": 8.0,
  "status": "PENDING",
  "sortOrder": 1
}
```

### Request Body (POST dependencies)
```json
{
  "dependsOnTaskId": 5
}
```

### GET /api/v1/projects/{projectId}/tasks Response (간트차트용)
```json
{
  "success": true,
  "data": {
    "project": {
      "id": 1,
      "name": "SKU 시스템 개선",
      "startDate": "2026-04-15",
      "endDate": "2026-06-30"
    },
    "domainSystems": [
      {
        "id": 1,
        "name": "scm-hub",
        "color": "#4A90D9",
        "tasks": [
          {
            "id": 1,
            "name": "API 개발",
            "assignee": {"id": 3, "name": "김엔지", "role": "ENGINEER"},
            "startDate": "2026-04-15",
            "endDate": "2026-04-25",
            "manDays": 8.0,
            "status": "IN_PROGRESS",
            "sortOrder": 1,
            "dependencies": [5]
          }
        ]
      }
    ]
  }
}
```

## 5. AI Parsing API

| Method | Path | 설명 |
|--------|------|------|
| POST | /api/v1/projects/{projectId}/tasks/parse | Free-text → 태스크 자동 생성 |

### Request Body
```json
{
  "text": "scm-hub: API 개발 김엔지 5md, DB 설계 박디비 3md, QA 테스트 이큐에이 2md\nscm-portal: 화면개발 최프론 8md → QA 테스트 이큐에이 3md"
}
```

### Response
```json
{
  "success": true,
  "data": {
    "parsed": [
      {
        "domainSystem": "scm-hub",
        "domainSystemMatched": true,
        "tasks": [
          {"name": "API 개발", "assignee": "김엔지", "assigneeMatched": true, "manDays": 5.0, "dependsOn": []},
          {"name": "DB 설계", "assignee": "박디비", "assigneeMatched": true, "manDays": 3.0, "dependsOn": []},
          {"name": "QA 테스트", "assignee": "이큐에이", "assigneeMatched": true, "manDays": 2.0, "dependsOn": []}
        ]
      },
      {
        "domainSystem": "scm-portal",
        "domainSystemMatched": true,
        "tasks": [
          {"name": "화면개발", "assignee": "최프론", "assigneeMatched": true, "manDays": 8.0, "dependsOn": []},
          {"name": "QA 테스트", "assignee": "이큐에이", "assigneeMatched": true, "manDays": 3.0, "dependsOn": ["화면개발"]}
        ]
      }
    ]
  }
}
```

> 참고: `dependsOn`은 미리보기 단계에서 태스크명(string) 배열로 반환한다. 저장 시(`saveParsedTasks`)에는 서버에서 태스크명을 저장된 Task ID로 변환하여 TaskDependency를 생성한다.

> 참고: `savedTaskIds`는 미리보기 단계에서는 포함되지 않으며, 저장 완료 후 응답에 포함된다.

### 저장 완료 Response
```json
{
  "success": true,
  "data": {
    "savedTaskIds": [10, 11, 12, 13, 14]
  }
}
```

## 6. Assignee Conflict Validation

태스크 생성/수정 시 담당자 일정 충돌 검증:
- 같은 담당자의 기존 태스크와 날짜가 하루라도 겹치면 에러 반환 (01-overview 제약조건: 한 담당자는 동시에 2개 이상 태스크 수행 불가)
- API 응답 예시:

```json
{
  "success": false,
  "error": "ASSIGNEE_CONFLICT",
  "message": "김엔지님은 2026-04-15 ~ 2026-04-20 기간에 이미 'DB 설계' 태스크가 배정되어 있습니다."
}
```
