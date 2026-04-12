# 개발 계획서: Jira Import 버그 수정 및 UX 개선

## 1. 개요

- **기능 설명**: Jira Import 모달의 상태 필터 오동작 수정, 생성일자 필터 필수 입력 적용, 공수(MD) 0으로 매핑되는 버그 수정, 착수일 캘린더 자동 저장, 프로젝트 태스크 탭 담당자별 아코디언 접기/펼치기 구현
- **개발 배경**: Jira Import 사용 중 "To Do" 상태 필터가 기대대로 동작하지 않고, MD가 항상 0으로 가져와지며, 착수일 저장에 버튼 클릭이 필요한 UX 불편함이 보고됨. 또한 프로젝트 태스크 탭에서 담당자가 많아질수록 화면이 길어져 접기/펼치기 기능이 필요해짐
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: Jira Import 모달에서 "To Do" 상태 필터 체크 시 Jira JQL에 `status in ("To Do")` 조건이 실제로 적용되어야 함. 한글 Jira 환경(`"할 일"`)도 동시에 처리해야 함
- **FR-002**: `createdAfter`(생성일자) 필드가 비어 있으면 미리보기/가져오기 버튼 클릭 시 경고 메시지를 표시하고 API 호출을 차단해야 함
- **FR-003**: Jira에서 story points를 가져올 때 0MD가 아닌 실제 값이 `manDays`에 매핑되어야 함. `BOARD_FIELDS`에 story points 관련 커스텀 필드가 누락된 경우 추가 필요. 디버그 로그를 통해 실제 수신 필드 키 목록 확인 필요
- **FR-004**: 일정관리 화면(assignee-schedule)에서 착수일 캘린더(`schedule-queue-start-date`)에서 날짜를 선택하는 즉시 자동 저장. "착수일 저장" 버튼 제거
- **FR-005**: 프로젝트 태스크 탭(grouped 뷰)에서 담당자 카드 헤더를 클릭하면 해당 담당자의 태스크 목록(`card-body`)이 접히고 펼쳐지는 아코디언 동작. 초기 상태는 모두 펼쳐진 상태. 접힘 상태는 페이지 재로드 시 리셋됨
- **FR-006**: 프로젝트 태스크 탭의 담당자 카드 헤더에도 착수일 캘린더 자동 저장 적용 (저장 버튼 제거, 날짜 선택 시 즉시 저장)

### 2.2 비기능 요구사항

- **NFR-001**: FR-004, FR-006의 자동 저장은 flatpickr `onChange` 콜백에서 처리하며, API 호출 실패 시 `showToast`로 에러 메시지 표시
- **NFR-002**: FR-005 아코디언 상태는 메모리에만 유지하고 localStorage에 저장하지 않음
- **NFR-003**: FR-003 story points 디버깅을 위해 실제 fields 키 목록을 `INFO` 레벨로 로깅 추가 (최초 이슈 파싱 시 1회 출력)

### 2.3 가정 사항

- story points 버그의 원인은 Jira Cloud 인스턴스마다 실제 customfield 번호가 달라 `customfield_10016`/`customfield_10028`이 맞지 않는 경우일 것으로 추정. `BOARD_FIELDS`에는 이미 두 후보가 포함되어 있으므로 누락이 원인인 경우는 아님
- "To Do" 필터 오동작의 가장 유력한 원인은 한글 Jira 워크플로에서 실제 상태명이 `"To Do"`가 아닌 `"할 일"` 등이어서 JQL이 빈 결과를 반환하거나, 실제로는 `statusFilter`가 서버에 전달되지 않는 경우
- 착수일 자동 저장 시 FR-004(일정관리 화면)와 FR-006(프로젝트 태스크 탭)은 동일한 API(`PATCH /api/v1/members/{memberId}/queue-start-date`)를 사용하므로 백엔드 변경은 불필요

### 2.4 제외 범위 (Out of Scope)

- Jira에서 story points 이외의 다른 커스텀 필드 추가 매핑
- 착수일 자동 저장 시 재계산(`recalculate-queue`) 자동 실행
- 아코디언 상태의 localStorage 영속화
- "전체(필터 없음)" 체크박스 UX 개선 (현재 구조 유지)

---

## 3. 시스템 설계

### 3.1 버그 원인 분석

#### FR-001: To Do 필터 오동작

**원인 후보 1**: `ALLOWED_STATUS_VALUES`에 한글 상태명(`"할 일"`, `"진행 중"`, `"완료"` 등)이 없음

```java
// JiraApiClient.java line 40-43
private static final Set<String> ALLOWED_STATUS_VALUES = Set.of(
    "To Do", "In Progress", "Done", "In Review",
    "Open", "Closed", "Resolved", "Backlog", "On Hold", "Blocked", "Cancelled"
);
```

한글 Jira 환경에서 `statusFilter = ['To Do']`를 보내더라도 allowlist 필터링 후 `safe` 리스트에서 탈락하면 JQL에 status 조건이 생성되지 않아 전체 이슈가 반환됨

**원인 후보 2**: 프론트에서 `statusFilter = ['To Do']`를 body에 담아 POST하지만, 실제로 Jira 인스턴스의 워크플로 상태명이 `"To Do"`가 아닌 다른 이름인 경우 Jira API가 결과 0건을 반환하거나 무시함

**수정 방향**:
- `ALLOWED_STATUS_VALUES`에 한글 상태명 추가
- 프론트엔드 체크박스 `value` 속성을 영문/한글 모두 커버하도록 개선하거나, UI에 디버그 힌트 표시

#### FR-003: story points 0MD 버그

**원인**: `BOARD_FIELDS` 상수에서 `customfield_10016`, `customfield_10028`을 지정하고 있으나:
1. Board API는 `fields` 파라미터에 명시된 필드만 반환함
2. 일부 Jira Cloud 인스턴스에서는 story points 필드 ID가 `customfield_10016`이나 `customfield_10028`이 아닌 다른 번호일 수 있음 → 해당 번호가 `fields`에 없으면 응답에 포함되지 않아 항상 null 반환

> 참고: `story_points`는 Jira Cloud REST API의 유효한 `fields` 파라미터 값이 아니다. 응답 `fields` 맵 내에 해당 키로 값이 포함되지 않으므로 `BOARD_FIELDS`에 추가해도 효과가 없다.

```java
// 현재 코드 (JiraApiClient.java line 37)
private static final String BOARD_FIELDS =
    "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,dueDate,description,resolutiondate";
```

**수정 방향**:
- `BOARD_FIELDS`는 현행 유지. `story_points`는 추가하지 않음
- `extractStoryPoints()` 에서 fields에서 실제 받은 키 목록을 INFO 레벨로 1회 로깅하여, 어떤 필드명으로 오는지 확인할 수 있게 함
- 로그 확인 후 실제 story points 필드 ID를 `BOARD_FIELDS`에 추가하는 후속 대응 가능

### 3.2 API 설계

변경 없음. 기존 API를 그대로 사용:

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/projects/{projectId}/jira/preview` | Jira Import 미리보기 |
| POST | `/api/v1/projects/{projectId}/jira/import` | Jira Import 실행 |
| PATCH | `/api/v1/members/{memberId}/queue-start-date` | 착수일 저장 (기존 API) |

### 3.3 서비스 계층 변경 사항

**변경 파일**: `src/main/java/com/timeline/service/JiraApiClient.java`

변경 1: `BOARD_FIELDS`는 현행 유지 (변경 불필요)

`story_points`는 Jira Cloud REST API의 유효한 `fields` 파라미터 값이 아니다. Jira Cloud의 Agile Board API(`/rest/agile/1.0/board/{boardId}/issue`)는 `fields`에 `story_points`를 명시해도 해당 이름으로 응답을 반환하지 않는다. story points는 인스턴스에 따라 `customfield_10016`, `customfield_10028`, 또는 다른 번호의 커스텀 필드로만 응답에 포함된다. 따라서 `BOARD_FIELDS`에 `story_points`를 추가하는 것은 API 응답에 영향을 주지 않으므로 추가하지 않는다.

변경 2: `ALLOWED_STATUS_VALUES`에 한글 상태명 추가

```java
private static final Set<String> ALLOWED_STATUS_VALUES = Set.of(
    "To Do", "In Progress", "Done", "In Review",
    "Open", "Closed", "Resolved", "Backlog", "On Hold", "Blocked", "Cancelled",
    // 한글 Jira 워크플로 상태명
    "할 일", "진행 중", "완료", "검토 중", "열려 있음", "백로그", "보류", "차단됨", "취소됨", "해결됨", "닫힘"
);
```

변경 3: `extractStoryPoints()` 디버그 로그 강화 — 최초 호출 시 fields 키 목록 INFO 로깅

후보 필드 배열에 `story_points`는 추가하지 않는다. `story_points`는 Jira Cloud Agile API 응답의 `fields` 맵에 해당 키로 값이 포함되지 않으므로 추가해도 항상 null이 반환된다. 후보 배열은 `{"customfield_10016", "customfield_10028"}` 현행 유지.

디버그 로그는 기존에 이미 Story Points 추출 실패 시 `fields.keySet()`을 DEBUG 레벨로 출력하고 있다(line 381). 이를 **최초 이슈 파싱 1회에 한해 INFO 레벨로 승격**하여 로그에서 바로 확인할 수 있게 한다.

```java
// extractStoryPoints() 메서드: 첫 번째 이슈 파싱 시 INFO 로깅 (1회만)
private static volatile boolean storyPointsFieldsLogged = false;

private BigDecimal extractStoryPoints(Map<String, Object> fields) {
    if (!storyPointsFieldsLogged) {
        storyPointsFieldsLogged = true;
        log.info("[Jira Debug] 첫 번째 이슈의 fields 키 목록: {}", fields.keySet());
    }
    String[] candidates = {"customfield_10016", "customfield_10028"};
    // ... 기존 파싱 로직 유지 ...
}
```

> 주의: `storyPointsFieldsLogged` 플래그는 JVM 재시작 전까지 유지된다. 디버깅 목적으로만 사용하고, 확인 후 제거하거나 DEBUG 레벨로 되돌린다.

### 3.4 프론트엔드 변경 사항

#### 3.4.1 FR-001: To Do 필터 — HTML/JS 변경

**`index.html` 변경**: 상태 필터 체크박스 안내 문구에 한글 상태 지원 여부 설명 추가 (선택 사항)

**`app.js` 변경 없음**: 체크박스 value는 그대로 영문 유지. 백엔드의 `ALLOWED_STATUS_VALUES` 수정으로 해결.

단, 실제로 Jira 인스턴스의 상태명이 한글인 경우 사용자는 "할 일" 필터를 직접 선택할 방법이 없으므로, 향후 개선이 필요함 (현재 범위에서는 allowlist 확장으로만 대응).

#### 3.4.2 FR-002: 생성일자 필수 입력 — `app.js` `startJiraPreview()` 수정

`startJiraPreview()` 함수 상단에 `createdAfter` 빈 값 검증 추가:

```javascript
async function startJiraPreview() {
    if (!jiraImportProjectId) return;

    var createdAfterVal = document.getElementById('jira-filter-created-after').value;
    // --- 추가: 생성일자 필수 검증 ---
    if (!createdAfterVal) {
        document.getElementById('jira-import-error-msg').style.display = '';
        document.getElementById('jira-import-error-msg').textContent = '생성일자를 입력해주세요.';
        return;
    }
    document.getElementById('jira-import-error-msg').style.display = 'none';
    // --- 기존 로직 계속 ---
    jiraPreviewCreatedAfter = createdAfterVal;
    // ...
}
```

또한 `index.html`에서 `jira-filter-created-after` 레이블에 필수 표시 추가:

```html
<label for="jira-filter-created-after" class="form-label">
    생성일자 필터 <span class="text-danger">*</span>
    <small class="text-muted">(이 날짜 이후 생성된 이슈만 가져옵니다)</small>
</label>
```

#### 3.4.3 FR-004: 일정관리 화면 착수일 자동 저장 — `app.js` + `index.html` 수정

**`index.html` 변경**: "착수일 저장" 버튼 제거 + `d-flex` / `display:none !important` 충돌 수정

현재 `schedule-queue-start-date-row`는 다음과 같이 선언되어 있다:

```html
<div id="schedule-queue-start-date-row" class="d-flex align-items-center gap-2 px-2 py-1 border-bottom bg-light" style="display:none !important;">
```

Bootstrap의 `d-flex` 클래스는 `display: flex !important`를 적용하므로, JS에서 `.style.display = 'flex'`로 표시하려 해도 `style="display:none !important"`가 inline style로 덮어써 표시되지 않는 문제가 있다. 실제 코드(line 3621)에서는 `queueStartDateRow.style.cssText = 'display: flex !important;'`로 우선순위를 강제하고 있어 현재는 동작하지만 구조적으로 부정확하다. `d-flex`를 제거하고 초기 숨김을 일반 `display:none`으로 처리한다.

```html
<!-- 변경 전 -->
<div id="schedule-queue-start-date-row" class="d-flex align-items-center gap-2 px-2 py-1 border-bottom bg-light" style="display:none !important;">
    <label class="mb-0" style="font-size:0.8rem; white-space:nowrap;"><i class="bi bi-calendar-event"></i> 태스크 착수일</label>
    <input type="text" class="form-control form-control-sm" id="schedule-queue-start-date" style="width:160px;">
    <button class="btn btn-outline-primary btn-sm" id="schedule-queue-start-date-save" style="white-space:nowrap;">착수일 저장</button>
    <button class="btn btn-outline-success btn-sm" id="schedule-queue-start-date-recalculate" style="white-space:nowrap;"><i class="bi bi-arrow-repeat"></i> 시작일 재계산</button>
</div>

<!-- 변경 후: d-flex 제거, display:none (일반 우선순위), 저장 버튼 제거 -->
<div id="schedule-queue-start-date-row" class="align-items-center gap-2 px-2 py-1 border-bottom bg-light" style="display:none;">
    <label class="mb-0" style="font-size:0.8rem; white-space:nowrap;"><i class="bi bi-calendar-event"></i> 태스크 착수일</label>
    <input type="text" class="form-control form-control-sm" id="schedule-queue-start-date" style="width:160px;">
    <!-- 저장 버튼 제거 -->
    <button class="btn btn-outline-success btn-sm" id="schedule-queue-start-date-recalculate" style="white-space:nowrap;"><i class="bi bi-arrow-repeat"></i> 시작일 재계산</button>
</div>
```

`app.js`에서 표시 시에는 `style.cssText = 'display: flex !important;'` 대신 `style.display = 'flex'`로 변경한다 (line 3621):

```javascript
// 변경 전
queueStartDateRow.style.cssText = 'display: flex !important;';
// 변경 후
queueStartDateRow.style.display = 'flex';
```

**`app.js` 변경**: `selectScheduleMember()` 함수 내 flatpickr 초기화 부분에 `onChange` 콜백 추가, 저장 버튼 이벤트 바인딩 코드 제거

저장 버튼 이벤트 바인딩 블록(현재 약 3659~3678 라인) 전체 삭제.

**onChange 콜백 구현 시 무한 루프 방지 주의사항**: `onChange` 내에서 `selectScheduleMember(memberId, name)`를 재호출하면 flatpickr `destroy()` → `flatpickr()` 재초기화 → `onChange` 재등록 사이클이 발생한다. 단 이 경우 flatpickr는 새 인스턴스로 교체될 뿐이고, 날짜 선택이 다시 트리거되지는 않으므로 실제 무한 루프는 발생하지 않는다. 그러나 `selectScheduleMember`는 `memberId` API 호출, 멤버 리스트 active 갱신, hash 갱신, 저장 버튼/재계산 버튼 이벤트 재바인딩 등 불필요한 작업을 모두 재수행한다. 따라서 **큐 태스크 갱신만 필요**한 `onChange` 내에서는 `/ordered-tasks` API만 호출하여 `renderScheduleQueue()`를 직접 갱신한다.

```javascript
flatpickr(queueDateEl, {
    dateFormat: 'Y-m-d',
    locale: 'ko',
    allowInput: true,
    disable: [ /* 기존 공휴일/휴가 disable 로직 유지 */ ],
    onChange: async function(selectedDates, dateStr) {
        try {
            var res = await apiCall('/api/v1/members/' + memberId + '/queue-start-date', 'PATCH',
                { queueStartDate: dateStr || null });
            if (res.success) {
                showToast('착수일이 저장되었습니다.', 'success');
                // selectScheduleMember 대신 ordered-tasks만 재조회하여 큐 갱신
                // (flatpickr 재초기화, 멤버 리스트 active 갱신 등 불필요한 재수행 방지)
                var orderedRes = await apiCall('/api/v1/members/' + memberId + '/ordered-tasks');
                if (orderedRes.success && orderedRes.data) {
                    renderScheduleQueue(orderedRes.data);
                }
            } else {
                showToast(res.message || '착수일 저장에 실패했습니다.', 'error');
            }
        } catch (e) {
            console.error('태스크 착수일 자동 저장 실패:', e);
            showToast('착수일 저장에 실패했습니다.', 'error');
        }
    }
});
```

> `/api/v1/members/{memberId}/tasks` 가 아닌 `/api/v1/members/{memberId}/ordered-tasks` 를 사용한다. 실제 `selectScheduleMember`도 `ordered-tasks` 엔드포인트를 호출하며, `renderScheduleQueue()`는 이 응답의 `data` 객체(`{orderedTasks, unorderedTasks, parallelTasks, inactiveTasks}`)를 기대한다. `/tasks`의 응답 구조는 다르므로 사용하지 않는다.

**`app.js` 변경**: 저장 버튼 관련 코드 삭제 대상

- `var saveBtn = document.getElementById('schedule-queue-start-date-save');` 이하 저장 버튼 이벤트 바인딩 블록 전체 삭제 (약 3658~3678 라인)

#### 3.4.4 FR-006: 프로젝트 태스크 탭 착수일 자동 저장 — `app.js` 수정

**`app.js` 변경**: `initProjectTaskQueueStartDates()` 함수에서 flatpickr 초기화 시 `onChange` 콜백 추가, 저장 버튼 이벤트 바인딩 코드 제거

```javascript
flatpickr(el, {
    dateFormat: 'Y-m-d',
    locale: 'ko',
    allowInput: true,
    disable: [ /* 기존 공휴일/휴가 disable 클로저 유지 */ ],
    onChange: (function(mid, mname, pid) {
        return async function(selectedDates, dateStr) {
            // dateStr이 빈 문자열이면 날짜 삭제(null 저장), 빈 값이 아닌 경우에만 형식 검증
            if (dateStr !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
            try {
                var res = await apiCall('/api/v1/members/' + mid + '/queue-start-date', 'PATCH',
                    { queueStartDate: dateStr || null });
                if (res.success) {
                    showToast(mname + '님의 착수일이 저장되었습니다.', 'success');
                    // 태스크 탭 전체 재렌더링 (착수일 변경으로 큐 순서가 바뀔 수 있음)
                    // 주의: loadProjectTasks 재호출 시 Bootstrap Collapse 상태(접힘/펼침)가 초기 상태로 리셋됨
                    await loadProjectTasks(pid);
                } else {
                    showToast(res.message || '저장에 실패했습니다.', 'error');
                }
            } catch (e) {
                console.error('착수일 자동 저장 실패:', e);
                showToast('착수일 저장에 실패했습니다.', 'error');
            }
        };
    })(memberId, el.getAttribute('data-member-name') || memberId, projectId)
});
```

HTML 렌더링(`loadProjectTasks()`)에서 "저장" 버튼 생성 코드 삭제:

```javascript
// 삭제 대상 (line 1092)
html += '<button class="btn btn-sm btn-outline-primary project-task-queue-start-save" ...>저장</button>';
```

`initProjectTaskQueueStartDates()` 함수 내 저장 버튼 이벤트 바인딩 블록 삭제 (약 1297~1325 라인).

주의: `loadProjectTasks`는 `projectId`를 클로저로 캡처해야 하므로 IIFE 패턴으로 감쌈.

#### 3.4.5 FR-005: 프로젝트 태스크 탭 담당자별 아코디언 — `app.js` 수정

**아코디언 방식**: Bootstrap Collapse를 직접 사용하지 않고 HTML 생성 시 `data-bs-toggle="collapse"` 패턴 적용. 이미 Bootstrap 5.3 사용 중이므로 추가 의존성 없음.

**`app.js` 변경**: `loadProjectTasks()` 내 담당자 카드 생성 부분 수정

각 담당자 카드에 고유 `collapseId` 부여 후 헤더 클릭 시 `card-body` 토글:

```javascript
var collapseId = 'assignee-collapse-' + key;

html += '<div class="card mb-3">';
html += '<div class="card-header py-2" style="cursor:pointer;" '
      + 'data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" '
      + 'aria-expanded="true" aria-controls="' + collapseId + '">';
html += '<div class="d-flex align-items-center gap-2">';
// ... 기존 헤더 내용 (아이콘, 이름, 착수일 input 등) ...
// 접기/펼치기 아이콘 추가
html += '<i class="bi bi-chevron-down ms-auto toggle-icon" style="transition: transform 0.2s;"></i>';
html += '</div>';
html += '</div>';  // card-header 닫기
html += '<div id="' + collapseId + '" class="collapse show">';  // 초기 상태: 펼침
html += '<div class="card-body p-2">';
// ... 기존 태스크 목록 ...
html += '</div>';  // card-body 닫기
html += '</div>';  // collapse div 닫기
html += '</div>';  // card 닫기
```

**접기 아이콘 회전 CSS**: `styles.css`에 추가

```css
/* 아코디언 토글 아이콘 회전 */
[data-bs-toggle="collapse"][aria-expanded="false"] .toggle-icon {
    transform: rotate(-90deg);
}
[data-bs-toggle="collapse"][aria-expanded="true"] .toggle-icon {
    transform: rotate(0deg);
}
```

주의: 헤더 내 착수일 input 클릭이 카드 collapse 토글을 유발하지 않도록 input에 `onclick="event.stopPropagation()"`을 추가해야 함.

```javascript
html += '<input type="text" class="form-control form-control-sm project-task-queue-start-date" '
      + 'data-member-id="' + key + '" value="' + escapeHtml(qsd) + '" '
      + 'placeholder="미지정" style="width:120px; font-size:0.8rem;" '
      + 'onclick="event.stopPropagation()">'; // collapse 트리거 방지
```

재계산 버튼, 비가용일 버튼, 전체선택 체크박스, 삭제 버튼도 동일하게 `onclick="event.stopPropagation()"` 추가 필요.

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 파일 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | `ALLOWED_STATUS_VALUES`에 한글 상태명 추가 | `JiraApiClient.java` | 낮음 | - |
| T2 | `extractStoryPoints()` 최초 호출 시 fields 키 목록 INFO 로그 추가 (`storyPointsFieldsLogged` 플래그 패턴) | `JiraApiClient.java` | 낮음 | - |
| T4 | `startJiraPreview()`에 `createdAfter` 필수 검증 추가 | `app.js` | 낮음 | - |
| T5 | `index.html` 생성일자 레이블에 필수 표시(`*`) 추가 | `index.html` | 낮음 | - |
| T6 | 일정관리 화면 flatpickr `onChange` 자동 저장 추가 + 저장 버튼 제거 + `schedule-queue-start-date-row`의 `d-flex`/`display:none !important` 충돌 수정 | `app.js`, `index.html` | 중간 | - |
| T7 | 프로젝트 태스크 탭 flatpickr `onChange` 자동 저장 추가 + 저장 버튼 렌더링/이벤트 제거 | `app.js` | 중간 | - |
| T8 | 담당자 카드 Bootstrap Collapse 아코디언 적용 | `app.js` | 중간 | - |
| T9 | 아코디언 토글 아이콘 CSS 추가 | `styles.css` | 낮음 | T8 |
| T10 | 카드 헤더 내 버튼/input에 `stopPropagation` 추가 | `app.js` | 낮음 | T8 |

### 4.2 구현 순서

1. **Step 1 (백엔드 버그 수정)**: T1, T2 — `JiraApiClient.java` 수정. `ALLOWED_STATUS_VALUES` 한글 추가, `extractStoryPoints()` INFO 로그 추가. 빌드 후 실제 Jira 연동 테스트로 fields 키 목록 확인
2. **Step 2 (프론트 생성일자 필수화)**: T4, T5 — `startJiraPreview()` 검증 로직 추가 및 HTML 레이블 수정
3. **Step 3 (착수일 자동 저장 - 일정관리)**: T6 — 일정관리 화면(`selectScheduleMember`) 변경. 저장 버튼 HTML 제거 및 flatpickr onChange 적용. 무한 루프 방지 주의
4. **Step 4 (착수일 자동 저장 - 프로젝트 태스크 탭)**: T7 — `initProjectTaskQueueStartDates()` 변경. 저장 버튼 렌더링 코드 및 이벤트 바인딩 제거. `loadProjectTasks` projectId 클로저 캡처 주의
5. **Step 5 (아코디언)**: T8, T9, T10 — 담당자 카드 collapse 적용 및 stopPropagation 추가

### 4.3 테스트 계획

**T1~T2 (백엔드)**:
- Jira Board에서 이슈 미리보기 실행 후 서버 로그에서 `[Jira Debug] 첫 번째 이슈의 fields 키 목록` 확인
- 로그에서 확인한 실제 story points 필드명이 `customfield_10016` 또는 `customfield_10028` 중 어느 것인지 확인. 둘 다 없는 경우 `BOARD_FIELDS`에 해당 번호를 추가 대응
- story points가 설정된 이슈의 MD가 0이 아닌 실제 값으로 표시되는지 확인
- 상태 필터 "To Do" 선택 시 JQL 로그에 `status in ("To Do")` 포함 확인

**T4~T5 (생성일자 필수)**:
- 생성일자 빈 채로 미리보기 클릭 → 에러 메시지 표시, API 미호출 확인
- 날짜 입력 후 미리보기 클릭 → 정상 동작 확인

**T6 (일정관리 자동 저장)**:
- 담당자 선택 후 착수일 캘린더에서 날짜 선택 → 즉시 토스트 메시지 + 큐 갱신 확인
- 화면에 "착수일 저장" 버튼이 더 이상 표시되지 않음 확인
- 날짜 삭제(빈 값 선택) 시 null로 저장되는지 확인

**T7 (프로젝트 태스크 탭 자동 저장)**:
- 프로젝트 태스크 탭 grouped 뷰에서 담당자 카드 착수일 변경 → 즉시 저장 + 탭 갱신 확인
- "저장" 버튼이 렌더링되지 않음 확인

**T8~T10 (아코디언)**:
- 담당자 카드 헤더 클릭 → 태스크 목록 접힘/펼침 확인
- 착수일 input 클릭 → 카드 접히지 않음 확인
- 재계산 버튼, 비가용일 버튼 클릭 → 카드 접히지 않음 확인
- 전체선택 체크박스 클릭 → 카드 접히지 않음 확인

---

## 5. 리스크 및 고려사항

### 5.1 story points 필드 ID 불일치
Jira Cloud 인스턴스마다 story points 커스텀 필드 번호가 다를 수 있음 (예: `customfield_10016`, `customfield_10028`, `customfield_10034` 등). `BOARD_FIELDS`에 고정 번호를 나열하는 방식은 한계가 있음.

**완화 방안**: `extractStoryPoints()`에 INFO 레벨 디버그 로그를 추가하여 배포 후 실제 필드명을 확인하고 추가 대응. `story_points`는 Jira Cloud에서 유효한 fields 파라미터가 아니므로 추가하지 않는다. 장기적으로는 Jira 설정 화면에서 story points 필드 ID를 사용자가 직접 입력할 수 있도록 개선 검토.

### 5.2 onChange 자동 저장 시 불필요한 재작업
`onChange` 콜백에서 `selectScheduleMember(memberId, name)`를 재호출하면 flatpickr `destroy()` 후 재초기화, 멤버 리스트 active 상태 갱신, hash 갱신, 이벤트 재바인딩 등 불필요한 작업이 재수행된다. 실제 무한 루프는 발생하지 않지만 성능 낭비가 크다.

**완화 방안**: 일정관리 화면에서는 `/ordered-tasks` API만 호출하여 `renderScheduleQueue()` 직접 갱신. 프로젝트 태스크 탭에서는 `loadProjectTasks(pid)` 호출로 탭 전체 재렌더링(착수일 변경 시 큐 순서가 바뀔 수 있으므로 전체 갱신이 적절함).

### 5.3 착수일 저장 시 아코디언 상태 리셋
`loadProjectTasks(pid)`를 호출하면 담당자 카드 전체 DOM이 재생성된다. Bootstrap Collapse 인스턴스도 새로 생성되므로 기존에 접혀 있던 카드가 초기 상태(펼침)로 리셋된다.

**완화 방안**: 착수일 `onChange` 저장 완료 후 `loadProjectTasks` 호출 전에 현재 접힌 카드의 `collapseId` 목록을 별도로 수집하고, 재렌더링 완료 후(`initProjectTaskQueueStartDates` 완료 직후) 해당 ID들의 Bootstrap Collapse 인스턴스를 `hide()`로 복원하는 방식을 고려할 수 있다. 단, 이 구현은 복잡도를 높이므로 초기 구현에서는 리셋을 허용하고 필요 시 추후 개선한다.

### 5.4 아코디언 ID 충돌
`key`가 멤버 ID 또는 `"unassigned"`이므로 `collapseId = 'assignee-collapse-' + key`는 고유함. 단, 동일 페이지에 여러 프로젝트의 태스크 탭이 동시에 렌더링되지 않으므로 ID 충돌 없음.

### 5.5 Bootstrap Collapse와 SortableJS 충돌
접힌 상태에서 SortableJS drag가 실행되면 예기치 않은 동작 발생 가능. 테스트 필요.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 | 관련 내용 |
|------|------|---------|
| `JiraApiClient.java` | `src/main/java/com/timeline/service/JiraApiClient.java` | BOARD_FIELDS, ALLOWED_STATUS_VALUES, extractStoryPoints() |
| `JiraImportService.java` | `src/main/java/com/timeline/service/JiraImportService.java` | STATUS_MAP, importIssues(), preview() |
| `JiraImportController.java` | `src/main/java/com/timeline/controller/JiraImportController.java` | /api/v1/projects/{id}/jira/preview, /import |
| `app.js` | `src/main/resources/static/js/app.js` | showJiraImportModal(), startJiraPreview(), selectScheduleMember(), initProjectTaskQueueStartDates(), loadProjectTasks() |
| `index.html` | `src/main/resources/static/index.html` | jiraImportModal, schedule-queue-start-date-row |
| `styles.css` | `src/main/resources/static/css/styles.css` | 아코디언 토글 아이콘 CSS |

### 주요 라인 번호 (app.js, 현재 기준)

| 함수/코드 | 라인 번호 |
|-----------|----------|
| `showJiraImportModal()` | 5070 |
| `startJiraPreview()` | 5131 |
| `executeJiraImport()` | 5228 |
| `initProjectTaskQueueStartDates()` | 1267 |
| 저장 버튼 이벤트 바인딩 (프로젝트 태스크) | 1297~1325 |
| `loadProjectTasks()` 담당자 카드 헤더 렌더링 | 1083~1107 |
| 저장 버튼 HTML 생성 | 1092 |
| `selectScheduleMember()` flatpickr 초기화 | 약 3629 |
| 착수일 저장 버튼 이벤트 바인딩 | 3658~3678 |

### 참고 API

- Jira Agile Board Issues: `GET {baseUrl}/rest/agile/1.0/board/{boardId}/issue?fields=...`
- Jira Search: `GET {baseUrl}/rest/api/3/search?jql=...&fields=...`
- Jira 커스텀 필드 목록 조회: `GET {baseUrl}/rest/api/3/field` (story points 필드 ID 확인 가능)
