# 개발 계획서: Jira To Do 필터 수정 및 간트차트 Sticky Header 배경 고정

## 1. 개요

- **기능 설명**: 두 가지 독립적인 버그 수정
  1. Jira 이슈 가져오기 모달에서 "To Do" 상태 필터가 한국어 Jira 인스턴스에서 동작하지 않는 문제
  2. 간트차트 날짜 헤더 sticky 처리 시 배경 rect는 스크롤되고 텍스트(날짜)만 고정되어 가독성이 떨어지는 문제
- **개발 배경**: 한국어 Jira 워크플로를 사용하는 환경에서 상태명이 영문("To Do")이 아닌 한국어("할 일")로 되어 있어 JQL 필터 및 클라이언트 사이드 재필터링 모두 실패. 간트차트는 SVG z-order 문제로 배경 rect가 content에 가려져 날짜 텍스트 배경이 하얗게 되지 않음.
- **작성일**: 2026-04-13

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-01**: Jira "To Do" 필터를 상태명이 아닌 **statusCategory** 기반으로 동작하게 수정
  - To Do = statusCategory.key `"new"`, JQL 값 `"To Do"`
  - In Progress = statusCategory.key `"indeterminate"`, JQL 값 `"In Progress"`
  - Done = statusCategory.key `"done"`, JQL 값 `"Done"`
  - JQL (다중 선택 예시): `statusCategory in ("To Do", "In Progress")` — `=` 가 아닌 `in` 연산자 사용 (JQL에서 `statusCategory`는 `=`, `!=`, `in`, `not in` 연산자를 지원함)
  - 단일 선택 시에도 `in` 연산자로 통일: `statusCategory in ("To Do")`
  - 백엔드 클라이언트 사이드 재필터링도 statusCategory 기반으로 전환
- **FR-02**: 간트차트 sticky header에서 배경 rect(`rect.grid-header`)가 날짜 텍스트 레이어(`g.date`)와 함께 스크롤에 고정되도록 수정
  - 스크롤 시 배경 rect와 텍스트 layer가 동일 y 위치에 유지
  - 배경 rect가 날짜 헤더 영역 전체(상단 month row + 하단 day row) 높이를 커버
  - 배경이 완전히 불투명하게 처리되어 그 아래 bar content가 비치지 않아야 함

### 2.2 비기능 요구사항

- **NFR-01**: JQL injection 방지 — statusCategory 값도 allowlist 검증 적용
- **NFR-02**: 기존 영문 상태명 Jira 인스턴스와의 하위 호환성 유지
- **NFR-03**: SVG DOM 조작은 frappe-gantt 렌더링 완료 후 실행 (기존 setTimeout 패턴 유지)

### 2.3 가정 사항

- Jira Cloud REST API v3는 status 객체 내부에 `statusCategory` 하위 객체를 포함하며, `statusCategory.key` 값은 항상 `"new"`, `"indeterminate"`, `"done"` 세 가지임
- frappe-gantt SVG 구조: `g.grid > rect.grid-header` (배경), `g.date` (날짜 텍스트). `rect.grid-header`의 초기 y는 0이 아닐 수 있으며(frappe-gantt 렌더링 시 패딩 포함 가능), height는 frappe-gantt 내부 `header_height` 설정에 따라 결정됨(기본값 약 50px). 본 구현에서는 초기 height를 `.lower-text`의 실제 y값 기반으로 동적 재설정하므로 초기값에 무관하게 동작
- 현재 `setupGanttStickyHeader()`에서 `rect.grid-header`를 SVG 마지막 자식(z-order 최상위)으로 이동시키는 방식은 유지하되, `height`/`opacity` 재설정 로직 및 스크롤 시 `width` 동기화 로직을 추가

### 2.4 제외 범위 (Out of Scope)

- Jira 상태 매핑 UI 커스터마이징 (STATUS_MAP 직접 편집 기능)
- frappe-gantt 라이브러리 자체 수정
- In Review, On Hold, Blocked 등 추가 상태 필터 체크박스 신설

---

## 3. 시스템 설계

### 3.1 현재 버그 원인 분석

#### FR-01: Jira To Do 필터 버그

```
흐름:
1. index.html 체크박스 value="To Do"
2. startJiraPreview() → statusFilter = ["To Do"]
3. POST /api/v1/projects/{id}/jira/preview body: {statusFilter: ["To Do"]}
4. JiraApiClient.buildJql() → JQL: status in ("To Do")
5. 한국어 Jira: status 이름이 "할 일"이므로 JQL 결과 0건
   (단, Board API는 JQL status 필터를 무시하고 전체 이슈를 반환하는 경우가 있음
    → 이 경우에는 6번 클라이언트 사이드 재필터링에 도달함)
6. 클라이언트 사이드 재필터링 (fetchAllBoardIssues line 163~166):
   issue.getStatus()("할 일").toLowerCase() vs lowerFilter("to do") → 소문자 변환 후에도 불일치 → 0건
   ※ Board API가 전체 이슈를 반환하는 경우 이 단계에서도 버그가 발생하므로 함께 수정 필요
7. JiraImportService.STATUS_MAP에는 "할 일"→TODO 매핑이 있어 import 시에는 정상 작동
```

문제 핵심: **JQL 필터 기준이 status name(언어 의존)인데, statusCategory(언어 무관)로 바꿔야 함**

Jira REST API 응답의 status 필드 구조:
```json
{
  "status": {
    "name": "할 일",
    "statusCategory": {
      "key": "new",
      "name": "To Do"
    }
  }
}
```

해결: JQL을 `status in (...)` 대신 `statusCategory in ("To Do", "In Progress", "Done")`로 변경

Jira JQL statusCategory 값:
| UI 라벨 | JQL 값 | statusCategory.key |
|---------|--------|---------------------|
| To Do | `"To Do"` | `"new"` |
| In Progress | `"In Progress"` | `"indeterminate"` |
| Done | `"Done"` | `"done"` |

#### FR-02: 간트차트 Sticky Header 배경 버그

```
현재 코드:
- rect.grid-header: g.grid 내부에서 SVG 마지막 자식으로 이동됨 (appendChild → SVG z-order 최상위)
- g.date: SVG 마지막 자식으로 이동됨 (appendChild → z-order 최상위, rect 위)
  ※ SVG는 HTML과 달리 z-index가 없으며 DOM 순서가 그대로 z-order가 됨. 나중에 선언된(appendChild된) 요소가 위에 그려짐
- 스크롤 시: rect.y = scrollTop, g.date.transform = translate(0, scrollTop)

버그 원인 후보:
1. rect.grid-header의 초기 height가 날짜 헤더(month row + day row) 전체 높이보다 작을 수 있음
   → 실제 frappe-gantt 기본 header_height = 50px, rect.grid-header height도 50px으로 그려지나
     month row (상단 텍스트)가 0~25px, day row (하단 텍스트)가 25~50px 영역을 차지하므로
     height가 맞더라도 SVG 렌더링 후 z-order 때문에 다른 요소(grid-row 등)가 rect 위에 위치할 수 있음
2. g.date를 SVG.appendChild()로 이동 후 rect.grid-header도 SVG.appendChild()로 이동하면
   DOM 순서: ... rect.grid-header → g.date
   SVG z-order: g.date가 rect 위에 그려짐 → 텍스트는 보임 (OK)
   하지만 rect이 content(bar group 등)보다 위에 있어야 배경 역할을 함
   현재 코드 순서:
     svg.appendChild(gridHeaderRect); // 먼저
     svg.appendChild(dateLayer);      // 나중 → dateLayer가 rect 위
   이 순서는 올바름. 그러나 rect의 y 업데이트와 translate가 같은 scrollTop을 참조하므로
   rect과 dateLayer의 y 시작점이 일치해야 함.
3. 실제 문제: frappe-gantt의 grid-row (각 태스크 행 배경)가 SVG에서 g.grid 내부에 있고,
   g.grid는 SVG에서 bar group보다 앞서 렌더링됨. g.grid를 통째로 이동시키지 않고
   rect만 이동했으므로 grid의 나머지 요소(grid-row, row-line, tick)들은 원래 위치에 남고,
   스크롤 시 rect.y가 업데이트되어도 grid-row들이 rect 위에 z-order로 오지 않는 한
   rect 배경이 가려지지 않아야 함.
   실제로는: today-highlight, bar-wrapper 등이 svg.appendChild로 추가된 요소들보다
   나중에 추가된 경우, 또는 frappe-gantt가 내부적으로 re-render 시 SVG를 rebuild하면서
   커스텀 appendChild된 요소들의 위치가 틀어질 수 있음.
4. 가장 유력한 원인: g.date의 초기 transform이 `translate(0, 0)` 또는 `translate(0, N)`으로
   설정되어 있어, scrollTop=0일 때 rect.y=0이어야 하지만 g.date 내부 텍스트들은
   이미 header offset이 적용된 y값을 가지고 있음. rect.y를 scrollTop으로 업데이트하면
   rect 상단이 scrollTop에 위치하지만, g.date의 transform=translate(0, scrollTop)이면
   g.date 내 텍스트들의 실제 y = 텍스트고유y + scrollTop이 됨. 만약 텍스트고유y가
   양수(예: upper-text y=10, lower-text y=36)라면 둘은 정렬됨.
   문제는 rect height가 고정되어 있지 않고, 스크롤 후 rect.y 이동만으로는
   rect 배경 영역이 시각적으로 "기존 헤더 영역"을 덮지 못할 수 있음.
```

핵심 수정 방향:
- `rect.grid-header` height를 g.date의 실제 높이(lower-text의 최대 y + font-size)로 동적으로 재설정
- rect.y 와 g.date translate를 항상 같은 scrollTop 기준으로 동기화 (현재도 동일하게 되어 있음 → 다시 확인 필요)
- `rect.grid-header`의 width가 SVG 전체 폭을 커버하는지 확인 (주말 제거 후 너비 변화 반영 필요)

### 3.2 데이터 모델

**FR-01**: 변경 필요

`JiraDto.JiraIssue`에 `statusCategoryKey` 필드 추가:

```java
// JiraDto.java - JiraIssue
private String statusCategoryKey;  // "new" | "indeterminate" | "done"
```

**FR-02**: 데이터 모델 변경 없음 (프론트엔드 JS 수정만)

### 3.3 API 설계

API 엔드포인트 변경 없음. 기존 `POST /api/v1/projects/{id}/jira/preview` 및 `POST /api/v1/projects/{id}/jira/import` 유지.

`PreviewRequest.statusFilter` 필드의 의미가 "상태명 목록"에서 "statusCategory JQL 값 목록"으로 변경됨:

| 기존 값 | 변경 후 값 | JQL (기존) | JQL (변경 후) |
|---------|-----------|-----------|--------------|
| `"To Do"` | `"To Do"` | `status in ("To Do")` | `statusCategory in ("To Do")` |
| `"In Progress"` | `"In Progress"` | `status in ("In Progress")` | `statusCategory in ("In Progress")` |
| `"Done"` | `"Done"` | `status in ("Done")` | `statusCategory in ("Done")` |

값 자체는 동일하되 JQL 생성 방식이 변경됨.

### 3.4 서비스 계층

#### JiraApiClient 변경사항

1. **`buildJql()` 메서드 수정**:
   - `status in (...)` → `statusCategory in (...)` 로 변경
   - `ALLOWED_STATUS_VALUES` 허용리스트도 statusCategory JQL 값에 맞게 교체
     - 기존: 영문 상태명 + 한국어 상태명 (총 ~20개)
     - 변경 후: `Set.of("To Do", "In Progress", "Done")` (3개만 허용)
     - 이유: statusCategory 방식에서는 JQL에 상태명이 아닌 카테고리명만 전달되므로
       한국어 상태명 및 기타 영문 상태명을 allowlist에 포함할 이유가 없음

2. **`parseIssue()` 메서드 수정**:
   - `status.statusCategory.key` 파싱하여 `statusCategoryKey` 필드 설정
   - `statusObj`가 not-null인 경우에만 `statusCategory` 하위 객체 접근 (NPE 방지)

3. **`fetchAllBoardIssues()` 클라이언트 사이드 재필터링 수정**:
   - 현재: `issue.getStatus().toLowerCase().trim()` vs `statusFilter`(소문자) 비교
   - 변경: `issue.getStatusCategoryKey()` vs 카테고리 key 매핑 비교
   - 매핑 방향: statusFilter(UI 값) → statusCategoryKey(파싱 결과)

```java
// statusFilter 값(UI) → statusCategory.key 매핑 (buildJql 전 변환 또는 재필터링 시 사용)
private static final Map<String, String> STATUS_CATEGORY_KEY_MAP = Map.of(
        "To Do", "new",
        "In Progress", "indeterminate",
        "Done", "done"
);

// 재필터링 예시:
Set<String> categoryKeyFilter = statusFilter.stream()
        .filter(s -> s != null && !s.isBlank())
        .map(s -> STATUS_CATEGORY_KEY_MAP.getOrDefault(s, s.toLowerCase()))
        .collect(Collectors.toSet());
allIssues = allIssues.stream()
        .filter(issue -> issue.getStatusCategoryKey() != null
                && categoryKeyFilter.contains(issue.getStatusCategoryKey()))
        .collect(Collectors.toList());
```

#### JiraDto 변경사항

`JiraIssue` 클래스에 `statusCategoryKey` 필드 추가.

### 3.5 프론트엔드

#### FR-01: app.js (변경 없음)

`startJiraPreview()`에서 statusFilter 수집 및 전송 로직은 동일. 백엔드 JQL 생성 방식만 변경.

#### FR-02: app.js - `setupGanttStickyHeader()` 수정

현재 코드(app.js line 2638) 대비 변경점:
- **[추가]** `gridHeaderRect`의 `height`를 `g.date` 내 `.lower-text` 실제 y 좌표 기반으로 동적 계산하여 재설정
- **[추가]** `gridHeaderRect`에 `opacity='1'` 명시 (투명도로 인해 bar content가 비치는 문제 방지)
- **[추가]** 스크롤 시 `gridHeaderRect.width`를 SVG 전체 폭으로 동기화 (주말 제거 후 SVG 폭이 줄어들어 rect이 부족하게 덮이는 경우 대응)
- **[유지]** rAF throttle, 이전 리스너 제거, `svg.appendChild` z-order 이동 로직 등은 현행과 동일

```javascript
function setupGanttStickyHeader(chartEl) {
    var scrollContainer = document.querySelector('#gantt-container .card-body');
    if (!scrollContainer) return;
    var svg = chartEl.querySelector('svg');
    if (!svg) return;

    var gridLayer = svg.querySelector('g.grid');
    var dateLayer = svg.querySelector('g.date');
    if (!gridLayer || !dateLayer) return;

    var gridHeaderRect = gridLayer.querySelector('rect.grid-header');

    // [추가] rect.grid-header의 height를 날짜 헤더 전체 높이로 동적 재설정
    // g.date 내 .lower-text의 최대 y값 + 폰트 여유(16px) = 헤더 하단 경계
    // upperTexts는 height 계산에 불필요하므로 사용하지 않음 (lower-text y가 최대값)
    if (gridHeaderRect && dateLayer) {
        var lowerTexts = dateLayer.querySelectorAll('.lower-text');
        var maxY = 0;
        lowerTexts.forEach(function(t) {
            var y = parseFloat(t.getAttribute('y') || 0);
            if (y > maxY) maxY = y;
        });
        // lower-text y + 폰트 크기(약 14px) + 여유(2px) = 헤더 하단 경계
        var headerHeight = maxY > 0 ? maxY + 16 : 50;
        gridHeaderRect.setAttribute('height', headerHeight);
        gridHeaderRect.setAttribute('fill', '#ffffff');
        // [추가] opacity 명시적으로 1 설정 (투명도 방지)
        gridHeaderRect.setAttribute('opacity', '1');
    }

    // 기존: rect.grid-header와 g.date를 SVG 마지막 자식(z-order 최상위)으로 이동
    // 순서: rect 먼저, date layer 나중 → date layer가 rect 위에서 보임
    if (gridHeaderRect) {
        svg.appendChild(gridHeaderRect);
    }
    svg.appendChild(dateLayer);

    // 이전 스크롤 리스너 제거
    if (scrollContainer._ganttStickyScrollHandler) {
        scrollContainer.removeEventListener('scroll', scrollContainer._ganttStickyScrollHandler);
    }

    var rafPending = false;
    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function() {
            rafPending = false;
            var scrollTop = scrollContainer.scrollTop;
            if (gridHeaderRect) {
                gridHeaderRect.setAttribute('y', scrollTop);
                // [추가] 스크롤 시 SVG 전체 폭에 맞춰 width 재설정 (주말 제거 후 폭 변화 반영)
                var svgWidth = parseFloat(svg.getAttribute('width') || svg.getBoundingClientRect().width || 1000);
                gridHeaderRect.setAttribute('width', svgWidth);
            }
            if (dateLayer) {
                dateLayer.setAttribute('transform', 'translate(0,' + scrollTop + ')');
            }
        });
    }

    scrollContainer._ganttStickyScrollHandler = onScroll;
    scrollContainer.addEventListener('scroll', onScroll);
    onScroll(); // 초기 호출
}
```

### 3.6 기존 시스템 연동

| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `JiraDto.java` | 필드 추가 | `JiraIssue.statusCategoryKey` |
| `JiraApiClient.java` | 메서드 수정 | `buildJql()`, `parseIssue()`, `fetchAllBoardIssues()` 재필터링 로직 |
| `app.js` | 함수 수정 | `setupGanttStickyHeader()` |

`JiraImportService.java`는 변경 불필요 (STATUS_MAP은 상태명 기반으로 유지, 이미 한국어/영어 모두 처리).

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `JiraDto.JiraIssue`에 `statusCategoryKey` 필드 추가 | `@Builder` 필드 추가 | 낮음 | 없음 |
| T-02 | `JiraApiClient.parseIssue()` 수정 | `status.statusCategory.key` 파싱 로직 추가 | 낮음 | T-01 |
| T-03 | `JiraApiClient.buildJql()` 수정 | `status in` → `statusCategory in` 변경, `ALLOWED_STATUS_VALUES`를 `{"To Do","In Progress","Done"}` 3개로 교체 | 낮음 | 없음 |
| T-04 | `JiraApiClient.fetchAllBoardIssues()` 재필터링 수정 | statusCategoryKey 기반 필터링으로 교체 | 보통 | T-01, T-02 |
| T-05 | `app.js setupGanttStickyHeader()` 수정 | headerHeight 동적 계산, opacity=1, width 재설정 | 보통 | 없음 |

### 4.2 구현 순서

1. **Step 1 - DTO 수정** (T-01)
   - `JiraDto.java`의 `JiraIssue` static inner class에 `statusCategoryKey` 필드 추가

2. **Step 2 - 백엔드 파싱 수정** (T-02)
   - `JiraApiClient.parseIssue()` 에서 `fields.status.statusCategory.key` 추출
   - `JiraIssue.builder().statusCategoryKey(...)` 설정

3. **Step 3 - JQL 생성 수정** (T-03)
   - `buildJql()` 내 `"status in (...)"` → `"statusCategory in (...)"` 변경
   - `BOARD_FIELDS` 상수 확인: `status` 필드에 `statusCategory`가 포함되어 있는지 확인
     - Jira API에서 `fields=status`를 요청하면 statusCategory가 중첩 포함됨 (별도 필드 추가 불필요)

4. **Step 4 - 클라이언트 사이드 재필터링 수정** (T-04)
   - `fetchAllBoardIssues()` 하단의 status 재필터링 로직 수정
   - statusFilter 값 → statusCategory.key 매핑 Map 생성
   - `issue.getStatusCategoryKey()` 기반 필터링으로 교체

5. **Step 5 - 프론트엔드 sticky header 수정** (T-05)
   - `app.js`의 `setupGanttStickyHeader()` 함수 수정
   - headerHeight 동적 계산 로직 추가
   - opacity=1, width 동기화 로직 추가

### 4.3 테스트 계획

**FR-01 수정 검증**:
- 한국어 Jira 인스턴스에서 "To Do" 필터 체크 후 프리뷰 실행 → "할 일" 상태 이슈가 결과에 포함되어야 함
- 영문 Jira 인스턴스에서 "To Do" 필터 → 기존과 동일하게 동작 (하위 호환)
- "In Progress"만 체크 → 진행 중인 이슈만 필터링
- "전체" 체크 → statusFilter 없이 전체 조회
- 백엔드 로그에서 생성된 JQL 확인: `statusCategory in ("To Do")` 형태인지 검증

**FR-02 수정 검증**:
- 간트차트 로드 후 세로 스크롤 → 날짜 헤더 텍스트와 배경이 함께 고정되어야 함
- 주말 제거 모드에서도 동일하게 동작
- 전체 프로젝트 통합 간트(merge gantt)와 단일 프로젝트 간트 양쪽에서 검증

---

## 5. 리스크 및 고려사항

### 기술적 리스크

1. **statusCategory 필드 가용성**: Jira Cloud REST API v3에서 `status` 필드 요청 시 `statusCategory`가 항상 중첩 포함되는지 확인 필요. 만약 별도로 `expand=names,renderedFields` 등을 요청해야 한다면 `BOARD_FIELDS`에 명시 필요.
   - **완화**: 현재 `BOARD_FIELDS`에 `status`가 포함되어 있고 Jira Cloud API는 status 내 statusCategory를 기본 포함. 단, Jira Server/Data Center는 다를 수 있으나 현재 구현이 Jira Cloud 대상이므로 무관.

2. **frappe-gantt 버전에 따른 SVG 클래스명 차이**: `g.date`, `rect.grid-header` 클래스명이 버전에 따라 다를 수 있음.
   - **완화**: 현재 코드에서 이미 이 클래스명을 사용 중이고 부분적으로 동작하고 있으므로 클래스명은 일치하는 것으로 판단.

3. **`lower-text` y값이 0인 경우**: 날짜 헤더 텍스트가 없거나 y=0이면 headerHeight 계산이 실패할 수 있음.
   - **완화**: `maxY > 0 ? maxY + 16 : 50` 폴백으로 기본값 50px 사용.

### 의존성 리스크

- 이 수정은 독립적인 버그 수정으로 다른 기능에 영향 없음
- `JiraImportService.STATUS_MAP`은 변경하지 않으므로 실제 태스크 상태 매핑 로직은 유지

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `src/main/java/com/timeline/service/JiraApiClient.java` - `buildJql()` (line 261), `parseIssue()` (line 320), 재필터링 (line 157)
- `src/main/java/com/timeline/dto/JiraDto.java` - `JiraIssue` (line 46)
- `src/main/java/com/timeline/service/JiraImportService.java` - `STATUS_MAP` (line 45) — 변경 불필요
- `src/main/resources/static/js/app.js` - `setupGanttStickyHeader()` (line 2638), `startJiraPreview()` (line 5286)
- `src/main/resources/static/index.html` - Jira 상태 필터 체크박스 (line 1154)

### Jira API 참고

- Jira Cloud REST API v3 status 응답 구조: `fields.status.statusCategory.key`
- JQL statusCategory 키워드: `statusCategory in ("To Do", "In Progress", "Done")`
  - 참고: https://support.atlassian.com/jira-software-cloud/docs/jql-fields/#Status-category
- statusCategory.key 값: `new` (To Do), `indeterminate` (In Progress), `done` (Done)

### 이전 관련 계획서

- `docs/dev-plan/28-jira-fixes-and-ux.md` — 이전 Jira 버그 수정 계획
- `docs/dev-plan/29-gantt-ux-and-improvements.md` — 간트차트 UX 개선 계획
- `docs/dev-plan/30-jira-todo-filter-and-gantt-sticky.md` — 동일 주제 이전 계획서 (개요 수준)
- `docs/dev-plan/31-jira-todo-gantt-click-md.md` — 동일 주제 이전 계획서 (상세 분석 포함)
