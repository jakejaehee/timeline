# 개발 계획서: Jira "To Do" 상태 필터 버그 수정 및 간트차트 날짜 헤더 Sticky 구현

## 1. 개요

- **기능 설명**: 두 가지 독립적인 버그/기능 이슈를 처리한다. (1) Jira Import 모달에서 "To Do" 상태 필터가 실제로 이슈를 걸러내지 못하는 버그 수정. (2) 간트차트 날짜 헤더(frappe-gantt SVG 상단)가 세로 스크롤 시에도 화면 상단에 고정되도록 JS 기반 sticky 구현.
- **개발 배경**: Plan 29(29-gantt-ux-and-improvements.md)에서 FR-003(간트차트 sticky 헤더)을 `max-height + overflow-y: auto` 대안으로 잠시 대체했으나, SVG 내부 날짜 헤더는 실제로 sticky되지 않아 사용성이 저하된다. Jira "To Do" 필터 버그는 Board API가 `jql` 쿼리 파라미터의 status 조건을 무시하거나 URL 인코딩 이슈로 인해 필터가 적용되지 않는 현상이다.
- **작성일**: 2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: Jira Import 미리보기/실행 시 "To Do" 상태 필터가 올바르게 적용되어 "To Do" 이슈만 반환되어야 한다.
- **FR-002**: 간트차트에서 세로 스크롤 시 날짜 헤더 영역(상단 날짜 행)이 화면 상단에 고정되어야 한다.

### 2.2 비기능 요구사항

- **NFR-001**: JQL injection 방지를 위한 ALLOWED_STATUS_VALUES allowlist는 유지한다.
- **NFR-002**: sticky 헤더 구현은 frappe-gantt 라이브러리를 수정하지 않고 외부 DOM 조작으로만 처리한다.
- **NFR-003**: sticky 헤더는 단일 프로젝트 간트차트와 "전체 프로젝트" 모드 모두에서 동작해야 한다.

### 2.3 가정 사항

- Jira Board API(`/rest/agile/1.0/board/{boardId}/issue`)는 `jql` 쿼리 파라미터를 받더라도 공백이 포함된 status 값("To Do")을 올바르게 처리하지 못하거나, 일부 Jira 인스턴스에서 Board API의 status JQL 필터를 무시할 수 있다. 이는 Search API 폴백 경로를 통해 해결 가능하다.
- frappe-gantt@0.6.1의 SVG 날짜 헤더는 `<g class="date">` 레이어 안의 `<text class="upper-text">`, `<text class="lower-text">` 요소와, `<g class="grid">` 레이어 안의 `<rect class="grid-header">` 배경으로 구성된다. header_height 기본값은 50px, grid-header height는 60px이다.
- sticky 헤더는 `#gantt-container .card-body`가 스크롤 컨테이너이므로, 이 컨테이너의 scroll 이벤트를 감지하여 SVG 요소 위에 오버레이 div를 배치하는 방식으로 구현한다.

### 2.4 제외 범위 (Out of Scope)

- Jira 상태명 자동 감지 또는 동적 allowlist 관리
- frappe-gantt 라이브러리 교체
- 모바일 환경에서의 sticky 헤더 대응
- sticky 헤더의 가로 스크롤 동기화 (가로 스크롤은 `#gantt-chart` 내부에서 처리되므로 별도 대응 필요 없음)

---

## 3. 시스템 설계

### 3.1 버그 원인 분석

#### FR-001: Jira "To Do" 필터 버그

**코드 추적 결과:**

1. `index.html` 체크박스: `value="To Do"` (정상)
2. `app.js` `startJiraPreview()`: 체크박스 값을 읽어 `statusFilter = ['To Do']`로 설정 (정상)
3. `app.js` API 호출: `body.statusFilter = ['To Do']`를 POST body에 포함 (정상)
4. `JiraDto.PreviewRequest.statusFilter`: `List<String>` 역직렬화 (정상)
5. `JiraImportService.preview()`: `statusFilter`를 `jiraApiClient.fetchAllBoardIssues()`에 전달 (정상)
6. **`JiraApiClient.buildJql()`**: `status in ("To Do")` JQL 조건 생성 (정상)
7. **`JiraApiClient.fetchAllBoardIssues()`**: `UriComponentsBuilder.build(false).toUriString()`로 URL 생성

**핵심 버그 위치 — URL 인코딩 미적용:**

```java
// 현재 코드 (버그 있음)
String url = builder.build(false).toUriString();
// build(false) = encoded=false → URL 인코딩 미적용
// 결과: ...&jql=status in ("To Do")  ← 공백, 큰따옴표 미인코딩
```

`builder.build(false)`는 "이미 인코딩된 값"으로 처리하겠다는 의미이므로, JQL 문자열 내 공백(` `)과 큰따옴표(`"`)가 URL 인코딩되지 않는다. Jira API는 올바르게 인코딩된 URL을 기대하므로, 인코딩되지 않은 공백이 포함된 JQL이 서버에서 파싱 오류 또는 status 조건 무시로 이어진다.

**추가 버그 후보 — Board API의 status JQL 무시:**

일부 Jira 인스턴스의 Board API(`/rest/agile/1.0/board/{boardId}/issue`)는 `jql` 파라미터에 `status` 조건을 포함해도 이를 무시하고 board에 속한 모든 이슈를 반환한다. 이 경우 400 BadRequest가 발생하지 않으므로 Search API 폴백이 트리거되지 않아 status 필터가 실질적으로 무효화된다.

**수정 방향:**

1. URL 인코딩 수정: `builder.build(false)` → `builder.build().encode()` 로 변경. `build(false)`와 `build(true)` 모두 인코딩을 적용하지 않는다(`encoded` 파라미터는 "이미 인코딩된 값인가?"를 의미하므로 `true`도 재인코딩을 건너뜀). 올바른 인코딩은 `build()` 후 `encode()`를 체이닝하는 방식이다. 이 수정은 `fetchAllBoardIssues()`(line 117)와 `fetchIssuesByJql()`(line 203) 두 곳 모두에 적용해야 한다.
2. Board API에서도 status JQL이 확실히 적용되도록, Board API 응답 후 클라이언트 사이드 필터링 추가 (방어적 처리)

#### FR-002: 간트차트 sticky 헤더 미동작

**현재 상태 (Plan 29 대안 적용 후):**

```css
/* styles.css */
#gantt-container .card-body {
    max-height: calc(100vh - 180px);
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
}
```

frappe-gantt는 SVG로 렌더링하므로 CSS `position: sticky`가 `<svg>` 내부 `<rect>`, `<text>`, `<g>` 요소에는 적용되지 않는다. 결과적으로 세로 스크롤 시 날짜 헤더도 함께 올라가 버린다.

**SVG 내부 날짜 헤더 구조 (frappe-gantt 0.6.1):**

```
<svg>
  <g class="grid">
    <rect class="grid-header" y="0" height="60" />  ← 헤더 배경
    <rect class="grid-rows" />
    ...
  </g>
  <g class="date">
    <text class="upper-text" y="25">...</text>      ← 상위 날짜 (월/연도)
    <text class="lower-text" y="50">...</text>       ← 하위 날짜 (일/요일)
  </g>
  <g class="bar">...</g>
  ...
</svg>
```

**구현 방식 — 오버레이 div 방식:**

SVG 위에 절대 위치의 오버레이 div를 배치하여 날짜 헤더 영역을 복제하고, 스크롤 시 SVG에서 날짜 텍스트를 실시간 추출하여 오버레이에 반영한다. 그러나 이 방식은 SVG 텍스트와 HTML 텍스트 간 폰트/위치 동기화가 까다롭다.

**구현 방식 — SVG translate 방식 (채택):**

스크롤 이벤트에서 현재 scrollTop을 읽고, SVG 내부의 `<g class="grid">` (grid-header rect 포함)과 `<g class="date">` (upper-text, lower-text 포함)의 `transform` 속성을 `translate(0, scrollTop)`으로 갱신한다. 이렇게 하면 날짜 헤더가 SVG 좌표계 내에서 스크롤 오프셋만큼 아래로 이동하여 화면 기준으로 고정된 것처럼 보인다.

```
scrollTop = 100 (px) → grid-header와 date 레이어의 transform = "translate(0, 100)"
→ 날짜 헤더가 SVG 내 y=100 위치에 렌더링 → 화면에서는 항상 최상단에 위치
```

단, 헤더 레이어가 bar/arrow 레이어 위에 렌더링되어야 한다. frappe-gantt의 레이어 순서는 `grid → date → arrow → progress → bar → details`이므로, date 레이어는 bar 레이어 아래에 있다. 스크롤 시 헤더가 bar 위에 표시되어야 하므로 DOM 순서를 재조정하거나, z-index를 사용하는 foreignObject 방식을 채택한다.

**최종 채택 방식 — SVG 위 고정 div (헤더 캡처 방식):**

1. `renderGantt()` 완료 후 `setupGanttStickyHeader()` 함수 호출
2. SVG에서 grid-header rect의 높이(60px)와 date 레이어의 텍스트/위치를 읽어 동등한 HTML 구조를 가진 `<div id="gantt-sticky-header">` 를 `#gantt-container .card-body` 내부 최상단에 절대 위치로 삽입
3. 스크롤 이벤트 없이도 항상 `position: sticky; top: 0`으로 고정
4. SVG의 가로 스크롤에 따라 헤더 div도 동기화 (`scroll` 이벤트에서 `scrollLeft` 연동)

그러나 이 방식도 SVG 텍스트 위치와 HTML div 위치를 정확히 맞추기 어렵다.

**최종 채택 방식 — SVG 내부 translate 적용 (단순화):**

스크롤이 발생하면 date 레이어(`<g class="date">`)와 grid-header(`<rect class="grid-header">`)의 y 위치를 scrollTop만큼 보정한다. SVG 좌표에서 y=0인 요소를 y=scrollTop으로 이동하면, 스크롤 컨테이너(`#gantt-container .card-body`)의 시각적 상단(scrollTop 위치)에 헤더가 고정된다.

bar 레이어가 헤더 위에 그려지는 z-order 문제는 SVG의 `<defs>` + `<clipPath>`로 헤더 영역을 마스킹하거나, date/grid-header 레이어를 SVG DOM의 맨 마지막(최상위 z-order)으로 이동하여 해결한다.

### 3.2 API 설계 변경

FR-001 버그 수정은 백엔드 `JiraApiClient.java` 수정만으로 처리되므로 API 엔드포인트 변경 없음.

| Method | Endpoint | 변경 사항 |
|--------|----------|----------|
| POST | `/api/v1/projects/{id}/jira/preview` | 변경 없음 (내부 로직 수정) |
| POST | `/api/v1/projects/{id}/jira/import` | 변경 없음 (내부 로직 수정) |

### 3.3 백엔드 변경 사항

#### JiraApiClient.java 수정 (FR-001)

**수정 1: URL 인코딩 수정 (두 메서드 모두 적용)**

`fetchAllBoardIssues()`(Board API, line 117)와 `fetchIssuesByJql()`(Search API 폴백, line 203) 두 곳 모두 `build(false)`를 사용하고 있으므로, 두 곳 모두 수정한다.

```java
// 현재 코드 (버그) — fetchAllBoardIssues() line 117
String url = builder.build(false).toUriString();

// 현재 코드 (버그) — fetchIssuesByJql() line 197~203
String url = UriComponentsBuilder
        .fromHttpUrl(...)
        ...
        .build(false).toUriString();

// 수정 코드 (두 곳 공통)
String url = builder.build().encode().toUriString();
// build() → UriComponents 생성(인코딩 없음), encode() → 각 컴포넌트를 RFC 3986에 따라 인코딩
```

`encode()`를 호출하면 JQL 내 공백은 `%20`, 큰따옴표는 `%22`로 인코딩된다. Jira API는 URL 인코딩된 JQL을 정상적으로 파싱한다. `fetchIssuesByJql()`은 빌더를 inline으로 생성하므로 수정 형태는 다음과 같다:

```java
// fetchIssuesByJql() 수정 후
String url = UriComponentsBuilder
        .fromHttpUrl(baseUrl + "/rest/api/3/search")
        .queryParam("jql", jql)
        .queryParam("maxResults", MAX_RESULTS)
        .queryParam("startAt", startAt)
        .queryParam("fields", BOARD_FIELDS)
        .build().encode().toUriString();
```

**수정 2: Board API 응답 후 클라이언트 사이드 status 필터링 (방어적 처리)**

Board API가 JQL의 status 조건을 무시하고 전체 이슈를 반환하는 경우를 대비해, `fetchAllBoardIssues()` 내에서 최종 결과 반환 전 statusFilter로 이슈 목록을 재필터링.

```java
// fetchAllBoardIssues() 반환 직전
if (statusFilter != null && !statusFilter.isEmpty()) {
    List<String> safe = statusFilter.stream()
            .filter(ALLOWED_STATUS_VALUES::contains)
            .toList();
    if (!safe.isEmpty()) {
        allIssues = allIssues.stream()
                .filter(issue -> issue.getStatus() != null && safe.contains(issue.getStatus()))
                .collect(Collectors.toList());
        log.info("클라이언트 사이드 status 필터 적용: {} → {}건", safe, allIssues.size());
    }
}
```

`JiraDto.JiraIssue`에 `status` 필드가 존재하므로 (`parseIssue()`에서 `statusName`을 `status` 필드로 매핑) 바로 적용 가능하다.

### 3.4 프론트엔드 변경 사항 (FR-002)

#### setupGanttStickyHeader() 함수 신규 작성

`renderGantt()` 함수 내 `setTimeout()` 블록(주말 제거, 마커 추가 후)에서 `setupGanttStickyHeader(chartContainer)` 호출.

```javascript
/**
 * 간트차트 날짜 헤더 sticky 구현
 * SVG의 date 레이어와 grid-header를 DOM 최상위로 이동하고,
 * 스크롤 이벤트에서 translateY로 헤더 위치를 보정한다.
 * @param {HTMLElement} chartEl - #gantt-chart 또는 .gantt-project-chart 요소
 */
function setupGanttStickyHeader(chartEl) {
    // scrollContainer: 항상 #gantt-container .card-body (단일/전체 모드 공통 스크롤 컨테이너)
    // chartEl: SVG를 포함하는 #gantt-chart 요소 (SVG 탐색 전용, renderGantt/loadAllProjectsGantt 모두 동일 요소)
    var scrollContainer = document.querySelector('#gantt-container .card-body');
    if (!scrollContainer) return;
    var svg = chartEl.querySelector('svg');
    if (!svg) return;

    // SVG 레이어 참조
    var gridLayer = svg.querySelector('g.grid');
    var dateLayer = svg.querySelector('g.date');
    if (!gridLayer || !dateLayer) return;

    // grid-header rect (헤더 배경)
    var gridHeaderRect = gridLayer.querySelector('rect.grid-header');
    var headerHeight = gridHeaderRect ? parseFloat(gridHeaderRect.getAttribute('height')) || 60 : 60;

    // rect.grid-header와 g.date만 SVG의 마지막 자식으로 이동 (z-order 최상위)
    // 주의: gridHeaderRect.parentNode는 g.grid 전체이므로 사용하면 안 된다.
    // g.grid를 통째로 이동하면 grid-rows, row-line, tick, today-highlight 등이
    // 모두 bar 레이어 위에 겹쳐 태스크 바가 그리드 배경에 가려진다.
    // rect.grid-header 단독 이동 + g.date 이동만 수행한다.
    if (gridHeaderRect) {
        svg.appendChild(gridHeaderRect);
    }
    svg.appendChild(dateLayer);

    // 이전 스크롤 리스너 제거 (재렌더링 시 중복 방지)
    if (scrollContainer._ganttStickyScrollHandler) {
        scrollContainer.removeEventListener('scroll', scrollContainer._ganttStickyScrollHandler);
    }

    // requestAnimationFrame 기반 throttle: scroll 이벤트는 초당 수십 회 발생하므로
    // SVG setAttribute 호출이 과도하게 누적되지 않도록 rAF로 단일 프레임당 1회로 제한.
    var rafPending = false;
    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function() {
            rafPending = false;
            var scrollTop = scrollContainer.scrollTop;
            // grid-header 배경: y를 scrollTop으로 이동
            if (gridHeaderRect) {
                gridHeaderRect.setAttribute('y', scrollTop);
            }
            // date 레이어 텍스트: translateY 적용
            if (dateLayer) {
                dateLayer.setAttribute('transform', 'translate(0,' + scrollTop + ')');
            }
        });
    }

    scrollContainer._ganttStickyScrollHandler = onScroll;
    scrollContainer.addEventListener('scroll', onScroll);
    // 초기 호출 (scrollTop=0 상태 반영)
    onScroll();
}
```

#### loadAllProjectsGantt() 적용

전체 프로젝트 간트차트도 동일한 `#gantt-container .card-body` 스크롤 컨테이너를 사용하므로, `loadAllProjectsGantt()`의 setTimeout 블록에서도 동일하게 `setupGanttStickyHeader(chartContainer)` 호출.

#### CSS 보완

헤더가 bar 위에 표시될 때 배경이 투명하면 하단 내용이 비쳐 보이므로, `grid-header` rect에 불투명 배경 색을 보장하는 CSS 추가.

```css
/* 간트차트 sticky 헤더 배경 불투명화 */
#gantt-chart .gantt .grid-header {
    fill: #ffffff;
    opacity: 1;
}
```

### 3.5 기존 시스템 연동

- `renderGantt()` 함수: `setupGanttStickyHeader()` 호출 추가
- `loadAllProjectsGantt()` 함수: `setupGanttStickyHeader()` 호출 추가
- `reRenderGanttWithToggles()` 함수: `renderGantt()` 재호출로 자동 적용 (별도 수정 불필요)
- `removeGanttWeekends()` 함수: 주말 열 제거 시 SVG DOM을 조작하므로, sticky 헤더 설정이 주말 제거 완료 후 적용되어야 함 (현재 setTimeout 내 순서 유지)

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | JiraApiClient URL 인코딩 수정 | `build(false)` → `build().encode()` 변경 | 낮음 | 없음 |
| T-02 | Board API 응답 클라이언트 필터링 추가 | `fetchAllBoardIssues()` 반환 전 status 재필터링 | 낮음 | T-01 |
| T-03 | `setupGanttStickyHeader()` 함수 작성 | SVG 레이어 z-order 재배치 + scroll 이벤트 핸들러 | 중간 | 없음 |
| T-04 | `renderGantt()` 및 `loadAllProjectsGantt()`에 sticky 헤더 연동 | setTimeout 블록에 T-03 호출 추가 | 낮음 | T-03 |
| T-05 | CSS grid-header 불투명 배경 추가 | styles.css 수정 | 낮음 | T-03 |
| T-06 | 동작 확인 및 엣지케이스 처리 | 주말 제거 후, 뷰 모드 변경 후, 재렌더링 후 sticky 재적용 확인 | 중간 | T-04 |

### 4.2 구현 순서

1. **Step 1 (T-01, T-02)**: `JiraApiClient.java` 수정
   - `fetchAllBoardIssues()` line 117: `builder.build(false).toUriString()` → `builder.build().encode().toUriString()` 변경
   - `fetchIssuesByJql()` line 203: `.build(false).toUriString()` → `.build().encode().toUriString()` 변경 (같은 버그)
   - `fetchAllBoardIssues()` 반환 직전에 statusFilter 기반 클라이언트 사이드 재필터링 로직 추가

2. **Step 2 (T-03)**: `app.js`에 `setupGanttStickyHeader()` 함수 추가
   - SVG 내 `g.grid` (grid-header rect), `g.date` 레이어 참조
   - 레이어를 SVG 마지막 자식으로 이동
   - `#gantt-container .card-body`의 scroll 이벤트 핸들러 등록
   - 기존 핸들러 중복 제거 로직 포함

3. **Step 3 (T-04)**: `renderGantt()` 및 `loadAllProjectsGantt()`의 setTimeout 블록 마지막에 `setupGanttStickyHeader(chartContainer)` 호출 추가

4. **Step 4 (T-05)**: `styles.css`에 `.grid-header { fill: #ffffff; opacity: 1; }` CSS 추가

5. **Step 5 (T-06)**: 브라우저에서 동작 확인
   - "To Do" 상태 필터 선택 → 미리보기 실행 → To Do 이슈만 반환되는지 확인
   - 간트차트 로드 → 세로 스크롤 → 날짜 헤더 고정 확인
   - 뷰 모드(Day/Week/Month) 변경 후 sticky 헤더 재동작 확인
   - 주말 제거 후 sticky 헤더 정상 표시 확인

### 4.3 테스트 계획

#### FR-001 테스트 시나리오

- "To Do" 체크 → 미리보기: To Do 상태 이슈만 반환
- "In Progress" 체크 → 미리보기: In Progress 상태 이슈만 반환
- "To Do" + "In Progress" 체크 → 미리보기: 두 상태 이슈 모두 반환
- "전체 (필터 없음)" 체크 → 미리보기: 모든 상태 이슈 반환
- 아무것도 체크 안 함 → 미리보기: "To Do" 기본값 적용

#### FR-002 테스트 시나리오

- 단일 프로젝트 간트차트 로드 → 세로 스크롤 → 날짜 헤더 고정 확인
- 전체 프로젝트 간트차트 로드 → 세로 스크롤 → 날짜 헤더 고정 확인
- Day/Week/Month 뷰 모드 전환 후 sticky 헤더 재동작 확인
- 주말 제거(Day 모드) 후 sticky 헤더 정상 표시 확인
- 간트차트 재렌더링(태스크 수정 후) 시 이전 스크롤 핸들러 중복 등록 없음 확인

---

## 5. 리스크 및 고려사항

### 5.1 FR-001 리스크

- **Jira 상태명 대소문자/공백 차이**: Jira 인스턴스마다 "To Do", "TODO", "to do" 등 상태명이 다를 수 있다. 클라이언트 사이드 재필터링에서 대소문자를 무시하는 비교(`equalsIgnoreCase`)를 사용하면 허용 범위가 넓어져 오필터 가능성이 있다. ALLOWED_STATUS_VALUES allowlist를 그대로 유지하되, 클라이언트 사이드 재필터는 exact match로 처리한다.
- **Search API 폴백 동일 버그**: Board API 400 BadRequest → Search API 폴백 경로인 `fetchIssuesByJql()`(line 197~203)도 동일하게 `UriComponentsBuilder.build(false).toUriString()`을 사용하고 있으므로 동일한 URL 인코딩 버그가 존재한다. 수정 1에서 두 메서드 모두 `build().encode()` 로 수정한다.

### 5.2 FR-002 리스크

- **SVG DOM 조작 후 frappe-gantt 내부 참조 불일치**: frappe-gantt 인스턴스는 내부적으로 레이어 참조를 캐시하고 있을 수 있다. `rect.grid-header`를 `g.grid`에서 분리하여 SVG 직속 자식으로 이동하면, frappe-gantt 내부의 `this.layers.grid` 참조는 유지되나 해당 참조로 grid-header rect를 조작하는 내부 로직(있을 경우)은 적용되지 않는다. `g.date` 레이어를 마지막 자식으로 이동하면 `this.layers.date` 참조도 깨질 수 있다. 완화 방법: `ganttInstance` 메서드(`refresh()`, `change_view_mode()` 등)를 직접 호출하지 않고, 뷰 모드 변경 등의 경우 항상 `renderGantt()` 전체를 재실행하는 현재 패턴을 유지한다. `removeGanttWeekends()`가 `svg.querySelector('.grid-header')`로 rect를 찾아 width를 조정하는 로직은 DOM 위치에 무관하므로 안전하다.
- **주말 제거 후 SVG 구조 변경**: `removeGanttWeekends()` 함수는 SVG의 tick, column, grid-header 등 요소 width를 직접 수정한다. sticky 헤더 설정은 반드시 이 작업 이후에 실행되어야 한다. 현재 코드 구조상 setTimeout 블록 내 실행 순서가 보장되므로 안전하다.
- **가로 스크롤 시 헤더 위치 어긋남**: `g.date`는 `translate(0, scrollTop)`으로 처리하면 가로 스크롤에 무관하게 위치가 보정된다. 단, SVG 전체 가로 스크롤은 `#gantt-chart`의 `overflow-x: auto`에 의해 처리되므로 날짜 텍스트도 함께 가로로 이동한다. 별도 처리 불필요.
- **뷰 모드 변경 시 이전 핸들러 누적**: 뷰 모드 변경 시 `renderGantt()` 재호출 → `setupGanttStickyHeader()` 재호출이 이루어진다. 함수 내부에서 `scrollContainer._ganttStickyScrollHandler` 패턴으로 이전 핸들러를 제거하므로 중복 문제를 방지한다.

### 5.3 대안 방안

- FR-002 대안: `#gantt-container .card-body`를 스크롤 컨테이너로 유지하되, SVG 최상단(y=0)에 불투명 rect를 별도로 추가하여 bar가 헤더 배경 위에 보이지 않도록 마스킹하는 방식. 구현이 단순하지만 헤더 배경만 가려주고 텍스트는 여전히 스크롤된다.
- FR-002 완전 대안: frappe-gantt를 포기하고 커스텀 SVG 렌더링을 구현. 범위 초과.

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `src/main/java/com/timeline/service/JiraApiClient.java` — `buildJql()` (line 243), `fetchAllBoardIssues()` (line 88), Board API URL 생성 (line 117), `fetchIssuesByJql()` (line 162), Search API URL 생성 (line 197~203)
- `src/main/java/com/timeline/dto/JiraDto.java` — `PreviewRequest.statusFilter`, `ImportRequest.statusFilter` (line 141, 150)
- `src/main/resources/static/js/app.js` — `startJiraPreview()` (line 5223), `executeJiraImport()` (line 5329), `renderGantt()` (line ~2440), `loadAllProjectsGantt()` (line ~1987)
- `src/main/resources/static/css/styles.css` — `#gantt-container .card-body` 스크롤 설정 (line 494)
- `src/main/resources/static/index.html` — Jira 상태 필터 체크박스 (line 1154), 간트차트 컨테이너 구조 (line 345)

### 관련 계획서

- `docs/dev-plan/19-jira-integration.md` — Jira Import 초기 설계
- `docs/dev-plan/21-jira-import-enhancement.md` — 상태 필터 최초 도입
- `docs/dev-plan/26-batch-delete-chunk-status-filter-jira-status-filter.md` — ALLOWED_STATUS_VALUES allowlist 도입
- `docs/dev-plan/29-gantt-ux-and-improvements.md` — FR-003 sticky 헤더 (max-height 대안 적용)

### frappe-gantt 0.6.1 SVG 레이어 구조

```
<svg>
  <g class="grid">
    <rect class="grid-header" y="0" height="60" />
    <rect class="grid-rows" />
    <line class="row-line" />
    <rect class="today-highlight" />
    <line class="tick" />
  </g>
  <g class="date">
    <text class="upper-text" y="25">...</text>
    <text class="lower-text" y="50">...</text>
  </g>
  <g class="arrow">...</g>
  <g class="progress">...</g>
  <g class="bar">
    <g class="bar-wrapper">...</g>
  </g>
  <g class="details">...</g>
</svg>
```

- `header_height` 기본값: 50px
- `grid-header` rect height: `header_height + 10` = 60px
- `upper-text` y 좌표: `header_height - 25` = 25
- `lower-text` y 좌표: `header_height` = 50
