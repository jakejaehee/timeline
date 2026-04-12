# 개발 계획서: 프로젝트 목록 상태 필터

## 1. 개요

- **기능 설명**: 프로젝트 목록 화면(Projects 섹션)에 상태 기반 필터 버튼 바를 추가하여 원하는 상태의 프로젝트만 표시할 수 있도록 한다.
- **개발 배경 및 목적**: 프로젝트가 많아질수록 이미 완료된 프로젝트가 목록을 채워 실무에서 필요한 진행 중 프로젝트를 찾기 어렵다. "완료 제외" 필터를 기본값으로 설정하여 일반적인 업무 흐름에 맞춘 기본 뷰를 제공한다.
- **작성일**: 2026-04-13

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 프로젝트 목록 상단에 상태 필터 버튼 바를 표시한다.
- FR-002: 필터 옵션은 총 6가지이다: 전체 / 플래닝 / 진행중 / 완료 / 보류 / 완료 제외.
- FR-003: 기본 선택 값은 "완료 제외" (EXCLUDE_COMPLETED)이다.
- FR-004: 필터 선택 시 API를 재호출하지 않고 클라이언트 측에서 배열을 필터링하여 즉시 재렌더링한다.
- FR-005: 선택된 필터 값은 `localStorage`에 저장되어 페이지 새로고침 후에도 유지된다.
- FR-006: 필터 적용 후 해당 조건에 맞는 프로젝트가 없을 경우 "해당 상태의 프로젝트가 없습니다." 메시지를 표시한다.

### 2.2 비기능 요구사항

- NFR-001: 백엔드 API 변경 없음. 프론트엔드만 수정한다.
- NFR-002: 기존 `scheduleTaskStatusFilter` 패턴과 동일한 방식(전역 변수 + 함수 + 버튼 그룹 재렌더링)으로 구현하여 코드 일관성을 유지한다. 단, 이 필터는 프로젝트 **목록** 필터이므로 프로젝트 상세의 태스크 필터(`projectTaskStatusFilter`, `applyProjectStatusFilter`, `setProjectStatusFilter`)와 이름 충돌이 없도록 아래 §3.4에 정의된 접두사 `projectList`를 사용한다.
- NFR-003: `localStorage` 키는 `projectListStatusFilter`로 고정한다.

### 2.3 가정 사항

- API `GET /api/v1/projects`는 모든 프로젝트를 상태 구분 없이 반환한다 (현행 유지).
- `ProjectStatus` enum 값은 `PLANNING`, `IN_PROGRESS`, `COMPLETED`, `ON_HOLD` 4가지이다.
- "완료 제외" 필터는 `COMPLETED`를 제외한 나머지 세 가지 상태(`PLANNING`, `IN_PROGRESS`, `ON_HOLD`)를 모두 표시한다.

### 2.4 제외 범위 (Out of Scope)

- 서버 사이드 필터링 (쿼리 파라미터 전달) — 클라이언트 필터링으로 충분.
- 복수 상태 동시 선택 — 단일 선택 방식으로 구현.
- 대시보드 프로젝트 목록에 동일 필터 적용 — 별도 화면이므로 제외.

---

## 3. 시스템 설계

### 3.1 데이터 모델

변경 없음.

### 3.2 API 설계

변경 없음. 기존 `GET /api/v1/projects` 그대로 사용.

### 3.3 서비스 계층

변경 없음.

### 3.4 프론트엔드

#### 3.4.1 전역 변수 추가 (`app.js` 상단)

```javascript
// 기존 변수들 근처 (line ~33 근방, scheduleTaskStatusFilter 선언 아래)
var VALID_PROJECT_LIST_STATUS_FILTERS = ['ALL', 'EXCLUDE_COMPLETED', 'PLANNING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'];
var _savedProjectListFilter = localStorage.getItem('projectListStatusFilter');
var projectListStatusFilter = VALID_PROJECT_LIST_STATUS_FILTERS.indexOf(_savedProjectListFilter) !== -1
    ? _savedProjectListFilter
    : 'EXCLUDE_COMPLETED';
```

초기화 시점에 `localStorage`를 읽어 전역 변수를 세팅한다. 저장값이 없거나 유효한 6가지 값(`ALL`, `EXCLUDE_COMPLETED`, `PLANNING`, `IN_PROGRESS`, `COMPLETED`, `ON_HOLD`) 이외의 임의 문자열인 경우 `'EXCLUDE_COMPLETED'`를 기본값으로 대체한다.

> **주의**: 변수명은 `projectListStatusFilter`를 사용한다. 기존 코드에 이미 `projectTaskStatusFilter`(프로젝트 상세 태스크 필터)와 `applyProjectStatusFilter()` / `setProjectStatusFilter()` 함수가 존재하며(app.js line 1293~1304), 이들은 **프로젝트 상세 탭 내 태스크 필터** 전용이다. 이번 신규 변수/함수와 이름이 충돌하지 않도록 반드시 `projectList` 접두사를 사용한다.

#### 3.4.2 필터 적용 함수 추가 (`app.js`)

```javascript
/**
 * 프로젝트 목록 상태 필터 적용
 * (프로젝트 상세 태스크 필터 applyProjectStatusFilter와 별개)
 */
function applyProjectListStatusFilter(projects) {
    if (projectListStatusFilter === 'ALL') return projects;
    if (projectListStatusFilter === 'EXCLUDE_COMPLETED') {
        return projects.filter(function(p) { return p.status !== 'COMPLETED'; });
    }
    return projects.filter(function(p) { return p.status === projectListStatusFilter; });
}

/**
 * 프로젝트 목록 상태 필터 변경
 * (프로젝트 상세 태스크 필터 setProjectStatusFilter(status, projectId)와 별개)
 */
function setProjectListStatusFilter(status) {
    projectListStatusFilter = status;
    localStorage.setItem('projectListStatusFilter', status);
    renderProjectListFilterButtons();
    renderProjectsTable(window._cachedProjects || []);
}
```

`window._cachedProjects`는 마지막 API 응답 데이터를 캐싱하기 위한 변수로, `loadProjects()` 내에서 세팅한다.

> **캐시 정합성 주의**: `setProjectListStatusFilter()`는 API 재호출 없이 캐시된 `window._cachedProjects`를 재렌더링한다. 프로젝트 추가·삭제·수정 후에는 `loadProjects()`가 직접 호출되어 캐시를 갱신하므로(app.js line 1796, 1879) 정합성 문제가 없다. 단, 필터 전환 시에는 항상 캐시 기준으로 렌더링됨에 유의한다.

#### 3.4.3 필터 버튼 렌더링 함수 추가 (`app.js`)

> **ID 충돌 주의**: 기존 프로젝트 상세 태스크 필터도 `id="project-status-filter-group"`(app.js line 1026)을 동적으로 생성한다. 프로젝트 목록 필터는 **별도 ID** `project-list-status-filter-group`을 사용해야 충돌을 피할 수 있다.

```javascript
function renderProjectListFilterButtons() {
    var group = document.getElementById('project-list-status-filter-group');
    if (!group) return;
    var sf = projectListStatusFilter;
    group.innerHTML =
        '<button type="button" class="btn btn-sm '
            + (sf==='EXCLUDE_COMPLETED' ? 'btn-secondary' : 'btn-outline-secondary')
            + '" onclick="setProjectListStatusFilter(\'EXCLUDE_COMPLETED\')">완료 제외</button>'
        + '<button type="button" class="btn btn-sm '
            + (sf==='ALL' ? 'btn-dark' : 'btn-outline-dark')
            + '" onclick="setProjectListStatusFilter(\'ALL\')">전체</button>'
        + '<button type="button" class="btn btn-sm '
            + (sf==='PLANNING' ? 'btn-info' : 'btn-outline-info')
            + '" onclick="setProjectListStatusFilter(\'PLANNING\')">플래닝</button>'
        + '<button type="button" class="btn btn-sm '
            + (sf==='IN_PROGRESS' ? 'btn-primary' : 'btn-outline-primary')
            + '" onclick="setProjectListStatusFilter(\'IN_PROGRESS\')">진행중</button>'
        + '<button type="button" class="btn btn-sm '
            + (sf==='COMPLETED' ? 'btn-success' : 'btn-outline-success')
            + '" onclick="setProjectListStatusFilter(\'COMPLETED\')">완료</button>'
        + '<button type="button" class="btn btn-sm '
            + (sf==='ON_HOLD' ? 'btn-warning' : 'btn-outline-warning')
            + '" onclick="setProjectListStatusFilter(\'ON_HOLD\')">보류</button>';
}
```

#### 3.4.4 테이블 렌더링 함수 분리 (`app.js`)

`loadProjects()` 내 `forEach` 렌더링 블록을 `renderProjectsTable(projects)` 함수로 추출한다.

```javascript
function renderProjectsTable(projects) {
    var tbody = document.getElementById('projects-table');
    var filtered = applyProjectListStatusFilter(projects);

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">해당 상태의 프로젝트가 없습니다.</td></tr>';
        return;
    }

    var html = '';
    filtered.forEach(function(p) {
        // 기존 loadProjects() 내 forEach 블록과 동일
        // ...
    });
    tbody.innerHTML = html;
}
```

#### 3.4.5 `loadProjects()` 수정 (`app.js`)

```javascript
async function loadProjects() {
    document.getElementById('project-list-view').style.display = '';
    document.getElementById('project-detail-view').style.display = 'none';

    renderProjectListFilterButtons(); // 필터 버튼 렌더링

    try {
        var res = await apiCall('/api/v1/projects');
        var projects = (res.success && res.data) ? res.data : [];
        window._cachedProjects = projects; // 캐시 저장

        if (projects.length === 0) {
            // API에 등록된 프로젝트 자체가 0건인 경우 — 필터 무관하게 별도 메시지 표시
            document.getElementById('projects-table').innerHTML =
                '<tr><td colspan="10" class="text-center text-muted">등록된 프로젝트가 없습니다.</td></tr>';
            return;
        }

        // 1건 이상인 경우 필터를 적용하여 렌더링.
        // 필터 결과가 0건이면 renderProjectsTable() 내부에서
        // "해당 상태의 프로젝트가 없습니다." 메시지를 표시한다.
        renderProjectsTable(projects);
    } catch (e) {
        console.error('프로젝트 목록 로드 실패:', e);
        showToast('프로젝트 목록을 불러오는데 실패했습니다.', 'error');
    }
}
```

#### 3.4.6 HTML 변경 (`index.html`)

`#project-list-view` 내 `.section-header`와 `.card` 사이에 필터 바 `div`를 추가한다.

```html
<!-- 기존 .section-header 닫는 태그 다음 -->
<div class="d-flex align-items-center gap-2 mb-3">
    <span class="text-muted" style="font-size:0.85rem; white-space:nowrap;">상태 필터:</span>
    <div class="btn-group btn-group-sm" id="project-list-status-filter-group"></div>
</div>
```

삽입 위치 (현재 line 188 `</div>` 이후, line 189 `<div class="card">` 이전):

```html
<!-- line 188: .section-header 닫기 -->
</div>
<!-- 필터 바 (신규 추가) -->
<div class="d-flex align-items-center gap-2 mb-3">
    <span class="text-muted" style="font-size:0.85rem; white-space:nowrap;">상태 필터:</span>
    <div class="btn-group btn-group-sm" id="project-list-status-filter-group"></div>
</div>
<!-- line 189: 카드 시작 -->
<div class="card">
```

### 3.5 기존 시스템 연동

- 영향 받는 기존 코드
  - `loadProjects()`: 전체 재구성 (렌더링 로직 분리 + 캐시 + 필터 버튼 호출 추가)
  - `showProjectList()`: `loadProjects()` 호출 전에 별도 처리 없음 — 그대로 유지.
- 외부 API 연동 없음.

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | 전역 변수 추가 | `projectListStatusFilter` 초기화 (localStorage 연동 + 유효값 검증) | 낮음 | 없음 |
| T-02 | `applyProjectListStatusFilter()` 구현 | 6가지 필터 로직 | 낮음 | T-01 |
| T-03 | `renderProjectListFilterButtons()` 구현 | 버튼 그룹 HTML 생성 | 낮음 | T-01 |
| T-04 | `setProjectListStatusFilter()` 구현 | 필터 변경 + 저장 + 재렌더링 | 낮음 | T-02, T-03 |
| T-05 | `renderProjectsTable()` 분리 | 기존 `loadProjects()` 렌더링 블록 추출 | 낮음 | T-02 |
| T-06 | `loadProjects()` 수정 | 캐시 저장 + 필터 버튼 초기화 + `renderProjectsTable()` 호출 | 낮음 | T-04, T-05 |
| T-07 | `index.html` 수정 | 필터 바 DOM 추가 (`id="project-list-status-filter-group"`) | 낮음 | 없음 |

### 4.2 구현 순서

1. **index.html 수정** (T-07): `.section-header` 와 `.card` 사이에 필터 바 `div` 삽입.
2. **전역 변수 추가** (T-01): `app.js` 상단 전역 변수 블록(`~line 33`, `scheduleTaskStatusFilter` 선언 바로 아래)에 `VALID_PROJECT_LIST_STATUS_FILTERS` 배열과 `projectListStatusFilter` 추가.
3. **필터 로직 함수 추가** (T-02 ~ T-04): `applyProjectListStatusFilter`, `renderProjectListFilterButtons`, `setProjectListStatusFilter` 함수를 Projects 섹션 코드 근처(`~line 800`, `loadProjects()` 직전)에 추가.
4. **렌더링 분리 및 `loadProjects()` 수정** (T-05, T-06): 기존 `forEach` 블록을 `renderProjectsTable()`로 이동하고 `loadProjects()`를 정리.

### 4.3 테스트 계획

- 필터 버튼 6종 클릭 시 올바른 프로젝트 목록이 표시되는지 확인.
- 기본값 "완료 제외" 적용 확인 (초기 진입 시 COMPLETED 프로젝트 미표시).
- 페이지 새로고침 후 마지막 선택 필터가 복원되는지 확인 (localStorage 키: `projectListStatusFilter`).
- localStorage에 임의 문자열이 저장된 경우 기본값 `EXCLUDE_COMPLETED`로 복원되는지 확인.
- 필터 결과가 0건일 때 "해당 상태의 프로젝트가 없습니다." 메시지 표시 확인.
- 프로젝트 추가/삭제 후 `loadProjects()` 재호출 시 캐시 정상 갱신 확인.

---

## 5. 리스크 및 고려사항

| 항목 | 내용 | 완화 방안 |
|------|------|----------|
| 캐시 불일치 | 다른 탭/창에서 프로젝트가 변경되어도 `_cachedProjects`는 갱신되지 않음 | 이미 기존 구조가 단일 SPA이므로 동일한 리스크 존재. 허용 가능 수준. |
| `window._cachedProjects` 전역 오염 | window 전역 변수로 캐시 저장 | 기존 코드 패턴이 전역 `var` 변수 위주이므로 일관성 측면에서 허용. |
| 기존 함수명 충돌 | 기존 `applyProjectStatusFilter(tasks)`, `setProjectStatusFilter(status, projectId)` 함수(app.js line 1293~1304)가 프로젝트 상세 태스크 필터로 이미 존재 | 신규 함수는 반드시 `applyProjectListStatusFilter`, `setProjectListStatusFilter`, `renderProjectListFilterButtons` 이름 사용. 기존 함수 덮어쓰기 금지. |
| 기존 HTML ID 충돌 | 기존 코드(app.js line 1026)가 `id="project-status-filter-group"`을 동적 생성 | 신규 HTML 요소는 `id="project-list-status-filter-group"` 사용. |

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `src/main/resources/static/index.html` line 179-213: `#projects-section` > `#project-list-view` 구조
- `src/main/resources/static/js/app.js` line 804-853: 기존 `loadProjects()` 함수
- `src/main/resources/static/js/app.js` line 1293-1304: 기존 프로젝트 **태스크** 필터 함수 (`applyProjectStatusFilter`, `setProjectStatusFilter`) — **신규 함수와 이름 충돌 대상. 수정 금지.**
- `src/main/resources/static/js/app.js` line 1306-1322: `applyScheduleStatusFilter()` / `setScheduleStatusFilter()` — 동일 패턴 참고
- `src/main/resources/static/js/app.js` line 3892-3902: 스케줄 필터 버튼 렌더링 — 동일 패턴 참고
- `src/main/resources/static/js/app.js` line 33: `scheduleTaskStatusFilter` 전역 변수 선언 위치 (신규 변수는 line 34 이후에 삽입)

### 필터 버튼 색상 매핑 (기존 `statusBadge()` 함수와 일관성 유지)

| 상태 | active 색상 | Bootstrap 클래스 |
|------|------------|-----------------|
| EXCLUDE_COMPLETED (완료 제외) | 회색 | `btn-secondary` |
| ALL (전체) | 검정 | `btn-dark` |
| PLANNING (플래닝) | 하늘 | `btn-info` |
| IN_PROGRESS (진행중) | 파랑 | `btn-primary` |
| COMPLETED (완료) | 초록 | `btn-success` |
| ON_HOLD (보류) | 노랑 | `btn-warning` |
