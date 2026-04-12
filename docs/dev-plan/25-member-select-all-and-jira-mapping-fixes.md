# 개발 계획서: 멤버별 전체선택 및 Jira 매핑 버그 수정

## 1. 개요

- **기능 설명**: 프로젝트 화면의 배치 삭제 UI를 멤버별로 재구성하고, Jira Import 시 Story Points 및 담당자 매핑이 실패하는 버그를 수정한다.
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 프로젝트 화면 grouped 뷰에서 각 멤버 카드 헤더에 해당 멤버 태스크만 전체선택하는 체크박스와 선택 삭제 버튼을 배치한다.
- FR-002: 기존 상단의 전역 `project-batch-delete-toolbar`(전체선택 체크박스 + 선택삭제 버튼)를 grouped 뷰에서는 제거한다.
- FR-003: flat 뷰에서는 기존 방식(상단 전체선택 + 선택삭제)을 그대로 유지한다.
- FR-004: Jira Import 시 Story Points가 0 MD로 매핑되는 버그를 수정한다. `BOARD_FIELDS`에서 fields 파라미터를 올바르게 구성하고, Jira Cloud의 Story Points 커스텀 필드 파싱 로직을 개선한다.
- FR-005: Jira Import 시 담당자 매핑이 displayName 불일치로 실패하는 버그를 수정한다. `assignee.emailAddress`를 추가로 파싱하여 이메일 기반 fallback 매핑을 지원한다.

### 2.2 비기능 요구사항

- NFR-001: 멤버별 선택 삭제는 기존 `batchDeleteSelectedProjectTasks()` API 호출 방식을 재사용한다.
- NFR-002: 이메일 fallback 매핑은 Member 엔티티의 기존 `email` 필드를 활용하며 스키마 변경을 최소화한다.

### 2.3 가정 사항

- Jira Cloud REST API v3 기준이며, Story Points 필드는 `customfield_10016` (Story point estimate) 또는 `customfield_10028` (Story Points)로 저장된다.
- `story_points`는 Jira 서버(Data Center) 레거시 필드명으로, Jira Cloud API에서는 실제로 반환되지 않는다.
- Member 엔티티에 `email` 컬럼(`VARCHAR(200)`, nullable)이 이미 존재한다.
- displayName 매핑도 그대로 유지하되, email 매핑을 두 번째 우선순위로 추가한다.

### 2.4 제외 범위 (Out of Scope)

- flat 뷰의 멤버별 그룹 전체선택은 이번 범위에서 제외 (flat 뷰는 기존 상단 전체선택 유지)
- 비활성 태스크(HOLD/CANCELLED) 카드에 대한 멤버별 전체선택
- Jira 이슈 타입(issuetype) 필드 파싱
- Story Points 이외의 커스텀 필드 파싱 개선

---

## 3. 시스템 설계

### 3.1 버그 원인 분석

#### 버그 1: Story Points 항상 0 MD

**현재 코드** (`JiraApiClient.java`, line 36):
```java
private static final String BOARD_FIELDS =
    "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,story_points,dueDate,description,resolutiondate";
```

**문제점**:
1. `story_points`는 Jira Cloud REST API v3에서 유효한 필드 키가 아니다. Jira Cloud는 커스텀 필드를 `customfield_NNNNN` 형식으로만 반환한다. 따라서 API 요청 시 `story_points`를 포함해도 실제로 해당 키의 값은 반환되지 않는다.
2. `customfield_10016`과 `customfield_10028`은 Jira Cloud 인스턴스마다 실제 ID가 다를 수 있다. 그러나 Jira Cloud의 기본 Story Points 필드는 대부분 `customfield_10016`이다.
3. Jira Agile Board API (`/rest/agile/1.0/board/{id}/issue`)는 fields 파라미터를 통해 커스텀 필드를 요청하더라도, 특정 보드 구성에 따라 `customfield_10016` 값이 `null`이 아닌 Map 형태 `{"value": 5.0}` 또는 순수 숫자로 올 수 있다.
   - Jira Cloud "Next-gen" (Team-managed) 프로젝트: `customfield_10016`이 Double 값으로 바로 반환
   - Jira Cloud "Classic" (Company-managed) 프로젝트: `customfield_10028`을 사용하거나 `customfield_10016`이 Double 값으로 반환

**`extractStoryPoints()` 현재 동작**:
```java
Object value = fields.get(field);
if (value != null) {
    return new BigDecimal(value.toString());
}
```
- `value.toString()`이 `"5.0"`이면 정상 파싱됨
- `value`가 `null`이면 다음 후보로 넘어감
- 모든 후보가 `null`이면 `null` 반환 → `JiraImportService`에서 `manDays`를 null로 저장 (Task 엔티티에서 기본값 처리)

**실제 원인 가설**: `BOARD_FIELDS`에서 `customfield_10016`을 명시하고 있으므로 API 요청은 정상이다. 값이 모두 `null`로 오는 경우는:
- 해당 Jira 프로젝트가 Story Points를 아예 사용하지 않거나
- Story Points 커스텀 필드 ID가 `10016`, `10028` 둘 다 아닌 경우 (예: `customfield_10034`)

**해결 방향**:
1. `BOARD_FIELDS`에서 `story_points` 제거 (Jira Cloud에서 무의미한 필드)
2. `customfield_10016` 파싱 시 Double 외에 Map 형태도 처리 (Jira 버전별 응답 형태 차이 대응)
3. 로그를 추가하여 실제 필드값을 DEBUG 레벨로 출력 → 운영 환경에서 원인 추적 가능하게 함

#### 버그 2: 담당자 displayName 불일치

**현재 코드** (`JiraImportService.java`, line 372):
```java
private Map<String, Member> buildMemberMap() {
    return memberRepository.findByActiveTrue().stream()
            .collect(Collectors.toMap(
                    m -> m.getName().toLowerCase(),
                    m -> m,
                    (a, b) -> a
            ));
}
```

**현재 매핑 시도** (`JiraImportService.java`, line 176):
```java
Member mappedMember = issue.getAssigneeDisplayName() != null
        ? memberMap.get(issue.getAssigneeDisplayName().toLowerCase()) : null;
```

**문제점**:
- Jira displayName: `"Seyoung Lee"` (영어)
- 앱 Member name: `"이세영"` (한국어)
- 소문자 비교를 해도 문자 자체가 달라 매칭 불가

**`JiraIssue` DTO 현재 상태**: `assigneeEmail` 필드 없음
**`parseIssue()` 현재 상태**: `assigneeObj.get("emailAddress")` 파싱 없음

**해결 방향**:
1. `JiraIssue` DTO에 `assigneeEmail` 필드 추가
2. `parseIssue()`에서 `assigneeObj.get("emailAddress")` 파싱 추가
3. `buildMemberMap()`을 이름 맵 + 이메일 맵 두 개로 분리
4. 매핑 시 displayName 먼저 시도 → 실패 시 email로 fallback

### 3.2 데이터 모델

스키마 변경 없음. Member 엔티티의 `email` 필드가 이미 존재한다.

```
Member
  - id (PK)
  - name (VARCHAR 100, NOT NULL)
  - email (VARCHAR 200, nullable)  ← 이미 존재, 이번에 매핑에 활용
  - ...
```

### 3.3 API 설계

백엔드 API 변경 없음. 기존 `POST /api/v1/projects/{id}/jira/import` 및 `POST /api/v1/projects/{id}/jira/preview` 동작만 개선된다.

### 3.4 백엔드 변경 상세

#### 변경 파일 1: `JiraDto.java`

`JiraIssue` static inner class에 `assigneeEmail` 필드 추가:

```java
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public static class JiraIssue {
    private String key;
    private String summary;
    private String status;
    private String assigneeDisplayName;
    private String assigneeEmail;         // 추가: assignee.emailAddress
    private BigDecimal storyPoints;
    private LocalDate startDate;
    private LocalDate dueDate;
    private String description;
    private LocalDate resolutionDate;
}
```

#### 변경 파일 2: `JiraApiClient.java`

**변경 1: `BOARD_FIELDS`에서 `story_points` 제거**

```java
// 변경 전
private static final String BOARD_FIELDS =
    "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,story_points,dueDate,description,resolutiondate";

// 변경 후
private static final String BOARD_FIELDS =
    "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,dueDate,description,resolutiondate";
```

**변경 2: `parseIssue()`에서 `assigneeEmail` 파싱 추가**

```java
// assignee (기존 코드 위치: line 279~283)
String assigneeDisplayName = null;
String assigneeEmail = null;                                  // 추가
Map<String, Object> assigneeObj = (Map<String, Object>) fields.get("assignee");
if (assigneeObj != null) {
    assigneeDisplayName = (String) assigneeObj.get("displayName");
    assigneeEmail = (String) assigneeObj.get("emailAddress");  // 추가
}

// builder에 .assigneeEmail(assigneeEmail) 1행 추가
// 삽입 위치: .assigneeDisplayName(assigneeDisplayName) 바로 다음 행
return JiraDto.JiraIssue.builder()
        .key(key)
        .summary(truncate(summary, 300))
        .status(statusName)
        .assigneeDisplayName(assigneeDisplayName)
        .assigneeEmail(assigneeEmail)            // 추가
        .storyPoints(storyPoints)
        .startDate(startDate)
        .dueDate(dueDate)
        .description(description)
        .resolutionDate(resolutionDate)
        .build();
```

**변경 3: `extractStoryPoints()`에서 Map 형태 대응 및 로그 추가**

```java
private BigDecimal extractStoryPoints(Map<String, Object> fields) {
    String[] candidates = {"customfield_10016", "customfield_10028"};
    for (String field : candidates) {
        Object value = fields.get(field);
        if (value == null) continue;
        try {
            // 순수 숫자 (Double, Integer, etc.)
            if (value instanceof Number) {
                return new BigDecimal(value.toString());
            }
            // Map 형태: {"value": 5.0} - 일부 Jira 인스턴스
            if (value instanceof Map) {
                Object inner = ((Map<?, ?>) value).get("value");
                if (inner != null) {
                    return new BigDecimal(inner.toString());
                }
            }
            // String 형태
            String str = value.toString().trim();
            if (!str.isEmpty() && !str.equals("null")) {
                return new BigDecimal(str);
            }
        } catch (NumberFormatException e) {
            log.debug("Story Points 파싱 실패 (필드: {}, 값: {}): {}", field, value, e.getMessage());
        }
    }
    log.debug("Story Points 추출 실패. 후보 필드 모두 null 또는 파싱 불가. fields 키 목록: {}", fields.keySet());
    return null;
}
```

#### 변경 파일 3: `JiraImportService.java`

**변경 1: `buildMemberMap()`을 이름+이메일 복합 구조로 변경**

`buildMemberMap()` 메서드(line 372~379)를 `buildMemberMaps()`로 교체하고, `MemberMaps` 내부 클래스를 `JiraImportService` 클래스 본문의 `buildMemberMaps()` 메서드 바로 위에 추가한다.

```java
/**
 * 멤버 이름 맵 (소문자 키)과 이메일 맵을 함께 반환
 */
private static class MemberMaps {
    final Map<String, Member> byName;
    final Map<String, Member> byEmail;

    MemberMaps(Map<String, Member> byName, Map<String, Member> byEmail) {
        this.byName = byName;
        this.byEmail = byEmail;
    }
}

private MemberMaps buildMemberMaps() {
    List<Member> members = memberRepository.findByActiveTrue();
    Map<String, Member> byName = new HashMap<>();
    Map<String, Member> byEmail = new HashMap<>();
    for (Member m : members) {
        if (m.getName() != null) {
            byName.putIfAbsent(m.getName().toLowerCase(), m);
        }
        if (m.getEmail() != null && !m.getEmail().isBlank()) {
            byEmail.putIfAbsent(m.getEmail().toLowerCase(), m);
        }
    }
    return new MemberMaps(byName, byEmail);
}
```

**변경 2: 담당자 매핑 헬퍼 메서드 추가**

```java
/**
 * displayName → email 순으로 Member를 찾는다.
 */
private Member resolveMember(JiraDto.JiraIssue issue, MemberMaps maps) {
    if (issue.getAssigneeDisplayName() != null) {
        Member m = maps.byName.get(issue.getAssigneeDisplayName().toLowerCase());
        if (m != null) return m;
    }
    if (issue.getAssigneeEmail() != null) {
        Member m = maps.byEmail.get(issue.getAssigneeEmail().toLowerCase());
        if (m != null) {
            log.debug("Jira 담당자 이메일로 매핑: displayName='{}', email='{}' -> memberId={}",
                    issue.getAssigneeDisplayName(), issue.getAssigneeEmail(), m.getId());
            return m;
        }
    }
    if (issue.getAssigneeDisplayName() != null || issue.getAssigneeEmail() != null) {
        log.debug("Jira 담당자 매핑 실패: displayName='{}', email='{}'",
                issue.getAssigneeDisplayName(), issue.getAssigneeEmail());
    }
    return null;
}
```

**변경 3: `preview()` 및 `importIssues()`에서 `buildMemberMap()` → `buildMemberMaps()` + `resolveMember()` 사용**

`preview()` 변경 (line 94, 112~113):
```java
// 변경 전
Map<String, Member> memberMap = buildMemberMap();
...
Member mappedMember = issue.getAssigneeDisplayName() != null
        ? memberMap.get(issue.getAssigneeDisplayName().toLowerCase()) : null;

// 변경 후
MemberMaps memberMaps = buildMemberMaps();
...
Member mappedMember = resolveMember(issue, memberMaps);
```

`importIssues()` 변경 (line 160, 176~177):
```java
// 변경 전
Map<String, Member> memberMap = buildMemberMap();
...
Member mappedMember = issue.getAssigneeDisplayName() != null
        ? memberMap.get(issue.getAssigneeDisplayName().toLowerCase()) : null;

// 변경 후
MemberMaps memberMaps = buildMemberMaps();
...
Member mappedMember = resolveMember(issue, memberMaps);
```

### 3.5 프론트엔드 변경 상세

#### 변경 파일: `src/main/resources/static/js/app.js`

**변경 목표**: grouped 뷰에서 상단 전역 전체선택 제거 → 각 멤버 카드 헤더에 멤버별 전체선택 + 삭제 버튼 추가

**현재 구조 (문제점)**:
- `loadProjectTasks()`에서 항상 `project-batch-delete-toolbar`(전체선택 체크박스 + 선택삭제 버튼)를 상단에 렌더링
- grouped 뷰에서 선택 범위가 전체 프로젝트 태스크이므로 멤버 구분 없음

**변경 후 구조**:

1. `toggleHtml` 생성 시 grouped 뷰인 경우 전역 toolbar 제거:

   변경 대상: 기존 line 1006~1012 (toolbar div 생성 6행)을 아래 코드로 교체한다. 외부 wrapper `</div>` (기존 line 1013)는 변경하지 않는다.

   ```javascript
   // grouped 뷰: 상단 전체선택 toolbar 없음 (멤버별 카드 헤더에 배치)
   // flat 뷰: 기존 전역 toolbar 유지
   if (projectTaskViewMode === 'flat') {
       toggleHtml += '<div id="project-batch-delete-toolbar" class="d-flex align-items-center gap-2 ms-2">';
       toggleHtml += '<input type="checkbox" id="project-select-all" title="전체 선택">';
       toggleHtml += '<label for="project-select-all" class="mb-0" style="font-size:0.8rem;">전체 선택</label>';
       toggleHtml += '<button class="btn btn-danger btn-sm ms-2" id="project-batch-delete-btn" disabled>';
       toggleHtml += '<i class="bi bi-trash"></i> 선택 삭제 (<span id="project-selected-count">0</span>)';
       toggleHtml += '</button>';
       toggleHtml += '</div>';
   }
   // 기존 toggleHtml += '</div>'; (wrapper 닫힘 — 변경 없음) 은 이 블록 바로 다음에 유지
   ```

2. 멤버 카드 헤더(`card-header`)에 멤버별 전체선택 + 삭제 버튼 추가:

   현재 카드 헤더 구조:
   ```
   [사람아이콘] [이름] [착수일 입력] [저장] [재계산] [비가용일] ... [MD] [건수]
   ```

   변경 후 카드 헤더 구조:
   ```
   [사람아이콘] [이름] [착수일 입력] [저장] [재계산] [비가용일] ... [전체선택 체크박스] [선택삭제 버튼] [MD] [건수]
   ```

   구체적인 HTML 생성 코드 (grouped 뷰 멤버 카드 루프 내부):

   삽입 위치: `html += '<span class="text-muted ms-auto"...>` (MD 표시 span) **직전**에 추가한다. 실제 코드(line 1077)에서 `ms-auto`로 오른쪽 정렬되는 MD span 이전에 삽입해야 체크박스/버튼이 중앙에, MD와 건수가 오른쪽에 배치된다. 미배정 그룹(`isUnassigned`)에도 동일하게 추가한다.

   ```javascript
   // 멤버 카드 헤더에 멤버별 전체선택 추가
   // (삽입 위치: aTotalMd/aRemainMd span 직전)
   var memberSelectId = 'member-select-all-' + key;
   var memberDeleteBtnId = 'member-batch-delete-btn-' + key;
   var memberCountId = 'member-selected-count-' + key;

   html += '<input type="checkbox" id="' + memberSelectId + '" class="member-select-all-cb" '
       + 'data-member-key="' + key + '" title="이 멤버 태스크 전체 선택" style="cursor:pointer;">';
   html += '<button class="btn btn-danger btn-sm" id="' + memberDeleteBtnId + '" '
       + 'data-member-key="' + key + '" disabled style="padding:2px 8px; font-size:0.78rem;">'
       + '<i class="bi bi-trash"></i> 선택삭제(<span id="' + memberCountId + '">0</span>)'
       + '</button>';
   // 이후 기존 코드: html += '<span class="text-muted ms-auto" ...>MD</span>';
   ```

3. 이벤트 바인딩 (DOM 렌더링 후):

   - **멤버별 전체선택 체크박스** (`member-select-all-cb`):
     해당 `data-member-key`에 속한 `.project-task-checkbox[data-member-key="KEY"]` 체크박스만 선택/해제

   - **멤버별 삭제 버튼** (`member-batch-delete-btn-KEY`):
     `batchDeleteSelectedProjectTasks(projectId)`를 호출하되, 해당 멤버의 체크박스만 대상

   - **태스크 체크박스 변경 시** (`updateProjectSelectedCount`):
     - flat 뷰: 기존 전역 카운터 업데이트
     - grouped 뷰: 각 멤버별 카운터와 삭제 버튼 상태 업데이트, 멤버별 전체선택 체크박스 indeterminate 상태 처리

4. `renderProjectTaskItem()`에서 체크박스에 `data-member-key` 속성 추가:

   `renderProjectTaskItem()`은 grouped 뷰의 멤버 카드, grouped 뷰의 비활성 카드, flat 뷰 모두에서 호출된다. 비활성 태스크(§5.3 참조)는 grouped 뷰 비활성 카드에서 렌더링될 때 `data-member-key="inactive"`로 고정하여 멤버별 전체선택 집계에서 제외한다. 이를 위해 `renderProjectTaskItem()`에 `inactive` 여부를 나타내는 매개변수 대신, 태스크 상태(t.status)로 판별한다:

   ```javascript
   // 비활성 태스크(HOLD/CANCELLED)는 data-member-key="inactive",
   // 그 외는 assignee.id 또는 'unassigned'
   var memberKey = (t.status === 'HOLD' || t.status === 'CANCELLED')
       ? 'inactive'
       : (t.assignee && t.assignee.id ? t.assignee.id : 'unassigned');
   html += '<input type="checkbox" class="project-task-checkbox me-1" value="' + t.id + '" '
       + 'data-member-key="' + memberKey + '" '
       + 'onclick="event.stopPropagation(); updateProjectSelectedCount();">';
   ```

5. `updateProjectSelectedCount()` 개선:
   ```javascript
   function updateProjectSelectedCount() {
       if (projectTaskViewMode === 'flat') {
           // 기존 전역 카운터 로직 유지
           var checked = document.querySelectorAll('#project-tasks-content .project-task-checkbox:checked');
           var countEl = document.getElementById('project-selected-count');
           var deleteBtn = document.getElementById('project-batch-delete-btn');
           if (countEl) countEl.textContent = checked.length;
           if (deleteBtn) deleteBtn.disabled = (checked.length === 0);
           var allCbs = document.querySelectorAll('#project-tasks-content .project-task-checkbox');
           var selectAllCb = document.getElementById('project-select-all');
           if (selectAllCb) {
               selectAllCb.checked = allCbs.length > 0 && checked.length === allCbs.length;
           }
       } else {
           // grouped 뷰: 멤버별 카운터 업데이트
           document.querySelectorAll('.member-select-all-cb').forEach(function(cb) {
               var key = cb.getAttribute('data-member-key');
               var memberCbs = document.querySelectorAll(
                   '#project-tasks-content .project-task-checkbox[data-member-key="' + key + '"]');
               var memberChecked = document.querySelectorAll(
                   '#project-tasks-content .project-task-checkbox[data-member-key="' + key + '"]:checked');
               var countEl = document.getElementById('member-selected-count-' + key);
               var deleteBtn = document.getElementById('member-batch-delete-btn-' + key);
               if (countEl) countEl.textContent = memberChecked.length;
               if (deleteBtn) deleteBtn.disabled = (memberChecked.length === 0);
               // indeterminate 처리
               if (memberCbs.length === 0) {
                   cb.checked = false;
                   cb.indeterminate = false;
               } else if (memberChecked.length === 0) {
                   cb.checked = false;
                   cb.indeterminate = false;
               } else if (memberChecked.length === memberCbs.length) {
                   cb.checked = true;
                   cb.indeterminate = false;
               } else {
                   cb.checked = false;
                   cb.indeterminate = true;
               }
           });
       }
   }
   ```

6. 멤버별 전체선택 체크박스 이벤트 바인딩 (loadProjectTasks 내부, DOM 삽입 후):
   ```javascript
   if (projectTaskViewMode === 'grouped') {
       document.querySelectorAll('.member-select-all-cb').forEach(function(cb) {
           cb.addEventListener('change', function() {
               var key = this.getAttribute('data-member-key');
               var memberCbs = document.querySelectorAll(
                   '#project-tasks-content .project-task-checkbox[data-member-key="' + key + '"]');
               memberCbs.forEach(function(c) { c.checked = cb.checked; });
               updateProjectSelectedCount();
           });
       });
       document.querySelectorAll('[id^="member-batch-delete-btn-"]').forEach(function(btn) {
           btn.addEventListener('click', function() {
               var key = btn.getAttribute('data-member-key');
               batchDeleteSelectedProjectTasks(projectId, key);
           });
       });
   }
   ```

   Note: `batchDeleteSelectedProjectTasks()`는 전체 `project-task-checkbox:checked`를 수집하는데, 여러 멤버 그룹의 체크박스가 동시에 선택된 상태에서 특정 멤버 삭제 버튼을 누르면 **다른 멤버 태스크까지 삭제될 수 있다**. 이를 방지하기 위해 `batchDeleteSelectedProjectTasks()`에 선택적 `memberKey` 파라미터를 추가하여, grouped 뷰에서는 해당 멤버의 체크박스만 수집하도록 처리한다:

   ```javascript
   async function batchDeleteSelectedProjectTasks(projectId, memberKey) {
       if (projectBatchDeleteInProgress) return;
       var selector = '#project-tasks-content .project-task-checkbox:checked';
       // grouped 뷰 멤버별 삭제 버튼에서 호출 시 해당 멤버 체크박스만 대상
       if (memberKey != null) {
           selector = '#project-tasks-content .project-task-checkbox[data-member-key="'
               + memberKey + '"]:checked';
       }
       var checked = document.querySelectorAll(selector);
       if (checked.length === 0) return;
       if (!confirmAction(checked.length + '개 태스크를 삭제하시겠습니까?')) return;
       projectBatchDeleteInProgress = true;
       var taskIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
       try {
           var res = await apiCall('/api/v1/tasks/batch-delete', 'POST', { taskIds: taskIds });
           if (res.success) {
               showToast(res.deleted + '개 태스크가 삭제되었습니다.', 'success');
               await loadProjectTasks(projectId);
           } else {
               showToast(res.message || '삭제에 실패했습니다.', 'error');
           }
       } catch (e) {
           showToast('태스크 삭제에 실패했습니다.', 'error');
       } finally {
           projectBatchDeleteInProgress = false;
       }
   }
   ```

   flat 뷰 상단 삭제 버튼(기존 `batchDeleteSelectedProjectTasks(projectId)` 호출)은 `memberKey` 인수 없이 그대로 호출하면 기존 동작(전체 체크박스 수집)을 유지한다.

#### 변경 파일: `src/main/resources/static/index.html`

`schedule-batch-delete-toolbar`는 담당자 스케줄 화면 전용이므로 변경 없음.
프로젝트 화면 툴바는 `app.js`에서 동적으로 렌더링되므로 `index.html` 변경 없음.

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | JiraDto.JiraIssue에 `assigneeEmail` 필드 추가 | static inner class 필드 1개 추가 | 낮음 | - |
| T2 | JiraApiClient: assigneeEmail 파싱 추가 | `parseIssue()` 내 `emailAddress` 파싱, builder 추가 | 낮음 | T1 |
| T3 | JiraApiClient: BOARD_FIELDS에서 `story_points` 제거 | 상수 문자열 수정 | 낮음 | - |
| T4 | JiraApiClient: `extractStoryPoints()` 개선 | Number/Map/String 타입 분기, 로그 추가 | 낮음 | - |
| T5 | JiraImportService: `MemberMaps` 내부 클래스 + `buildMemberMaps()` 구현 | 이름 맵 + 이메일 맵 분리 | 낮음 | T1 |
| T6 | JiraImportService: `resolveMember()` 헬퍼 추가 | displayName → email fallback 매핑 | 낮음 | T5 |
| T7 | JiraImportService: `preview()` + `importIssues()` 매핑 로직 교체 | `buildMemberMap()` → `buildMemberMaps()` + `resolveMember()` | 낮음 | T5, T6 |
| T8 | app.js: `renderProjectTaskItem()` 체크박스에 `data-member-key` 추가 | 속성 1개 추가 | 낮음 | - |
| T9 | app.js: grouped 뷰 멤버 카드 헤더에 전체선택 + 삭제 버튼 HTML 추가 | 카드 헤더 HTML 생성 변경 | 중간 | T8 |
| T10 | app.js: flat 뷰에서만 전역 전체선택 toolbar 렌더링 | toggleHtml 생성 분기 처리 | 낮음 | T9 |
| T11 | app.js: `updateProjectSelectedCount()` grouped/flat 분기 처리 | 기존 함수 개선 | 중간 | T8, T9, T10 |
| T12 | app.js: 멤버별 이벤트 바인딩 추가 (`loadProjectTasks` 후반부) | 체크박스/버튼 이벤트 등록 | 중간 | T9, T11 |

### 4.2 구현 순서

1. **Step 1 - 백엔드 DTO**: `JiraDto.java` - `assigneeEmail` 필드 추가 (T1)
2. **Step 2 - 백엔드 API 클라이언트**: `JiraApiClient.java` - 3가지 변경 (T2, T3, T4)
3. **Step 3 - 백엔드 서비스**: `JiraImportService.java` - MemberMaps 구조 교체 (T5, T6, T7)
4. **Step 4 - 프론트엔드 렌더러**: `app.js` - `renderProjectTaskItem()` data-member-key 추가 (T8)
5. **Step 5 - 프론트엔드 UI**: `app.js` - 멤버 카드 헤더 + toolbar 분기 (T9, T10)
6. **Step 6 - 프론트엔드 이벤트**: `app.js` - `updateProjectSelectedCount()` 개선 + 이벤트 바인딩 (T11, T12)

### 4.3 테스트 계획

**Jira Story Points 버그 수정 검증**:
- Jira Board Import 실행 후 Story Points가 있는 이슈의 manDays가 정상 입력되는지 확인
- Story Points가 없는 이슈는 manDays가 null로 저장되는지 확인
- 로그에서 `customfield_10016` 필드값 출력 확인 (DEBUG 레벨)

**Jira 담당자 매핑 버그 수정 검증**:
- Jira displayName이 한국어 Member name과 다를 때 email 매핑이 동작하는지 확인
- Preview 결과에서 `mappedAssigneeName`이 올바른 멤버명으로 표시되는지 확인
- email도 없는 경우 담당자가 null로 처리되는지 확인

**멤버별 전체선택 UI 검증**:
- grouped 뷰에서 각 멤버 카드 헤더에 전체선택 체크박스와 삭제 버튼이 표시되는지 확인
- 특정 멤버의 전체선택 체크박스 클릭 시 해당 멤버 태스크만 선택되는지 확인
- 일부 선택 시 체크박스 indeterminate 상태 표시 확인
- 멤버별 선택 삭제 버튼 클릭 시 해당 멤버 태스크만 삭제되고 다른 멤버 태스크는 유지되는지 확인
- flat 뷰에서는 기존 상단 전체선택 toolbar가 정상 동작하는지 확인
- grouped → flat 뷰 전환 후 다시 grouped 전환 시 UI 상태가 올바르게 초기화되는지 확인

---

## 5. 리스크 및 고려사항

### 5.1 Story Points 필드 ID 문제

**리스크**: `customfield_10016`, `customfield_10028`이 모두 해당 Jira 인스턴스에 존재하지 않을 수 있다.

**완화 방안**: DEBUG 로그에서 필드 키 목록을 출력하도록 구현하여, 실제 필드 ID를 운영 환경에서 확인할 수 있게 한다. 향후 Jira Config 설정 화면에서 Story Points 필드 ID를 직접 입력할 수 있는 옵션을 추가하는 것을 고려할 수 있다 (현재 범위 외).

### 5.2 Jira 응답 스키마 변동

**리스크**: Jira Cloud 업데이트로 `customfield_10016`의 응답 형태(Number vs Map)가 변경될 수 있다.

**완화 방안**: `extractStoryPoints()`에서 Number, Map, String 세 가지 형태를 모두 처리하고, 예외 시 DEBUG 로그를 남겨 빠른 추적이 가능하게 한다.

### 5.3 멤버별 전체선택 + 비활성 태스크

비활성 태스크(HOLD/CANCELLED) 카드는 멤버별 그룹화 없이 단일 카드로 렌더링된다. 이 카드에는 멤버별 전체선택을 추가하지 않고 기존 개별 체크박스만 유지한다. 비활성 태스크의 체크박스는 `data-member-key="inactive"`로 설정하여 멤버별 카운터 업데이트 로직과 분리한다.

### 5.4 SortableJS 필터와 체크박스 충돌

SortableJS 초기화 시 `filter: 'input[type="checkbox"]'`가 이미 설정되어 있어 체크박스 클릭이 드래그를 방지한다. 멤버 카드 헤더에 추가하는 전체선택 체크박스는 SortableJS 대상 컨테이너(`.project-task-queue`, `.project-task-unordered`) 밖에 위치하므로 충돌이 없다.

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `src/main/java/com/timeline/service/JiraApiClient.java` - line 36: BOARD_FIELDS, line 316: extractStoryPoints()
- `src/main/java/com/timeline/service/JiraImportService.java` - line 372: buildMemberMap(), line 176: 담당자 매핑
- `src/main/java/com/timeline/dto/JiraDto.java` - line 46: JiraIssue 내부 클래스
- `src/main/java/com/timeline/domain/entity/Member.java` - line 38: email 필드
- `src/main/resources/static/js/app.js` - line 968: loadProjectTasks(), line 1006: toggleHtml 생성, line 1064: 멤버 카드 헤더 HTML, line 1273: updateProjectSelectedCount(), line 1315: renderProjectTaskItem()

### Jira Cloud REST API 참고

- Story Points 필드:
  - Jira Cloud Team-managed 프로젝트: `customfield_10016` (Story point estimate)
  - Jira Cloud Company-managed 프로젝트: `customfield_10028` (Story Points) 또는 `customfield_10016`
  - Jira Server/Data Center: `story_points` 또는 `customfield_10028` (인스턴스별 상이)
  - 응답 형태: 대부분 `Double` 숫자값 (예: `5.0`), 일부 Jira 버전에서 `{"value": 5.0}` Map 형태
- 담당자 필드:
  - `fields.assignee.displayName` - 표시 이름 (언어 설정에 따라 다름)
  - `fields.assignee.emailAddress` - 이메일 주소 (항상 영문 형태로 안정적)
  - `fields.assignee.accountId` - Jira Cloud 계정 ID (UUID 형태, 현재 미사용)
