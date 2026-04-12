# 개발 계획서: 간트차트 UX 개선 및 다수 기능 개선

## 1. 개요

- **기능 설명**: 간트차트 UX 개선(row 간격 축소, 토글 필터, sticky 헤더), 우측 버튼 정리, 태스크 추가 버튼 재배치, 태스크 수정 모달 개선, Jira 이슈링크 매핑, Jira 업데이트 확인, 버튼명 변경 등 9가지 요구사항을 한 번에 처리한다.
- **개발 배경**: 간트차트에 태스크가 많아질수록 스크롤이 길어지고 불필요한 버튼이 상단을 차지한다. 태스크 추가 버튼은 간트차트 화면보다 프로젝트/멤버별 뷰에서 직관적이다. Jira 이슈간 연결관계(issuelinks)를 현재 가져오지 않아 링크 정보가 유실된다.
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 간트차트 각 행(row) 높이를 줄여 한 화면에 더 많은 태스크가 표시되도록 한다.
- **FR-002**: 간트차트 상단(프로젝트 선택 드롭다운과 같은 row)에 체크박스 2개를 추가한다. 하나는 Jira 티켓번호 표시 여부, 다른 하나는 도메인명 표시 여부이다. 체크 상태에 따라 frappe-gantt 태스크명 문자열을 재구성한다.
- **FR-003**: 간트차트 날짜 헤더(frappe-gantt SVG 상단의 날짜 행)가 상하 스크롤 시 화면 상단에 고정된다.
- **FR-004**: 간트차트 섹션 우측 상단의 "태스크 추가" 버튼, 경고 버튼, 설정 버튼을 제거한다. (현재 코드에서는 `gantt-add-task-btn`이 "태스크 추가" 버튼이며, 경고/설정 관련 버튼은 별도 확인 필요)
- **FR-005**: 태스크 추가 버튼을 (a) 프로젝트 상세 > 태스크 탭, (b) 멤버별 태스크(일정관리) 화면의 큐 패널에 배치한다.
- **FR-006-A**: 태스크 수정 모달의 설명(description) textarea 기본 높이를 현재 `rows="2"`에서 `rows="4"`로 변경한다.
- **FR-006-B**: 태스크 수정 모달에서 "Jira 티켓 번호" 필드를 "실제 완료일" 필드와 같은 row에 배치한다. (현재 각각 별도 row)
- **FR-006-C**: 태스크 수정 모달의 "선행 태스크(의존관계)" 영역을 검색 가능한 UI로 교체한다. 텍스트 입력창에 태스크명을 입력하면 필터링된 목록이 표시되고 클릭으로 선택/해제할 수 있다.
- **FR-007**: Jira 이슈 가져오기 시 `issuelinks` 필드를 추가 요청하여, 이슈간 연결 관계를 `TaskLink` 테이블에 저장한다. 링크 URL은 해당 Jira 이슈의 URL로 구성하고, label은 링크 유형(예: `blocks`, `is blocked by`, `relates to`)으로 설정한다.
- **FR-008**: Jira 이슈 업데이트 분기(jiraKey로 기존 태스크를 찾아 UPDATE)가 이미 `JiraImportService`에 구현되어 있는지 확인하고 계획서에 결과를 기록한다.
- **FR-009**: 모든 화면의 "시작일 재계산" 및 "재계산" 버튼 텍스트를 "시작일 최적화"로 변경한다.

### 2.2 비기능 요구사항

- **NFR-001**: 토글 필터 체크박스 상태는 페이지 새로고침 후에도 유지되어야 한다 (`localStorage` 사용).
- **NFR-002**: 의존관계 검색 UI는 태스크가 수백 개인 경우에도 입력 지연 없이 동작해야 한다 (클라이언트 측 필터링, 별도 API 호출 없음).
- **NFR-003**: `issuelinks` 추가 수집은 기존 Import 로직의 배치 저장 흐름을 따른다. 링크 저장 실패가 전체 Import를 중단시키지 않는다.

### 2.3 가정 사항

- frappe-gantt@0.6.1 라이브러리는 SVG 기반 렌더링을 사용하며 `bar_height`와 `padding` 옵션으로 row 간격을 조절할 수 있다.
- frappe-gantt 0.6.1 SVG의 날짜 헤더 SVG 요소 클래스는 `.upper-header`와 `.lower-header`이다. SVG 내부 요소에는 CSS `position: sticky`가 동작하지 않으므로, sticky 헤더 구현은 JS 오버레이 방식으로 접근한다. 초기 구현은 `#gantt-container .card-body`에 `max-height` + `overflow-y: auto`를 설정하는 것으로 대체한다(§5.3 대안 참조).
- Jira issuelinks의 URL은 `{config.baseUrl}/browse/{linkedIssueKey}` 형태로 구성한다.
- 앱 내 태스크 1건당 TaskLink는 최대 10개 제한이 있으나, Jira issuelinks 저장 시에는 이 제한을 초과하더라도 가능한 만큼 저장하고 경고 로그를 남기는 방식으로 처리한다.
- `convertToGanttTasks()` 함수에서 이미 `_jiraKey`, `_domainSystem` 등 메타데이터를 태스크 객체에 저장하고 있으므로, 토글 필터 구현 시 이 값을 재활용할 수 있다.

### 2.4 제외 범위 (Out of Scope)

- frappe-gantt 라이브러리 교체 또는 커스텀 빌드
- Jira issuelinks의 방향성(outward/inward) 구분에 따른 의존관계 자동 생성 (TaskDependency 매핑)
- 의존관계 검색 UI에서 무한 스크롤이나 서버 페이지네이션
- sticky 날짜 헤더의 모바일 대응

---

## 3. 시스템 설계

### 3.1 데이터 모델

신규 엔티티 없음. 기존 엔티티 변경 없음.

**TaskLink 엔티티 재활용** (기존)
```
TaskLink
  - id: Long (PK)
  - task: Task (ManyToOne)
  - url: String(2000)
  - label: String(200)
  - createdAt: LocalDateTime
```

Jira issuelinks 저장 시 활용 방식:
- `url`: `{jiraBaseUrl}/browse/{linkedIssueKey}` (예: `https://mycompany.atlassian.net/browse/PROJ-45`)
- `label`: Jira 링크 유형 원문 (예: `blocks PROJ-45`, `is blocked by PROJ-12`, `relates to PROJ-33`)
  - 최대 200자 truncate 처리

**JiraDto.JiraIssue 필드 추가**
```java
// 기존 JiraDto.JiraIssue에 추가
private List<JiraIssueLink> issueLinks;  // issuelinks 파싱 결과
```

**신규 inner class: JiraDto.JiraIssueLink**
```java
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public static class JiraIssueLink {
    private String type;        // "blocks", "is blocked by", "relates to" 등
    private String linkedKey;   // 연결된 이슈 key (예: "PROJ-45")
}
```

### 3.2 API 설계

백엔드 API 신규 추가 없음. 기존 Jira Import API 내부 로직만 변경된다.

| Method | Endpoint | 설명 | 변경 여부 |
|--------|----------|------|-----------|
| POST | `/api/v1/projects/{projectId}/jira/import` | Jira 이슈 Import | 내부 로직 변경 (issuelinks 처리 추가) |

### 3.3 서비스 계층

#### 3.3.1 JiraApiClient 변경 (FR-007)

**BOARD_FIELDS 상수 변경**
```java
// 변경 전
private static final String BOARD_FIELDS = "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,dueDate,description,resolutiondate";

// 변경 후
private static final String BOARD_FIELDS = "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,dueDate,description,resolutiondate,issuelinks";
```

**parseIssue() 메서드 변경**
- `fields.get("issuelinks")`를 파싱하여 `List<JiraDto.JiraIssueLink>` 생성
- outwardIssue / inwardIssue 구조 처리:
  ```
  issuelinks = [
    { "type": {"outward": "blocks", "inward": "is blocked by"},
      "outwardIssue": {"key": "PROJ-45"} },
    { "type": {"outward": "blocks", "inward": "is blocked by"},
      "inwardIssue": {"key": "PROJ-12"} }
  ]
  ```
- outwardIssue가 있으면 `type = outwardType`, `linkedKey = outwardIssue.key`
- inwardIssue가 있으면 `type = inwardType`, `linkedKey = inwardIssue.key`

#### 3.3.2 JiraImportService 변경 (FR-007)

**의존성 추가**
```java
private final TaskLinkRepository taskLinkRepository;
```

**importIssues() 내 issuelinks 처리 로직 추가** (배치 저장 후)
```
for each (task, issue) pair in saved tasks:
    if issue.issueLinks is not empty:
        // 재import 시 중복 방지: 해당 태스크의 모든 기존 TaskLink를 삭제 후 재등록
        taskLinkRepository.deleteByTaskId(task.getId())
        int linkCount = 0
        for each issueLink:
            if linkCount >= 10: log warning "태스크 {} issuelinks 10개 초과, 이후 링크 skip"; break
            url = config.baseUrl + "/browse/" + issueLink.linkedKey
            // label: issueLink.type이 null이면 "relates to {linkedKey}", 비어있으면 안 됨 (nullable=false 제약)
            label = truncate(
                (issueLink.type != null ? issueLink.type : "relates to") + " " + issueLink.linkedKey,
                200
            )
            TaskLink 생성 후 taskLinkRepository.save()
            linkCount++
```

> 주의 1: TaskLink.label 컬럼은 `nullable = false`이다. `issueLink.type`이 null인 경우 빈 문자열 또는 null이 전달되면 DB 제약 위반 예외가 발생한다. 반드시 null-safe 처리(예: `"relates to"` 기본값)가 필요하다.

> 주의 2: 10개 제한 판별은 DB `countByTaskId` 쿼리가 아닌 루프 내 카운터 변수로 처리한다. 매 issueLink마다 count 쿼리를 호출하면 N+1 문제가 발생한다.

**주의**: TaskLink 저장 실패는 catch로 감싸 개별 처리 → Import 전체 롤백 없음

#### 3.3.3 FR-008 확인 결과

`JiraImportService.importIssues()` 코드(line 175) 분석 결과:
```java
Task existing = existingTaskMap.get(issue.getKey());
if (existing != null) {
    // UPDATE 분기: 기존 태스크 필드 업데이트 (executionMode는 기존 값 유지)
    ...
    updated++;
} else {
    // CREATE 분기: 새 태스크 생성 (executionMode = SEQUENTIAL 고정)
    Task newTask = Task.builder()
            ...
            .executionMode(TaskExecutionMode.SEQUENTIAL)
            ...
            .build();
    created++;
}
```
**결론**: jiraKey 기반 UPDATE 로직이 이미 완전히 구현되어 있다. 별도 작업 불필요.

> 참고: CREATE 분기는 `executionMode = SEQUENTIAL`로 고정되며, UPDATE 분기는 기존 태스크의 executionMode를 유지한다. JiraImportService Javadoc 주석(line 28)에 "executionMode는 SEQUENTIAL로 고정"이라 기재된 것은 CREATE 분기에만 해당하는 설명이다.

### 3.4 프론트엔드

#### FR-001: 간트차트 row 간격 축소

**변경 위치**: `src/main/resources/static/js/app.js` - `renderGantt()` 함수 (line 2421)

```javascript
// 변경 전
ganttInstance = new Gantt('#gantt-chart', tasks, {
    bar_height: 30,
    padding: 14,
    ...
});

// 변경 후
ganttInstance = new Gantt('#gantt-chart', tasks, {
    bar_height: 20,
    padding: 8,
    ...
});
```

frappe-gantt row 높이 = `bar_height + padding * 2`. 현재 `30 + 14*2 = 58px` → 변경 후 `20 + 8*2 = 36px`. 약 38% 감소.

#### FR-002: 티켓번호/도메인명 표시 토글 필터

**HTML 변경 위치**: `index.html` - `#gantt-section .section-header` (line 329~345)

프로젝트 선택 드롭다운과 같은 row의 `d-flex` div 내에 체크박스 2개 추가:
```html
<div class="d-flex align-items-center gap-3">
    <h2>...</h2>
    <select id="gantt-project-select" ...></select>
    <!-- 신규 추가 -->
    <div class="form-check form-check-inline mb-0">
        <input class="form-check-input" type="checkbox" id="gantt-show-jira-key" checked>
        <label class="form-check-label" for="gantt-show-jira-key" style="font-size:0.85rem;">티켓번호</label>
    </div>
    <div class="form-check form-check-inline mb-0">
        <input class="form-check-input" type="checkbox" id="gantt-show-domain" checked>
        <label class="form-check-label" for="gantt-show-domain" style="font-size:0.85rem;">도메인명</label>
    </div>
</div>
```

**JS 변경 위치**: `app.js` - `convertToGanttTasks()` 함수 (line 2385~2390)

```javascript
// 전역 변수 추가 (상단, jiraPreviewStatusFilter 선언 인근)
var ganttShowJiraKey = true;   // 티켓번호 표시 여부
var ganttShowDomain = true;    // 도메인명 표시 여부

// convertToGanttTasks() 내부 태스크명 구성 변경
// 기존 line 2386의 jiraPrefix 선언을 아래로 교체 (기존 변수를 완전히 대체)
var jiraPrefix = (ganttShowJiraKey && task.jiraKey) ? '[' + task.jiraKey + '] ' : '';
var domainPart = ganttShowDomain ? '[' + ds.name + '] ' : '';
// name 조합 (기존 line 2389 교체):
// parallelPrefix + priorityPrefix + jiraPrefix + namePrefix + domainPart + task.name + ' (' + assigneeName + ', ' + manDays + 'MD)'
// 주의: 기존 코드의 고정 문자열 '[' + ds.name + '] '를 domainPart 변수로 교체한다
```

**체크박스 이벤트 바인딩**: 간트차트 로드 완료 후 (또는 `DOMContentLoaded`에서) 체크박스 change 이벤트를 연결. 상태 변경 시 `ganttShowJiraKey` / `ganttShowDomain` 전역 변수 업데이트 후 `renderGantt(currentGanttData)` 재호출.

**localStorage 저장**: 체크 상태를 `localStorage.setItem('ganttShowJiraKey', ...)` / `ganttShowDomain`으로 유지. 초기화 시 복원.

#### FR-003: 간트차트 날짜 헤더 sticky

frappe-gantt는 SVG 기반이므로 SVG 요소에 CSS sticky 직접 적용 불가. 대신 SVG를 감싸는 컨테이너에 `overflow-x: auto`를 유지하면서 **SVG의 상단 헤더 영역(`upper-header`, `lower-header`)을 클론하여 별도의 sticky div에 표시**하는 방식은 구현 복잡도가 높다.

**현실적 대안**: `#gantt-container .card-body`에 `max-height` + `overflow-y: auto`를 설정하고, CSS로 SVG 내 `#gantt-chart svg .grid-header` 영역을 sticky 처리한다.

**CSS 변경 위치**: `styles.css`

```css
/* 간트차트 컨테이너에 세로 스크롤 영역 지정 */
#gantt-container .card-body {
    max-height: calc(100vh - 180px);
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
}

/* frappe-gantt SVG 내 헤더를 sticky로 고정 */
/* frappe-gantt 0.6.1의 실제 헤더 그룹 클래스는 .upper-header, .lower-header */
/* SVG 요소에는 CSS position: sticky가 대부분 브라우저에서 동작하지 않는다 */
/* 아래 규칙은 의도를 문서화하는 용도이며, 실제 적용은 JS 오버레이 방식으로 대체한다 */
/*
#gantt-chart svg .upper-header,
#gantt-chart svg .lower-header {
    position: sticky;
    top: 0;
    z-index: 10;
}
*/
```

> 주의: frappe-gantt 0.6.1의 날짜 헤더 SVG 요소는 `.upper-header`와 `.lower-header`이다 (`.grid-header`는 존재하지 않음). 또한 SVG 내부 요소에 CSS `position: sticky`를 적용하는 것은 브라우저 명세상 동작하지 않는다 (SVG는 자체 뷰포트를 사용). 따라서 CSS sticky 방식을 시도하지 않고, 초기 구현은 §5.3의 대안(max-height 고정 + 내부 스크롤)으로 진행한다. sticky 헤더가 필수인 경우 `renderGantt()` 완료 후 JS로 SVG의 `.upper-header`/`.lower-header` 하위 rect·text 요소를 별도 `<div>` 오버레이로 복사하고 스크롤 이벤트에 동기화하는 방식을 적용한다.

#### FR-004: 간트차트 우측 상단 버튼 제거

현재 `#gantt-section .section-header` 우측(line 342~345)에 있는 버튼:
- `gantt-add-task-btn`: "태스크 추가" 버튼 → 제거 (FR-005에서 재배치)

현재 코드에 경고/설정 버튼은 `section-header`에 없다. Day/Week/Month 뷰 모드 btn-group은 유지한다.

**HTML 변경**: `gantt-add-task-btn` 버튼 element 전체 삭제.

**JS 변경**: `gantt-add-task-btn`을 `style.display` 조작하는 코드들(app.js lines 1892, 1895, 1919, 1926, 1932) 모두 제거 또는 무효화. 해당 element가 없어지므로 `getElementById` 호출 시 null guard 필요.

> 참고: `gantt-add-task-btn` 참조는 총 5군데(lines 1892, 1895, 1919, 1926, 1932)이며 §5.2의 기술과 일치한다.

#### FR-005: 태스크 추가 버튼 재배치

**A. 프로젝트 > 태스크 탭**

`loadProjectTasks()` 함수 내에서 `toggleHtml`을 구성하는 부분(line 1016~1044)에 "태스크 추가" 버튼 추가:

```javascript
toggleHtml += '<button class="btn btn-primary btn-sm" onclick="showTaskModal(null, ' + projectId + ')">'
    + '<i class="bi bi-plus-lg"></i> 태스크 추가</button>';
```

버튼 위치: 뷰 모드 토글 버튼 그룹과 상태 필터 버튼 그룹 우측 끝.

**B. 멤버별 태스크(일정관리) 화면**

`index.html` `#schedule-queue-start-date-row` 또는 그 인근에 "태스크 추가" 버튼 추가:

```html
<button class="btn btn-primary btn-sm" id="schedule-add-task-btn" style="display:none;"
        onclick="showTaskModalForScheduleMember()">
    <i class="bi bi-plus-lg"></i> 태스크 추가
</button>
```

`showTaskModal(null, null)` 직접 호출은 `resolvedProjectId = null`이 되어 프로젝트 선택 없이 모달이 열리므로 사용하지 않는다. 대신 전용 래퍼 함수를 정의하여 `showTaskModal()` 호출 후 담당자를 자동 선택한다:

```javascript
async function showTaskModalForScheduleMember() {
    await showTaskModal(null, null);
    // 담당자 자동 선택: currentScheduleMemberId가 있으면 담당자 드롭다운 pre-select
    if (currentScheduleMemberId) {
        var assigneeSelect = document.getElementById('task-assignee');
        if (assigneeSelect) assigneeSelect.value = currentScheduleMemberId;
    }
}
```

> 주의: `showTaskModal()` 내부에서 담당자 드롭다운은 `loadTaskModalProjectData()` 호출 이전에 초기화(빈 값)되므로, 담당자 자동 선택은 `loadTaskModalProjectData()` 완료 후 적용해야 한다. 위 래퍼 함수는 `await showTaskModal()`이 완료된 후 선택을 시도하므로 순서가 보장된다. 단, 담당자 목록이 프로젝트 멤버 기준으로 필터링되는데 프로젝트를 선택하지 않으면 담당자 목록이 비어 있으므로, `currentScheduleMemberId` pre-select은 프로젝트 선택 후 `loadTaskModalProjectData()` 재호출로 덮어써진다.

- 멤버 선택 시 `style.display = ''`, 미선택 시 `style.display = 'none'` (현재 `schedule-queue-start-date-row`와 동일한 show/hide 로직 적용)

#### FR-006-A: description textarea 높이 변경

**HTML 변경 위치**: `index.html` line 1063

```html
<!-- 변경 전 -->
<textarea class="form-control" id="task-description" rows="2"></textarea>

<!-- 변경 후 -->
<textarea class="form-control" id="task-description" rows="4"></textarea>
```

#### FR-006-B: Jira 티켓번호 필드를 실제 완료일과 같은 row로 이동

현재 HTML 구조:
```
<!-- 5행: 실제 완료일 (col-md-4) -->
<div class="row">
    <div class="col-md-4 mb-3">실제 완료일</div>
</div>
<!-- 6행: Jira 티켓 번호 (col-md-4) -->
<div class="row">
    <div class="col-md-4 mb-3">Jira 티켓 번호</div>
</div>
```

변경 후:
```html
<!-- 5행: 실제 완료일 + Jira 티켓 번호 -->
<div class="row">
    <div class="col-md-4 mb-3">실제 완료일</div>
    <div class="col-md-4 mb-3">Jira 티켓 번호</div>
</div>
```

기존 6행 row는 삭제한다.

#### FR-006-C: 선행 태스크 검색 가능 UI

현재 구조: `#task-dependencies-section` 내에 `#task-dependencies-checklist` div에 checkbox 리스트를 HTML 문자열로 렌더링 (line 3204~3217).

변경 구조:
1. `#task-dependencies-section`에 검색 입력창 추가:
   ```html
   <input type="text" class="form-control form-control-sm mb-2"
          id="task-dep-search" placeholder="태스크명으로 검색...">
   ```
2. `#task-dependencies-checklist`는 유지. 렌더링 방식은 동일(checkbox 리스트).
3. `#task-dep-search`의 `input` 이벤트에서 키워드로 checkbox label 텍스트를 필터링:
   ```javascript
   document.getElementById('task-dep-search').addEventListener('input', function() {
       var keyword = this.value.trim().toLowerCase();
       var items = document.querySelectorAll('#task-dependencies-checklist .form-check');
       items.forEach(function(item) {
           var label = item.querySelector('label').textContent.toLowerCase();
           item.style.display = keyword === '' || label.includes(keyword) ? '' : 'none';
       });
   });
   ```
4. 체크박스 체크 시 선택된 항목이 목록 상단으로 올라오거나, 선택된 항목에 시각적 강조(배경색)를 적용한다.

**변경 위치**: `index.html` (HTML 구조 추가) + `app.js`의 `showTaskModal()` (이벤트 바인딩)

> 주의: `input` 이벤트 바인딩은 `loadTaskModalProjectData()` 내부에 두지 않는다. `loadTaskModalProjectData()`는 프로젝트 변경마다 재호출되므로, 해당 함수 내에서 `addEventListener`를 호출하면 이벤트 리스너가 중복 등록된다. `showTaskModal()` 초기화 블록에서 단 1회만 바인딩하거나, `cloneNode(true)` 방식으로 기존 리스너를 제거 후 재등록한다.

검색창 초기화: `showTaskModal()` 내에서 모달 오픈 시 `task-dep-search` 값을 `''`로 리셋하고, 체크리스트의 모든 항목을 표시 상태(`style.display = ''`)로 복원한다.

#### FR-007: Jira issuelinks → TaskLink 매핑

백엔드 변경은 3.3.1, 3.3.2에서 설명. 프론트엔드 변경 없음.

**ImportResult에 issueLinksCreated 카운트 추가** (선택):
```java
// JiraDto.ImportResult에 필드 추가
private int issueLinksCreated;
```

Import 완료 toast 메시지에 반영 가능.

#### FR-009: "시작일 재계산" → "시작일 최적화" 버튼명 변경

**변경 대상**:

| 파일 | 위치 | 현재 텍스트 | 변경 후 |
|------|------|------------|---------|
| `index.html` | line 297 버튼 텍스트 | `시작일 재계산` | `시작일 최적화` |
| `app.js` | line 1110 버튼 텍스트 | `재계산` | `시작일 최적화` |
| `app.js` | line 1110 title 속성 | `TODO 태스크 시작일 재계산` | `TODO 태스크 시작일 최적화` |
| `app.js` | line 1372 toast | `시작일이 재계산되었습니다` | `시작일이 최적화되었습니다` |
| `app.js` | line 1375 toast | `재계산에 실패했습니다` | `최적화에 실패했습니다` |
| `app.js` | line 1378 toast | `시작일 재계산에 실패했습니다` | `시작일 최적화에 실패했습니다` |
| `app.js` | line 3708 toast | `시작일이 재계산되었습니다` | `시작일이 최적화되었습니다` |
| `app.js` | line 3711 toast | `재계산에 실패했습니다` | `최적화에 실패했습니다` |
| `app.js` | line 3714 console.error | `시작일 재계산 실패` | `시작일 최적화 실패` |
| `app.js` | line 3715 toast | `시작일 재계산에 실패했습니다` | `시작일 최적화에 실패했습니다` |

> 참고: line 1572, 4562의 "날짜가 재계산됩니다"는 드래그앤드롭 순서 변경 후 자동 재계산을 지칭하는 것으로 이번 변경 대상이 아니다. "시작일 재계산"/"재계산 버튼" 관련 문구만 변경한다.

### 3.5 기존 시스템 연동

| 영향 파일 | 변경 유형 | 내용 |
|-----------|-----------|------|
| `index.html` | HTML 수정 | 간트차트 섹션, 태스크 모달, 멤버별 태스크 섹션 |
| `js/app.js` | JS 수정 | convertToGanttTasks, renderGantt, loadProjectTasks, showTaskModal, loadTaskModalProjectData |
| `css/styles.css` | CSS 추가 | gantt-container sticky, row 간격 관련 |
| `JiraApiClient.java` | 필드 추가 | BOARD_FIELDS, parseIssue() |
| `JiraImportService.java` | 로직 추가 | TaskLink 저장, 의존성 추가 |
| `JiraDto.java` | DTO 필드 추가 | JiraIssue.issueLinks, JiraIssueLink inner class |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | FR-001: 간트차트 row 간격 축소 | renderGantt()의 bar_height/padding 값 변경 | 낮음 | - |
| T-02 | FR-003: 간트차트 날짜 헤더 sticky CSS | styles.css에 max-height + sticky 처리 | 중간 | - |
| T-03 | FR-004: 간트차트 태스크 추가 버튼 제거 | index.html 버튼 삭제 + app.js null guard | 낮음 | - |
| T-04 | FR-002: 티켓번호/도메인명 토글 체크박스 | HTML 추가 + convertToGanttTasks 조건 분기 + localStorage | 중간 | T-01 |
| T-05 | FR-005-A: 프로젝트 태스크 탭 추가 버튼 | loadProjectTasks()의 toggleHtml에 버튼 추가 | 낮음 | - |
| T-06 | FR-005-B: 멤버별 태스크 화면 추가 버튼 | index.html 버튼 추가 + show/hide JS 로직 | 낮음 | - |
| T-07 | FR-006-A: description textarea 높이 | index.html rows 속성 변경 | 매우 낮음 | - |
| T-08 | FR-006-B: Jira 티켓번호 필드 row 통합 | index.html 5행/6행 HTML 구조 변경 | 낮음 | - |
| T-09 | FR-006-C: 선행 태스크 검색 UI | index.html 검색창 추가 + app.js 필터 이벤트 | 중간 | - |
| T-10 | FR-009: 버튼명 변경 | index.html + app.js 텍스트 일괄 변경 | 낮음 | - |
| T-11 | FR-007: JiraDto 필드 추가 | JiraIssueLink inner class + JiraIssue 필드 추가 | 낮음 | - |
| T-12 | FR-007: JiraApiClient issuelinks 파싱 | BOARD_FIELDS 수정 + parseIssue() 파싱 로직 | 중간 | T-11 |
| T-13 | FR-007: JiraImportService TaskLink 저장 | TaskLinkRepository 주입 + 저장 로직 | 중간 | T-11, T-12 |

### 4.2 구현 순서

1. **Step 1 - 프론트엔드 단순 변경** (T-01, T-03, T-07, T-08, T-10): 코드 변경이 단순하고 독립적인 항목들을 먼저 처리한다.
2. **Step 2 - 간트차트 토글 필터 + sticky** (T-02, T-04): 간트차트 렌더링과 연관된 항목들.
3. **Step 3 - 태스크 추가 버튼 재배치 + 선행 태스크 검색** (T-05, T-06, T-09): 태스크 모달 연관 항목들.
4. **Step 4 - Jira issuelinks 백엔드** (T-11, T-12, T-13): 백엔드 변경.
5. **Step 5 - 빌드 확인 및 통합 테스트**: `./gradlew compileJava` 확인.

### 4.3 테스트 계획

**단위 테스트 대상**
- `JiraApiClient.parseIssue()`: issuelinks 필드가 있는 이슈, 없는 이슈, outwardIssue/inwardIssue 혼합 케이스
- `JiraImportService.importIssues()`: issueLinks가 있는 JiraIssue를 import할 때 TaskLink 생성 확인

**통합 테스트 시나리오**
1. 간트차트에서 티켓번호 체크박스를 해제하면 태스크명에서 `[PROJ-123]` prefix가 사라지는지 확인
2. 도메인명 체크박스 해제 시 `[도메인명]` 부분이 사라지는지 확인
3. 새로고침 후 체크박스 상태가 localStorage에서 복원되는지 확인
4. 간트차트에서 세로 스크롤 시 날짜 헤더가 고정되는지 확인
5. 프로젝트 태스크 탭에서 "태스크 추가" 버튼 클릭 시 해당 프로젝트가 pre-select된 모달이 열리는지 확인
6. 멤버별 태스크 화면에서 멤버 선택 시 "태스크 추가" 버튼이 나타나는지 확인
7. 태스크 모달에서 선행 태스크 검색창에 텍스트 입력 시 목록이 필터링되는지 확인
8. Jira Import 실행 후 issuelinks가 있는 이슈의 해당 태스크에 TaskLink가 생성되는지 DB 확인
9. "시작일 최적화" 버튼이 모든 화면에서 올바른 텍스트로 표시되는지 확인

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|-----------|
| frappe-gantt SVG sticky 헤더가 CSS로 동작하지 않음 | 중간 | SVG 내부 요소에 CSS sticky는 동작하지 않으므로, 초기 구현은 `#gantt-container .card-body`에 `max-height + overflow-y: auto`만 설정(§5.3 대안)하고, sticky가 필수인 경우 `renderGantt()` setTimeout 내에서 SVG의 `.upper-header`/`.lower-header` 요소를 DOM 오버레이로 복사하는 JS 방식 적용 |
| 토글 필터 변경 후 `renderGantt()` 재호출 시 frappe-gantt가 기존 SVG를 정리하지 않아 중복 렌더링 발생 | 중간 | `renderGantt()` 진입 시 `chartContainer.innerHTML = ''`로 항상 초기화 (기존 코드 line 2418에 이미 있음) |
| Jira issuelinks에서 linkedKey가 현재 프로젝트 외부 이슈를 참조할 수 있음 | 낮음 | 제한 없이 저장. URL로만 저장하므로 외부 이슈 참조도 클릭 가능 |
| 선행 태스크 검색 UI에서 기존 체크박스 이벤트(`triggerDatePreview`)와 충돌 | 낮음 | 검색 입력창은 독립 `input` 이벤트, 체크박스 change 이벤트는 기존 이벤트 위임 방식 유지 |

### 5.2 의존성 리스크

- `gantt-add-task-btn` element를 `getElementById`로 참조하는 코드가 app.js에 5군데 존재(lines 1892, 1895, 1919, 1926, 1932). FR-004로 element를 HTML에서 삭제하면 모두 null을 반환한다. `null` guard (`if (el)`) 처리 필요.

### 5.3 대안

- **FR-003 sticky 대안**: 날짜 헤더 고정 대신 간트차트 컨테이너 높이를 `max-height: calc(100vh - 200px)`으로 고정하고 내부 스크롤을 허용하는 것만으로도 UX가 개선될 수 있다. sticky 구현이 어려울 경우 이 방식으로 fallback.
- **FR-002 토글 대안**: 재렌더링 대신 frappe-gantt 렌더링 후 SVG의 `.bar-label` text 요소를 직접 조작하는 방식도 가능하나, 유지보수 복잡도가 높아 재렌더링 방식을 권장.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 | 관련 함수/섹션 |
|------|------|---------------|
| app.js | `src/main/resources/static/js/app.js` | `convertToGanttTasks()` line 2361, `renderGantt()` line 2406, `loadProjectTasks()` line 971, `loadTaskModalProjectData()` line 3145, `showTaskModal()` line 2990 |
| index.html | `src/main/resources/static/index.html` | `#gantt-section` line 327~362, `#taskModal` line 941~1088, `#assignee-schedule-section` line 274~324 |
| styles.css | `src/main/resources/static/css/styles.css` | frappe-gantt 커스텀 섹션 line 524~593 |
| JiraApiClient.java | `src/main/java/com/timeline/service/JiraApiClient.java` | `BOARD_FIELDS` line 40, `parseIssue()` line 298 |
| JiraImportService.java | `src/main/java/com/timeline/service/JiraImportService.java` | `importIssues()` line 138, `buildExistingTaskMap()` line 358 |
| JiraDto.java | `src/main/java/com/timeline/dto/JiraDto.java` | `JiraIssue` inner class line 46 |
| TaskLink.java | `src/main/java/com/timeline/domain/entity/TaskLink.java` | 전체 |
| TaskLinkRepository.java | `src/main/java/com/timeline/domain/repository/TaskLinkRepository.java` | `findByTaskIdOrderByCreatedAtAsc`, `deleteByTaskId` |

### frappe-gantt 0.6.1 옵션 참고

- `bar_height`: 바 높이 (px)
- `padding`: 바 위아래 여백 (px)
- row 총 높이 = `bar_height + padding * 2`
- 현재: `bar_height=30, padding=14` → 58px/row
- 목표: `bar_height=20, padding=8` → 36px/row

### Jira issuelinks API 응답 구조

```json
"issuelinks": [
  {
    "type": {
      "name": "Blocks",
      "inward": "is blocked by",
      "outward": "blocks"
    },
    "outwardIssue": {
      "key": "PROJ-45",
      "fields": { "status": { "name": "To Do" } }
    }
  },
  {
    "type": {
      "name": "Blocks",
      "inward": "is blocked by",
      "outward": "blocks"
    },
    "inwardIssue": {
      "key": "PROJ-12"
    }
  }
]
```

각 issuelink entry에는 `outwardIssue` 또는 `inwardIssue` 중 하나만 존재한다.
