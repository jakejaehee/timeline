# 개발 계획서: sprintEndDate 종료일 폴백 제거

## 1. 개요

- **기능 설명**: Jira Import 시 Task의 `endDate`를 결정하는 폴백 체인에서 `sprintEndDate` 단계를 제거하고, 관련된 모든 코드(DTO 필드, API 호출 파라미터, 파싱 메서드)를 함께 삭제한다.
- **개발 배경 및 목적**: 스프린트가 종료되어도 미완료 티켓은 다음 스프린트로 자동 이월되는 것이 일반적인 Jira 운영 방식이다. 따라서 `sprintEndDate`를 `endDate` 폴백으로 사용하면 실제 작업 종료 기대일과 무관한 날짜가 Task에 기록되는 문제가 발생한다. 이 로직을 제거하여 날짜 매핑의 정확성을 높인다.
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: `endDate` 폴백 체인을 `dueDate → resolutionDate → 기존값/today` 로 단순화한다.
- FR-002: `JiraDto.JiraIssue.sprintEndDate` 필드를 제거한다.
- FR-003: `JiraApiClient`의 `BOARD_FIELDS` 상수에서 `customfield_10020`(Sprint 커스텀 필드)를 제거한다. 이 상수는 Board API(`fetchAllBoardIssues`)와 Search API 폴백(`fetchIssuesByJql`) 양쪽에서 공유되므로, 한 번의 수정으로 두 경로 모두에 적용된다.
- FR-004: `JiraApiClient.extractSprintEndDate()` 메서드 전체를 삭제한다.
- FR-005: `JiraApiClient.parseIssue()` 내 Sprint 종료일 파싱 코드 2줄(추출 호출 + builder 매핑)을 삭제한다.
- FR-006: `JiraImportService.resolveEndDateForUpdate()` 에서 `sprintEndDate` 폴백 분기(`if (issue.getSprintEndDate() != null)`)를 제거한다.
- FR-007: `JiraImportService.resolveEndDateForCreate()` 에서 동일한 `sprintEndDate` 폴백 분기를 제거한다.
- FR-008: `JiraImportService`의 `importIssues()` 내 인라인 주석 중 `sprintEndDate` 언급 부분을 수정한다.
- FR-009: `JiraImportService.resolveEndDateForUpdate()` Javadoc에서 3번 항목(`sprintEndDate`) 제거, 기존 4번 항목 번호를 3번으로 조정한다.
- FR-010: `JiraImportService.resolveEndDateForCreate()` Javadoc에서 동일하게 수정한다.
- FR-011: Jira Import 미리보기 테이블의 Jira Key 셀을 편집 불가(readonly)로 변경한다. `input[type=text]`의 `readonly` 속성을 추가하고, `executeJiraImport()`의 `jiraKeyOverrides` 수집 코드(`.jira-key-override` 순회 구간)를 제거한다.

### 2.2 비기능 요구사항

- NFR-001: 기능 변경은 Jira Import 흐름에만 한정되며, 다른 서비스(TaskService, ProjectService 등)에는 영향이 없어야 한다.
- NFR-002: Jira API 호출 시 전송되는 `fields` 파라미터에서 불필요한 `customfield_10020`이 제거되어 응답 페이로드 크기가 소폭 감소한다.

### 2.3 가정 사항

- `customfield_10020`은 Sprint 정보 전용으로, 이 필드 제거가 story points(`customfield_10016`, `customfield_10028`) 등 다른 커스텀 필드 파싱에 영향을 주지 않는다.
- `sprintEndDate` 필드를 참조하는 다른 코드(컨트롤러, 기타 서비스)는 존재하지 않는다.

### 2.4 제외 범위 (Out of Scope)

- Sprint 정보 자체를 활용하는 기능 추가(스프린트 이름 표시, 스프린트 기반 필터 등)는 이번 작업에 포함하지 않는다.
- `JiraDto.JiraIssue`의 다른 필드 구조 변경은 포함하지 않는다.

---

## 3. 시스템 설계

### 3.1 변경 대상 파일 요약

| 파일 | 변경 유형 | 변경 내용 요약 |
|------|-----------|----------------|
| `src/main/java/com/timeline/dto/JiraDto.java` | 필드 제거 | `JiraIssue.sprintEndDate` 필드 삭제 |
| `src/main/java/com/timeline/service/JiraApiClient.java` | 상수 수정 / 메서드 삭제 / 파싱 코드 제거 | `BOARD_FIELDS`에서 `customfield_10020` 제거, `extractSprintEndDate()` 삭제, `parseIssue()` 내 호출부 2줄 제거 |
| `src/main/java/com/timeline/service/JiraImportService.java` | 분기 제거 / 주석 수정 | `resolveEndDateForUpdate()`, `resolveEndDateForCreate()` 에서 `sprintEndDate` 분기 제거, Javadoc 및 인라인 주석 수정 |
| `src/main/resources/static/js/app.js` | UI 변경 / 코드 제거 | `startJiraPreview()` 내 Jira Key `input`에 `readonly` 속성 추가, `executeJiraImport()` 내 `jiraKeyOverrides` 수집 코드 제거 |

### 3.2 변경 전후 endDate 폴백 체인

**변경 전**
```
dueDate → resolutionDate → sprintEndDate → 기존값(UPDATE) / null(CREATE)
```

**변경 후**
```
dueDate → resolutionDate → 기존값(UPDATE) / null(CREATE)
```

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 파일 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `JiraDto.JiraIssue`에서 `sprintEndDate` 필드 제거 | `JiraDto.java` | 낮음 | 없음 |
| T-02 | `BOARD_FIELDS` 상수에서 `customfield_10020` 제거 | `JiraApiClient.java` | 낮음 | 없음 |
| T-03 | `extractSprintEndDate()` 메서드 전체 삭제 | `JiraApiClient.java` | 낮음 | T-04 완료 후 (호출부 먼저 제거해야 컴파일 오류 없이 메서드 삭제 가능) |
| T-04 | `parseIssue()` 내 Sprint 파싱 코드 2줄 제거 | `JiraApiClient.java` | 낮음 | T-01 |
| T-05 | `resolveEndDateForUpdate()` sprintEndDate 분기 제거 및 Javadoc 수정 | `JiraImportService.java` | 낮음 | T-01 |
| T-06 | `resolveEndDateForCreate()` sprintEndDate 분기 제거 및 Javadoc 수정 | `JiraImportService.java` | 낮음 | T-01 |
| T-07 | `importIssues()` 인라인 주석 수정 | `JiraImportService.java` | 낮음 | T-05, T-06 |
| T-08 | 미리보기 테이블 Jira Key `input`에 `readonly` 추가 및 `jiraKeyOverrides` 수집 코드 제거 | `app.js` | 낮음 | 없음 |

### 4.2 구현 순서

1. **Step 1 — DTO 필드 제거 (T-01)**
   `JiraDto.java` 의 `JiraIssue` 클래스에서 `sprintEndDate` 필드를 제거한다.

   ```java
   // 제거 대상 (JiraDto.java, line 58)
   private LocalDate sprintEndDate;    // Sprint 최소 종료일 파싱 결과
   ```

2. **Step 2 — API fields 파라미터 수정 (T-02)**
   `JiraApiClient.java` 의 `BOARD_FIELDS` 상수에서 `,customfield_10020` 를 제거한다.

   ```java
   // 변경 전 (line 36)
   private static final String BOARD_FIELDS = "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,story_points,dueDate,description,resolutiondate,customfield_10020";

   // 변경 후
   private static final String BOARD_FIELDS = "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,story_points,dueDate,description,resolutiondate";
   ```

3. **Step 3 — parseIssue() 내 Sprint 파싱 코드 제거 (T-04)**
   `JiraApiClient.java` 의 `parseIssue()` 메서드에서 아래 2개 위치의 코드를 제거한다.

   ```java
   // 제거 대상 위치 1 (lines 300~301): 주석과 호출문
   // Sprint 종료일 (customfield_10020)
   LocalDate sprintEndDate = extractSprintEndDate(fields.get("customfield_10020"));
   ```

   ```java
   // 제거 대상 위치 2 (line 313): builder 매핑
   .sprintEndDate(sprintEndDate)
   ```

4. **Step 4 — extractSprintEndDate() 메서드 전체 삭제 (T-03)**
   `JiraApiClient.java` 의 `extractSprintEndDate()` 메서드(lines 323~363) 전체를 삭제한다(`@SuppressWarnings("unchecked")` 어노테이션 line 323 포함). 해당 메서드는 Step 3 이후 더 이상 호출되지 않는다.

5. **Step 5 — resolveEndDateForUpdate() 수정 (T-05)**
   `JiraImportService.java` 에서 `sprintEndDate` 폴백 분기와 Javadoc 항목을 제거한다.

   ```java
   // 변경 전 Javadoc (lines 288~292)
   * 1. dueDate가 null이 아니면 사용
   * 2. null이면 resolutionDate 시도
   * 3. null이면 sprintEndDate 시도
   * 4. 모두 null이면 기존 existing.getEndDate() 유지

   // 변경 후 Javadoc
   * 1. dueDate가 null이 아니면 사용
   * 2. null이면 resolutionDate 시도
   * 3. 모두 null이면 기존 existing.getEndDate() 유지
   ```

   ```java
   // 제거 대상 메서드 본문 (lines 301~303)
   if (issue.getSprintEndDate() != null) {
       return issue.getSprintEndDate();
   }
   ```

6. **Step 6 — resolveEndDateForCreate() 수정 (T-06)**
   `JiraImportService.java` 에서 동일하게 `sprintEndDate` 폴백 분기와 Javadoc 항목을 제거한다.

   ```java
   // 변경 전 Javadoc (lines 308~312)
   * 1. dueDate가 null이 아니면 사용
   * 2. null이면 resolutionDate 시도
   * 3. null이면 sprintEndDate 시도
   * 4. 모두 null이면 null 그대로 전달 (resolveDatePair가 startDate로 채움)

   // 변경 후 Javadoc
   * 1. dueDate가 null이 아니면 사용
   * 2. null이면 resolutionDate 시도
   * 3. 모두 null이면 null 그대로 전달 (resolveDatePair가 startDate로 채움)
   ```

   ```java
   // 제거 대상 메서드 본문 (lines 321~323)
   if (issue.getSprintEndDate() != null) {
       return issue.getSprintEndDate();
   }
   ```

7. **Step 7 — importIssues() 인라인 주석 수정 (T-07)**
   `JiraImportService.java` 의 `importIssues()` 내 두 인라인 주석을 수정한다.

   ```java
   // 변경 전 (line 219)
   // endDate 폴백: dueDate -> resolutionDate -> sprintEndDate -> 기존 값 유지

   // 변경 후
   // endDate 폴백: dueDate -> resolutionDate -> 기존 값 유지
   ```

   ```java
   // 변경 전 (line 237)
   // endDate 폴백: dueDate -> resolutionDate -> sprintEndDate -> null

   // 변경 후
   // endDate 폴백: dueDate -> resolutionDate -> null
   ```

8. **Step 8 — 미리보기 테이블 Jira Key readonly 처리 (T-08)**
   `app.js` 의 `startJiraPreview()` 함수에서 Jira Key 셀의 `input` 태그에 `readonly` 속성을 추가한다. 아울러 `executeJiraImport()` 함수에서 `jiraKeyOverrides` 수집 코드를 제거하고, Import 요청 body에서 `jiraKeyOverrides`를 전송하지 않도록 한다.

   ```js
   // 변경 전 (lines 4799~4801): 편집 가능한 input
   html += '<td><input type="text" class="form-control form-control-sm jira-key-override" '
         + 'value="' + jiraKeyVal + '" data-original-key="' + jiraKeyVal + '" '
         + 'maxlength="50" style="min-width:80px; max-width:140px;"></td>';

   // 변경 후: readonly 속성 추가, 커서 불가 스타일 적용
   html += '<td><input type="text" class="form-control form-control-sm" '
         + 'value="' + jiraKeyVal + '" '
         + 'maxlength="50" style="min-width:80px; max-width:140px;" readonly></td>';
   ```

   ```js
   // 제거 대상 (lines 4843~4851): jiraKeyOverrides 수집 블록 전체
   // jiraKeyOverrides 수집: 원본과 다른 값만 포함
   var overrides = {};
   document.querySelectorAll('.jira-key-override').forEach(function(input) {
       var orig = input.dataset.originalKey;
       var val = input.value.trim();
       if (orig && val && val !== orig) {
           overrides[orig] = val;
       }
   });
   ```

   ```js
   // 제거 대상 (lines 4857~4859): overrides 전송 블록
   if (Object.keys(overrides).length > 0) {
       importBody.jiraKeyOverrides = overrides;
   }
   ```

   > **주의**: `data-original-key` 속성과 `jira-key-override` CSS 클래스도 더 이상 필요하지 않으므로 함께 제거한다.

### 4.3 테스트 계획

- **컴파일 확인**: `./gradlew compileJava` 로 빌드 오류 없음 확인 (특히 `sprintEndDate` 참조가 남아 있지 않은지 체크).
- **수동 통합 테스트**: Jira Import 실행 후 `dueDate`가 있는 이슈, `resolutionDate`만 있는 이슈, 둘 다 없는 이슈 각각의 `endDate` 매핑 결과 확인.
- **로그 확인**: `sprintEndDate` 관련 로그가 더 이상 출력되지 않는지 확인.
- **UI 확인**: 미리보기 테이블의 Jira Key 열이 readonly(편집 불가)로 렌더링되는지, 클릭 시 커서가 표시되지 않는지 확인.

---

## 5. 리스크 및 고려사항

- **영향 범위 최소**: 변경은 Jira Import 흐름(`JiraApiClient`, `JiraImportService`, `JiraDto`)에만 국한되어 다른 기능에 대한 사이드 이펙트가 없다.
- **API 필드 감소**: `customfield_10020` 제거로 Jira API 응답 크기가 소폭 감소하며, 이슈별로 Sprint 배열 직렬화가 생략되어 파싱 성능이 미미하게 개선된다.
- **데이터 변화**: 이미 Import된 기존 Task의 `endDate`는 변경되지 않는다. 이후 재Import 시에만 새로운 폴백 체인이 적용된다.

---

## 6. 참고 사항

- **관련 파일 경로**
  - `src/main/java/com/timeline/dto/JiraDto.java`
  - `src/main/java/com/timeline/service/JiraApiClient.java`
  - `src/main/java/com/timeline/service/JiraImportService.java`
  - `src/main/resources/static/js/app.js`
- **관련 계획서**
  - `docs/dev-plan/19-jira-integration.md` — Jira 연동 최초 설계
  - `docs/dev-plan/21-jira-import-enhancement.md` — Jira Import 개선 (필터/null보호/jiraKey편집/endDate폴백)
