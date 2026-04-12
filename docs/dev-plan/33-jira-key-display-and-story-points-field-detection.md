# 개발 계획서: Jira Key 텍스트 표시 & Story Points 필드 동적 탐지

## 1. 개요

### 기능 설명

두 가지 독립적인 Jira Import 버그를 수정한다.

1. **FR-01 — Jira Key 표시 방식 변경**: 미리보기 테이블의 Jira Key 셀이 현재 `<input type="text" readonly>`로 렌더링되어 긴 키가 잘려 보인다. `<code>` 텍스트로 교체하여 전체 키를 항상 표시한다.

2. **FR-02 — Story Points 필드 동적 탐지**: `JiraApiClient`가 특정 `customfield_*` ID(10016, 10028, 10004, 10025)만 하드코딩으로 요청하기 때문에, 사용자의 Jira 인스턴스에서 Story Points가 다른 ID를 사용하면 해당 필드가 API 응답에 포함되지 않아 공수(MD)가 항상 0으로 집계된다. Jira `/rest/api/3/field` 메타데이터 API로 실제 Story Points 필드 ID를 동적으로 탐지하여 해결한다.

### 개발 배경 및 목적

- Jira Cloud 인스턴스마다 Story Points에 쓰는 `customfield_*` 번호가 다르다. 하드코딩 4개 후보를 모두 빗나가면 MD 값이 항상 0이 된다.
- 미리보기 테이블의 readonly input 방식은 계획서 #21(jira-import-enhancement)에서 도입된 "jiraKey 인라인 편집" 기능의 유산이다. 해당 편집 기능은 현재 실제로 구현되어 있지 않으며(실행 시 jiraKeyOverrides 전송 로직 없음), jiraKey는 편집 불필요로 확정되었으므로 단순 텍스트 표시로 복원한다.

### 작성일

2026-04-13

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-01-1**: 미리보기 테이블에서 Jira Key 셀을 `<code>` 태그로 표시한다. `<input readonly>` 제거.
- **FR-01-2**: `<code>` 태그는 Bootstrap `font-monospace` 또는 inline style `white-space: nowrap`을 적용하여 긴 키가 줄바꿈 없이 표시되도록 한다.
- **FR-02-1**: `JiraApiClient`에 `findStoryPointsFieldId(baseUrl, email, apiToken)` 메서드를 추가한다. `GET /rest/api/3/field`를 호출하여 Story Points 후보 필드 ID를 반환한다.
- **FR-02-2**: 탐지 로직: 응답 배열에서 아래 조건 중 하나를 만족하는 항목의 `id`를 반환한다.
  - `name`이 `"Story Points"`, `"Story point estimate"`, `"Story Points Estimate"`, `"스토리 포인트"` 중 하나와 정확히 일치(대소문자 무시). `"Story point estimate"`는 Jira Cloud 기본 필드명이고, `"Story Points Estimate"` 는 일부 인스턴스에서 사용되는 변형명이다.
  - 위에서 못 찾으면: **`schema`가 null이 아니고** `schema.custom`이 `"com.atlassian.jira.plugin.system.customfieldtypes:float"` 이며 name에 "story" 또는 "point"가 포함(대소문자 무시)인 항목 중 첫 번째 `id` 반환. `schema`가 없는 시스템 필드는 이 조건에서 제외된다.
  - 위에서도 못 찾으면: `null` 반환 (기존 하드코딩 후보 목록으로 폴백)
- **FR-02-3**: `fetchAllBoardIssues()` 및 `fetchIssuesByJql()` 호출 시, 탐지된 필드 ID를 `BOARD_FIELDS` 동적 문자열에 추가하여 API 요청 `fields` 파라미터에 포함한다.
- **FR-02-4**: `extractStoryPoints()`에서 탐지된 필드 ID를 기존 하드코딩 후보 목록보다 **앞에 우선 시도**한다.
- **FR-02-5**: `findStoryPointsFieldId()` 호출이 실패(네트워크 오류, 권한 없음 등)하더라도 예외를 전파하지 않는다. `null` 반환 후 기존 동작으로 폴백한다.
- **FR-02-6**: `JiraImportService.preview()` 및 `importIssues()`에서 `fetchAllBoardIssues()` 호출 전에 `findStoryPointsFieldId()`를 먼저 호출하여 필드 ID를 확보한다.

### 2.2 비기능 요구사항

- **NFR-01**: `findStoryPointsFieldId()` 호출은 preview/import 당 1회만 수행한다 (루프 내 반복 호출 금지).
- **NFR-02**: 탐지된 필드 ID는 stateless하게 처리한다. 인스턴스 변수에 캐싱하지 않는다 (서버 재시작 없이 Jira 설정 변경 시 최신값 반영 필요).
- **NFR-03**: 탐지 결과는 INFO 레벨 로그로 출력하여 운영 중 디버깅을 지원한다.

### 2.3 가정 사항

- Jira Cloud의 `/rest/api/3/field` 엔드포인트는 인증된 사용자에게 항상 접근 가능하다.
- 응답 구조: 배열. 각 항목은 `{ "id": "...", "name": "...", "schema": { ... } }` 형태이며, **시스템 필드(summary, status 등)는 `schema` 키 자체가 없거나 `schema.custom`이 없다**. `schema.custom`은 오직 커스텀 필드(`customfield_XXXXX`)에만 존재한다. 2차 탐지 코드에서 `schema == null` 또는 `schema.custom == null`에 대한 null-safe 처리가 반드시 필요하다.

  응답 예시:
  ```json
  [
    { "id": "summary",         "name": "Summary" },
    { "id": "customfield_10016", "name": "Story Points",
      "schema": { "type": "number", "custom": "com.atlassian.jira.plugin.system.customfieldtypes:float", "customId": 10016 } }
  ]
  ```

- 동일 Jira 인스턴스에서 Story Points 필드 ID는 preview → import 사이에 변경되지 않는다.
- 현재 `app.js`의 `executeJiraImport()`에서는 jiraKeyOverrides를 수집하는 로직이 존재하지 않는다. FR-01에서 input을 제거하면 기존 동작에 영향 없다.

### 2.4 제외 범위 (Out of Scope)

- 탐지된 Story Points 필드 ID의 캐싱(TTL, 영속화 등)
- Story Points 이외 customfield 동적 탐지
- 미리보기 테이블에서 Jira Key 편집 기능 신규 구현

---

## 3. 시스템 설계

### 3.1 데이터 모델

변경 없음. 신규 엔티티, 컬럼 추가 없음.

### 3.2 API 설계

신규 엔드포인트 없음. 기존 엔드포인트 내부 동작만 변경.

| Method | Endpoint | 변경 사항 |
|--------|----------|----------|
| POST | `/api/v1/projects/{projectId}/jira/preview` | 내부적으로 findStoryPointsFieldId 선행 호출 |
| POST | `/api/v1/projects/{projectId}/jira/import` | 내부적으로 findStoryPointsFieldId 선행 호출 |

### 3.3 서비스 계층 설계

#### `JiraApiClient.java` — 변경

**신규 메서드: `findStoryPointsFieldId(String baseUrl, String email, String apiToken)`**

```
호출: GET {baseUrl}/rest/api/3/field
인증: 기존 createAuthHeaders() 재사용
응답 파싱:
  - 응답 타입: List<Map<String, Object>>  (배열 최상위)
  - 각 항목: { "id": "customfield_XXXXX", "name": "...", "schema": { "custom": "..." } }

탐지 순서:
  1) name이 "Story Points", "Story point estimate", "Story Points Estimate",
     "스토리 포인트" 중 하나와 equalsIgnoreCase 일치하는 항목의 id 반환
  2) 1)에서 없으면:
     schema != null
     AND schema.custom == "com.atlassian.jira.plugin.system.customfieldtypes:float"
     AND (name.toLowerCase() contains "story" OR name.toLowerCase() contains "point")
     인 항목 중 첫 번째 id 반환.
     (시스템 필드는 schema 자체가 없으므로 schema == null 체크가 반드시 필요)
  3) 모두 없으면: null 반환

예외 처리:
  - 모든 Exception catch → log.warn 후 null 반환 (예외 전파 금지)

로그:
  - 탐지 성공: log.info("[Jira] Story Points 필드 ID 동적 탐지 성공: {}", fieldId)
  - 탐지 실패(null): log.info("[Jira] Story Points 필드 ID 동적 탐지 실패. 기존 후보 목록으로 폴백.")
  - 예외 발생: log.warn("[Jira] /rest/api/3/field 호출 실패: {}. 기존 후보 목록으로 폴백.", e.getMessage())

반환값: String fieldId (nullable)
```

**변경: `fetchAllBoardIssues()` 시그니처 확장**

```java
// 기존
public List<JiraDto.JiraIssue> fetchAllBoardIssues(
        String baseUrl, String email, String apiToken,
        String boardId, LocalDate createdAfter, List<String> statusFilter)

// 변경 후
public List<JiraDto.JiraIssue> fetchAllBoardIssues(
        String baseUrl, String email, String apiToken,
        String boardId, LocalDate createdAfter, List<String> statusFilter,
        String storyPointsFieldId)  // nullable. null이면 기존 BOARD_FIELDS 그대로 사용
```

동적 fields 문자열 구성:

```java
// BOARD_FIELDS는 private static final 상수이므로 직접 수정 불가.
// 지역 변수 fields에 복사 후 필요 시 탐지된 ID를 추가한다.
String fields = BOARD_FIELDS;
if (storyPointsFieldId != null && !storyPointsFieldId.isBlank()
        && !BOARD_FIELDS.contains(storyPointsFieldId)) {
    fields = fields + "," + storyPointsFieldId;
}
```

이 `fields` 지역 변수를 `queryParam("fields", fields)`에 전달한다. (`BOARD_FIELDS` 상수를 직접 교체하지 않는다.)

`storyPointsFieldId`를 `parseIssue()` 및 `extractStoryPoints()`에 전달하기 위해
내부 루프에서 `parseIssue(issue, storyPointsFieldId)` 형태로 호출한다.

**변경: `fetchIssuesByJql()` 시그니처 동일 방식 확장**

```java
public List<JiraDto.JiraIssue> fetchIssuesByJql(
        String baseUrl, String email, String apiToken,
        String boardId, LocalDate createdAfter, List<String> statusFilter,
        String storyPointsFieldId)
```

`fetchAllBoardIssues()` 폴백 호출 시 `storyPointsFieldId`를 함께 전달한다.

```java
// 폴백 호출 위치 (기존 BadRequest catch 블록)
return fetchIssuesByJql(baseUrl, email, apiToken, boardId,
        createdAfter, statusFilter, storyPointsFieldId);
```

`fetchIssuesByJql()` 내부 이슈 루프에서도 `parseIssue(issue)`를 `parseIssue(issue, storyPointsFieldId)`로 변경해야 한다. 현재 코드(`JiraApiClient.java` line 238)에서 `fetchIssuesByJql()`도 `parseIssue(issue)`를 직접 호출하고 있으므로, `fetchAllBoardIssues()` 내부 루프 변경과 **반드시 함께 수정**해야 한다. 누락 시 폴백 경로에서만 storyPointsFieldId가 무시된다.

```java
// fetchIssuesByJql 내부 루프 (기존 line 238 근방)
// 변경 전: allIssues.add(parseIssue(issue));
// 변경 후:
allIssues.add(parseIssue(issue, storyPointsFieldId));
```

**변경: `parseIssue()` 시그니처 확장**

```java
// 기존 (private)
private JiraDto.JiraIssue parseIssue(Map<String, Object> issue)

// 변경 후
private JiraDto.JiraIssue parseIssue(Map<String, Object> issue, String storyPointsFieldId)
```

`storyPointsFieldId`를 `extractStoryPoints(fields, storyPointsFieldId)` 로 전달한다.

**변경: `extractStoryPoints()` 시그니처 확장 및 우선순위 변경**

```java
// 기존
private BigDecimal extractStoryPoints(Map<String, Object> fields)

// 변경 후
private BigDecimal extractStoryPoints(Map<String, Object> fields, String storyPointsFieldId)
```

후보 목록 구성:

```java
// storyPointsFieldId가 있으면 맨 앞에 추가
List<String> candidates = new ArrayList<>();
if (storyPointsFieldId != null && !storyPointsFieldId.isBlank()) {
    candidates.add(storyPointsFieldId);
}
// 기존 하드코딩 후보 (이미 포함된 경우 중복 방지)
for (String c : new String[]{"customfield_10016", "customfield_10028",
                               "customfield_10004", "customfield_10025"}) {
    if (!candidates.contains(c)) candidates.add(c);
}
```

이후 루프 로직은 기존과 동일.

**주의: `storyPointsFieldsLogged` 정적 플래그 처리**

현재 `JiraApiClient`에는 `private static volatile boolean storyPointsFieldsLogged = false;` 가 선언되어 있으며, `extractStoryPoints()` 내부에서 최초 1회 INFO 로그를 찍는 데 사용된다. 이 플래그는 JVM 생명주기 전체에 걸쳐 `true`로 유지되므로, 서버 재시작 없이 새 preview/import를 실행할 때도 재로그가 발생하지 않는다. 이는 허용 가능한 동작이며 변경 없이 유지한다. 단, `storyPointsFieldId` 파라미터가 추가된 이후에도 기존 `storyPointsFieldsLogged` 플래그 블록(Number 타입 customfield 목록 출력)은 그대로 유지하여, 동적 탐지 결과 검증 시 로그 확인이 가능하도록 한다.

#### `JiraImportService.java` — 변경

**`preview()` 변경:**

```java
// 기존 fetchAllBoardIssues 호출 직전에 추가
String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
        config.getBaseUrl(), config.getEmail(), config.getApiToken());

// 기존 호출 → storyPointsFieldId 추가
List<JiraDto.JiraIssue> issues = jiraApiClient.fetchAllBoardIssues(
        config.getBaseUrl(), config.getEmail(), config.getApiToken(),
        project.getJiraBoardId(), createdAfter, statusFilter, storyPointsFieldId);
```

**`importIssues()` 동일 방식 적용:**

```java
String storyPointsFieldId = jiraApiClient.findStoryPointsFieldId(
        config.getBaseUrl(), config.getEmail(), config.getApiToken());

List<JiraDto.JiraIssue> issues = jiraApiClient.fetchAllBoardIssues(
        config.getBaseUrl(), config.getEmail(), config.getApiToken(),
        project.getJiraBoardId(), createdAfter, statusFilter, storyPointsFieldId);
```

### 3.4 프론트엔드 (`app.js`)

**변경 위치: `app.js` line 5380-5382**

현재:

```javascript
html += '<td><input type="text" class="form-control form-control-sm" '
      + 'value="' + jiraKeyVal + '" '
      + 'maxlength="50" style="min-width:80px; max-width:140px;" readonly></td>';
```

변경 후:

```javascript
html += '<td><code>' + jiraKeyVal + '</code></td>';
```

변경 이유:
- readonly input은 셀 너비에 따라 텍스트가 잘린다.
- `<code>` 태그는 monospace 폰트로 Jira Key 형식(예: `PROJ-123`)을 명확히 구분하여 표시한다.
- `escapeHtml()`은 이미 적용된 값을 사용하므로 XSS 안전성 유지된다.

### 3.5 기존 시스템 연동

**영향 받는 파일:**

| 파일 | 변경 유형 | 비고 |
|------|----------|------|
| `src/main/java/com/timeline/service/JiraApiClient.java` | 메서드 추가 및 시그니처 확장 | `findStoryPointsFieldId()` 신규, `fetchAllBoardIssues()`, `fetchIssuesByJql()`, `parseIssue()`, `extractStoryPoints()` 시그니처 변경 |
| `src/main/java/com/timeline/service/JiraImportService.java` | 내부 호출 변경 | `findStoryPointsFieldId()` 선행 호출 + `fetchAllBoardIssues()` 파라미터 추가 |
| `src/main/resources/static/js/app.js` | 미리보기 테이블 렌더링 1줄 변경 | line ~5380 |

**영향 없는 파일:**

- `JiraImportController.java` — 시그니처 변경 없음
- `JiraDto.java` — 필드 추가 없음
- `index.html` — 변경 없음
- 기타 서비스/엔티티 — 변경 없음

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `app.js` Jira Key 표시 변경 | line 5380-5382: input → code 태그 | 낮음 | - |
| T-02 | `JiraApiClient` — `findStoryPointsFieldId()` 추가 | `/rest/api/3/field` 호출, 이름/스키마 기반 ID 탐지 | 중간 | - |
| T-03 | `JiraApiClient` — `fetchAllBoardIssues()` 시그니처 확장 | `storyPointsFieldId` 파라미터 추가, 동적 fields 구성 | 낮음 | T-02 |
| T-04 | `JiraApiClient` — `fetchIssuesByJql()` 시그니처 확장 | T-03과 동일 방식. 내부 루프의 `parseIssue(issue)` 호출도 `parseIssue(issue, storyPointsFieldId)`로 함께 변경해야 한다. | 낮음 | T-03 |
| T-05 | `JiraApiClient` — `parseIssue()`, `extractStoryPoints()` 확장 | 동적 fieldId 우선 적용 | 낮음 | T-02 |
| T-06 | `JiraImportService` — `preview()` 변경 | `findStoryPointsFieldId()` 선행 호출, 파라미터 전달 | 낮음 | T-02, T-03 |
| T-07 | `JiraImportService` — `importIssues()` 변경 | T-06과 동일 방식 | 낮음 | T-02, T-03 |

### 4.2 구현 순서

1. **Step 1: app.js 수정** (T-01)
   - 가장 단순하고 독립적인 변경. 먼저 완료.

2. **Step 2: JiraApiClient 확장** (T-02 → T-03 → T-04 → T-05)
   - `findStoryPointsFieldId()` 먼저 구현
   - `fetchAllBoardIssues()`, `fetchIssuesByJql()` 시그니처 확장 (컴파일 오류 방지를 위해 동시에)
   - `parseIssue()`, `extractStoryPoints()` 확장

3. **Step 3: JiraImportService 수정** (T-06, T-07)
   - Step 2 완료 후 컴파일 확인 → 서비스 측 호출 변경

### 4.3 테스트 계획

**수동 검증 시나리오:**

1. **FR-01 검증**: Jira Import 미리보기 실행 → 테이블에서 긴 키(예: `MYPROJECT-1234`)가 잘리지 않고 `<code>` 태그로 전체 표시됨을 확인한다.

2. **FR-02 검증 — 탐지 성공**:
   - 애플리케이션 로그에서 `[Jira] Story Points 필드 ID 동적 탐지 성공: customfield_XXXXX` 메시지 확인
   - Import 후 MD(manDays) 값이 0이 아닌 실제 Story Points 값으로 저장됨을 확인

3. **FR-02 검증 — 탐지 실패(폴백)**:
   - `/rest/api/3/field` 응답에서 일치 항목이 없는 경우 → 로그에 탐지 실패 메시지 출력 확인
   - 기존 하드코딩 4개 후보로 폴백하여 기존과 동일하게 동작함을 확인

4. **FR-02 검증 — API 호출 실패(폴백)**:
   - 잘못된 자격증명으로 테스트 시 → 예외 전파 없이 import가 정상 진행됨을 확인

**로그 확인 포인트:**

```
[Jira] Story Points 필드 ID 동적 탐지 성공: customfield_XXXXX
[Jira Debug] 첫 번째 이슈의 Number 타입 customfield 목록 (story points 후보): {...}
```

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

**R-01: `/rest/api/3/field` 엔드포인트 권한**
- 일부 Jira 플랜 또는 권한 설정에서 모든 필드 목록 조회가 제한될 수 있다.
- 대응: 예외 catch 후 `null` 반환 → 기존 하드코딩 후보로 폴백 (FR-02-5).

**R-02: Story Points 필드 이름의 다양성**
- "Effort", "Points", "SP" 등 커스터마이징된 이름 사용 시 name 기반 탐지 실패.
- 대응: 스키마 타입 기반 탐지(2차 탐지)로 커버. 그래도 실패하면 기존 후보 폴백.

**R-03: 동일 타입 필드 다수 존재**
- `customfieldtypes:float` 타입을 가진 Story Points가 아닌 다른 커스텀 필드(예: "예상 시간")가 먼저 탐지될 수 있다.
- 대응: 1차 탐지(name 정확 일치)를 우선하고, 2차 탐지는 name에 "story" 또는 "point" 포함 여부를 추가 조건으로 사용하여 범위를 좁힌다. 완벽한 해결책은 아니며 운영 중 로그를 통해 탐지 결과를 확인해야 한다.

**R-04: `fetchAllBoardIssues()` 시그니처 변경으로 컴파일 오류**
- `JiraImportService`에서 `fetchAllBoardIssues()` 호출 시 파라미터 개수가 맞지 않으면 컴파일 오류 발생.
- 대응: T-03(JiraApiClient 확장)과 T-06(JiraImportService 변경)을 동일 커밋에 적용하거나, JiraApiClient에서 기존 시그니처를 오버로드로 유지하다가 최종 정리한다. 계획서에서는 단일 변경으로 처리한다.

**R-05: `/rest/api/3/field` 응답에서 `schema` 필드 부재 → NullPointerException**
- 시스템 필드(예: `summary`, `status`, `assignee`)는 `schema` 키가 아예 없거나, 있어도 `schema.custom`이 없다. `findStoryPointsFieldId()` 2차 탐지 로직에서 `schema.custom`에 직접 접근하면 `NullPointerException` 발생.
- 대응: 구현 시 반드시 `schema != null && schema.get("custom") != null` 조건을 먼저 확인한다. `@SuppressWarnings("unchecked")`와 함께 `Map<String, Object>` 캐스팅 후 접근한다.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 역할 |
|------|------|
| `src/main/java/com/timeline/service/JiraApiClient.java` | Jira REST API 호출, 이슈 파싱. `BOARD_FIELDS` 상수 (line 41), `extractStoryPoints()` (line 460), `fetchAllBoardIssues()` (line 94) |
| `src/main/java/com/timeline/service/JiraImportService.java` | `preview()` (line 78), `importIssues()` (line 141) |
| `src/main/resources/static/js/app.js` | 미리보기 테이블 렌더링: line 5367-5392 |

### 참고 API

- [Jira REST API v3 — Get fields](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-get): `GET /rest/api/3/field` — 전체 필드 목록 반환, 인증 필요
- 응답 예시 (시스템 필드는 `schema` 없음, 커스텀 필드만 `schema.custom` 보유):
  ```json
  [
    {
      "id": "summary",
      "name": "Summary",
      "custom": false,
      "orderable": true,
      "navigable": true,
      "searchable": true,
      "clauseNames": ["summary"]
    },
    {
      "id": "customfield_10016",
      "name": "Story Points",
      "custom": true,
      "schema": {
        "type": "number",
        "custom": "com.atlassian.jira.plugin.system.customfieldtypes:float",
        "customId": 10016
      }
    },
    {
      "id": "customfield_10020",
      "name": "Sprint",
      "custom": true,
      "schema": {
        "type": "array",
        "items": "json",
        "custom": "com.pyxis.greenhopper.jira:gh-sprint",
        "customId": 10020
      }
    }
  ]
  ```
  Sprint 필드(`customfield_10020`)는 `schema.custom`이 `float`이 아니므로 2차 탐지에서 제외된다.

### 기존 계획서 참고

- `docs/dev-plan/19-jira-integration.md` — Jira 연동 초기 설계
- `docs/dev-plan/21-jira-import-enhancement.md` — jiraKey readonly input 도입 배경 (현재 계획서에서 해당 방식을 code 태그로 되돌림)
- `docs/dev-plan/32-jira-status-category-filter-and-gantt-sticky-header-fix.md` — 직전 Jira 관련 수정
