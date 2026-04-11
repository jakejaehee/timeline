# 개발 계획서: 날짜 요일 표시 및 프로젝트 상세 개요 탭 제거

## 1. 개요

- **기능 설명**: (1) 프로젝트 관련 모든 날짜 표시에 요일을 추가하고, (2) 프로젝트 상세 화면의 '개요' 탭을 제거하여 해당 정보를 인라인으로 표시하며, (3) 태스크 종료일 클라이언트/서버 계산 로직 일치 여부를 검증한다.
- **개발 배경 및 목적**: 시작일/론치일만 보고도 요일을 즉시 파악할 수 있도록 사용성을 개선하고, 프로젝트 상세 진입 시 '개요' 탭을 별도로 클릭해야 하는 불필요한 단계를 제거한다. 또한 태스크 수정 폼의 종료일 미리보기 계산이 서버와 일치하는지 확인하여 신뢰성을 확보한다.
- **작성일**: 2026-04-11

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 프로젝트 목록(대시보드 최근 프로젝트, 프로젝트 목록 테이블) 화면의 시작일/론치일 컬럼에 `formatDateWithDay` 함수를 적용한다.
- **FR-002**: 대시보드 '마감 임박 프로젝트' 카드의 론치일에도 `formatDateWithDay`를 적용한다.
- **FR-003**: 프로젝트 상세 화면의 '개요' 탭(tab-overview)을 제거한다.
- **FR-004**: 제거한 개요 탭의 정보(유형 badge, 상태 badge, 시작일, 론치일, 설명)를 프로젝트 상세 헤더 영역(`project-detail-title` 옆)에 인라인으로 표시한다.
- **FR-005**: 프로젝트 상세 진입 시 기본 활성 탭을 '태스크' 탭으로 변경한다.
- **FR-006**: 개요 탭에 있던 지연 경고 알림(`isDelayed` 표시)을 인라인 헤더 영역에 유지한다.
- **FR-007**: 프로젝트 상세 개요 내 `formatDate` 호출을 `formatDateWithDay`로 교체한다.
- **FR-008**: 프로젝트 수정 모달의 지연 경고 메시지 내 `expectedEndDate` / `endDate` 표시에도 `formatDateWithDay`를 적용한다.
- **FR-009**: 태스크 상세 뷰(멤버별 태스크 패널 및 프로젝트 태스크 탭)의 시작일/종료일 행에도 `formatDateWithDay`를 적용한다.
- **FR-010**: `calculateEndDateClient` 함수와 서버 `BusinessDayCalculator.calculateEndDate` 로직의 일치 여부를 분석하고 차이가 있으면 문서화한다.

### 2.2 비기능 요구사항

- **NFR-001**: 백엔드 코드 변경 없음. 순수 프론트엔드(app.js, index.html) 수정만 수행한다.
- **NFR-002**: 기존 전역 함수 패턴(var 선언, async/await)을 그대로 따른다.
- **NFR-003**: 앱 재시작 후 기능이 정상 동작함을 확인한다.

### 2.3 가정 사항

- `formatDateWithDay(dateStr)` 함수는 이미 app.js 152번째 줄에 구현되어 있으며 `"YYYY-MM-DD(월)"` 형식을 반환한다.
- 개요 탭 제거 후 탭 구조는 `태스크 | 멤버` 두 개로 단순화된다.
- 개요 탭에 있던 진행률 카드(progress bar)는 인라인 헤더에 포함하거나 태스크 탭으로 이동할 수 있다. 본 계획에서는 **진행률 카드는 제거(프로젝트 상세에서 불필요)**하고 시작일/론치일/상태/유형/설명만 인라인 표시한다.
- `loadProjectOverview` 함수는 탭 제거 후 사용되지 않으므로 호출부를 함께 제거한다.

### 2.4 제외 범위 (Out of Scope)

- 태스크 시작일/종료일 표시(`formatDate` → `formatDateWithDay` 전환): 이미 태스크 카드 라인(1169, 3477, 3521번 줄)에는 `formatDateWithDay`가 적용되어 있음. 태스크 상세 테이블 행(2644, 2645, 3560, 3561번 줄)의 교체는 FR-009로 포함.
- 서버측 BusinessDayCalculator 코드 변경 없음.
- 공휴일 목록 테이블의 날짜(`formatDate` 사용 중, 4432번 줄)는 이번 범위에서 제외.

---

## 3. 시스템 설계

### 3.1 데이터 모델

변경 없음. 순수 프론트엔드 변경.

### 3.2 API 설계

변경 없음. 기존 API를 동일하게 사용.

### 3.3 서비스 계층

변경 없음.

### 3.4 프론트엔드 변경 사항

#### 3.4.1 `app.js` 수정 위치 정리

| 위치(줄) | 현재 코드 | 변경 후 | 관련 FR |
|----------|-----------|---------|---------|
| 436 | `formatDate(p.endDate)` (대시보드 마감임박 론치일) | `formatDateWithDay(p.endDate)` | FR-002 |
| 466 | `formatDate(p.startDate) + ' ~ ' + formatDate(p.endDate)` (대시보드 최근프로젝트 기간) | `formatDateWithDay(p.startDate) + ' ~ ' + formatDateWithDay(p.endDate)` | FR-001 |
| 754 | `formatDate(p.startDate)` (프로젝트 목록 시작일) | `formatDateWithDay(p.startDate)` | FR-001 |
| 755 | `formatDate(p.endDate)` (프로젝트 목록 론치일) | `formatDateWithDay(p.endDate)` | FR-001 |
| 812 | `var tabMap = { 'overview': '#tab-overview', 'tasks': '#tab-tasks', 'members': '#tab-members' }` (`showProjectDetail` 내 tabName 분기) | `'overview'` 키 제거: `var tabMap = { 'tasks': '#tab-tasks', 'members': '#tab-members' }` | FR-003 |
| 830 | `await loadProjectOverview(projectId)` | `await loadProjectTasks(projectId)` 로 교체 (개요 탭 제거 후 진입 시 태스크를 직접 로드) | FR-003, FR-005 |
| 833~902 | `loadProjectOverview` 함수 전체 (833번 줄 시작, 902번 줄 `}` 종료) | 함수 전체 삭제 | FR-003 |
| 843 | `document.getElementById('project-detail-title').textContent = p.name` (loadProjectOverview 내부) | 삭제 대상 — loadProjectOverview 함수 제거 시 함께 제거됨. 대신 `renderProjectDetailHeader(p)` 함수가 프로젝트명 설정을 담당 | FR-004 |
| 868 | `formatDate(p.startDate)` (개요 테이블 시작일, loadProjectOverview 내부) | 삭제 대상 — loadProjectOverview 함수 제거 시 함께 제거됨 | FR-007 |
| 869 | `formatDate(p.endDate)` (개요 테이블 론치일, loadProjectOverview 내부) | 삭제 대상 — loadProjectOverview 함수 제거 시 함께 제거됨 | FR-007 |
| 886 | `formatDate(p.expectedEndDate)`, `formatDate(p.endDate)` (지연 경고, loadProjectOverview 내부) | 삭제 대상 — loadProjectOverview 함수 제거 시 함께 제거됨. 동등 로직은 `renderProjectDetailHeader(p)` 내 `formatDateWithDay`로 새로 작성 | FR-007 |
| 1334 | `formatDate(p.expectedEndDate)`, `formatDate(p.endDate)` (수정 모달 지연 경고) | `formatDateWithDay(...)` | FR-008 |
| 1339 | `formatDate(p.expectedEndDate)`, `formatDate(p.endDate)` (수정 모달 정상 메시지) | `formatDateWithDay(...)` | FR-008 |
| 2644 | `formatDate(task.startDate)` (태스크 상세 시작일) | `formatDateWithDay(task.startDate)` | FR-009 |
| 2645 | `formatDate(task.endDate)` (태스크 상세 종료일) | `formatDateWithDay(task.endDate)` | FR-009 |
| 3560 | `formatDate(task.startDate)` (멤버별 태스크 패널 시작일) | `formatDateWithDay(task.startDate)` | FR-009 |
| 3561 | `formatDate(task.endDate)` (멤버별 태스크 패널 종료일) | `formatDateWithDay(task.endDate)` | FR-009 |
| 4342 | `showProjectDetail(projectId, 'overview')` (경고 알림 클릭 시 개요 탭으로 진입) | `showProjectDetail(projectId)` 또는 `showProjectDetail(projectId, 'tasks')` 로 교체 — 개요 탭 제거 후 'overview' tabName은 무효 | FR-003 |
| 4722~4724 | `case '#tab-overview': loadProjectOverview(currentDetailProjectId); break;` (탭 전환 이벤트 리스너) | 해당 case 블록 전체 삭제 | FR-003 |

#### 3.4.2 `index.html` 수정 위치 정리

| 위치(줄) | 현재 코드 | 변경 후 | 관련 FR |
|----------|-----------|---------|---------|
| 244~266 | `<ul class="nav nav-tabs">` + `tab-overview` + `tab-tasks` + `tab-members` | `tab-overview` 탭 항목 및 `tab-pane` 제거. 첫 active 탭을 `tab-tasks`로 변경 | FR-003, FR-005 |
| 236 | `<h2 id="project-detail-title" class="mb-0"></h2>` | 헤더 영역 확장: 프로젝트명 + 인라인 메타 컨테이너 추가 | FR-004 |

#### 3.4.3 인라인 헤더 렌더링 설계

기존 `loadProjectOverview` 함수는 제거하고, `showProjectDetail` 진입 시 프로젝트 데이터를 로드하여 헤더 영역에 인라인으로 렌더링한다.

**렌더링 대상 위치**: `index.html` 내 `project-detail-view` 헤더 영역. 프로젝트명 h2 바로 아래에 `id="project-detail-meta"` div를 신설한다.

**표시 정보 (한 줄 인라인)**:
```
[유형 badge] [상태 badge]  시작일: YYYY-MM-DD(요일)  ~  론치일: YYYY-MM-DD(요일)  |  설명 텍스트
```

지연 경고는 헤더 아래 별도 div(`id="project-detail-delay-warning"`)에 표시한다.

**신규 함수 `renderProjectDetailHeader(p)`**:
- 인자: 프로젝트 API 응답 객체 `p`
- 동작: `project-detail-title` 텍스트 설정 + `project-detail-meta` 인라인 메타 렌더링 + `project-detail-delay-warning` 지연 경고 렌더링
- 호출 위치: `showProjectDetail` 함수 내 프로젝트 데이터 로드 완료 후

**주의 — `showProjectDetail` 내 프로젝트 데이터 fetch 추가 필요**:
기존 `showProjectDetail` 함수(785번 줄)는 프로젝트 API(`/api/v1/projects/{id}`)를 직접 호출하지 않고 `loadProjectOverview`에 위임했다. `loadProjectOverview` 제거 후에는 `showProjectDetail` 또는 별도의 async 헬퍼 함수에서 프로젝트 데이터를 직접 fetch한 뒤 `renderProjectDetailHeader(p)`에 전달해야 한다. 830번 줄 교체 시 아래 패턴을 따른다:

```javascript
// 기존: await loadProjectOverview(projectId);
// 변경 후:
var projRes = await apiCall('/api/v1/projects/' + projectId);
var p = (projRes.success && projRes.data) ? projRes.data : {};
renderProjectDetailHeader(p);
await loadProjectTasks(projectId);
```

### 3.5 종료일 계산 로직 검증 (FR-010)

#### 서버 로직 — `BusinessDayCalculator.calculateEndDate`

```
effectiveCapacity = capacity != null && capacity > 0 ? capacity : 1.0
actualDuration = ceil(manDays / effectiveCapacity)   // BigDecimal 올림
businessDays = actualDuration (최소 1, manDays > 0일 때)

endDate = ensureBusinessDay(startDate, unavailableDates)  // 시작일 보정
daysAdded = 1  // 시작일 = 1번째 영업일

while (daysAdded < businessDays):
    endDate += 1일
    if isBusinessDay(endDate, unavailableDates): daysAdded++
```

**핵심**: 시작일 자체를 1번째 영업일로 카운트.

#### 클라이언트 로직 — `calculateEndDateClient` (app.js 3944번 줄)

```javascript
effectiveCapacity = (capacity && capacity > 0) ? capacity : 1.0
actualDuration = Math.ceil(manDays / effectiveCapacity)
businessDays = actualDuration (최소 1, manDays > 0일 때)

d = new Date(startDateStr)

// 시작일이 비가용일이면 다음 가용일로 보정 (while 루프)
// 이후:
daysAdded = 1  // 시작일 = 1번째 영업일

while (daysAdded < businessDays):
    d += 1일
    if (주말 아님 && 비가용일 아님): daysAdded++
```

**핵심**: 동일하게 시작일 자체를 1번째 영업일로 카운트.

#### 검증 결론

두 로직의 알고리즘 구조는 **일치**한다.

- capacity 계산: 양쪽 모두 `ceil(MD / capacity)`, capacity null/0이면 1.0
- 시작일 영업일 보정: 양쪽 모두 비가용일이면 다음 영업일로 이동
- 카운팅: 양쪽 모두 시작일 = 1번째 영업일, `daysAdded < businessDays` 동안 반복
- 비가용일 반영: 서버는 `Set<LocalDate> unavailableDates`, 클라이언트는 `cachedHolidayDates + cachedMemberLeaveDates[assigneeId]`

**잠재적 차이점 (주의 필요)**:

1. **비가용일 캐시 로드 시점**: 클라이언트는 `cachedHolidayDates`와 `cachedMemberLeaveDates` 전역 캐시를 사용한다. 이 캐시가 초기화되지 않았거나 오래된 경우 서버 계산과 다를 수 있다. 앱 초기화 시점에 캐시가 로드되는지 확인이 필요하다.
2. **JavaScript `new Date(dateStr + 'T00:00:00')` 타임존**: 로컬 타임존 기준으로 Date 객체가 생성되므로 서버(Java LocalDate)와 날짜 해석이 동일하다. 별도 타임존 이슈 없음.
3. **manDays = 0 케이스**: 서버는 `startDate` 반환, 클라이언트도 동일. 일치.

**결론: 현재 로직은 서버/클라이언트 간 일치하며, 비가용일 캐시가 정상 로드된 경우 동일한 결과를 반환한다.**

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 파일 | 작업 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `app.js` | 대시보드 날짜 `formatDateWithDay` 적용 (436, 466번 줄) | 낮음 | 없음 |
| T-02 | `app.js` | 프로젝트 목록 날짜 `formatDateWithDay` 적용 (754, 755번 줄) | 낮음 | 없음 |
| T-03 | `index.html` | `tab-overview` 탭 항목 및 pane 제거, 기본 탭을 `tab-tasks`로 변경 | 낮음 | 없음 |
| T-04 | `index.html` | 헤더 영역에 `project-detail-meta` 및 `project-detail-delay-warning` div 신설 | 낮음 | 없음 |
| T-05 | `app.js` | `renderProjectDetailHeader(p)` 함수 신설 (인라인 메타 렌더링) | 중간 | T-04 |
| T-06 | `app.js` | `showProjectDetail` 수정: (a) 830번 줄 `loadProjectOverview` 호출을 `loadProjectTasks`로 교체, (b) `renderProjectDetailHeader` 호출 추가, (c) 812번 줄 `tabMap`에서 `'overview'` 키 제거 | 낮음 | T-05 |
| T-07 | `app.js` | `loadProjectOverview` 함수(833~902번 줄) 전체 삭제 | 낮음 | T-06 |
| T-08 | `app.js` | 수정 모달 지연 경고 메시지 `formatDateWithDay` 적용 (1334, 1339번 줄) | 낮음 | 없음 |
| T-09 | `app.js` | 태스크 상세 뷰 시작일/종료일 `formatDateWithDay` 적용 (2644, 2645, 3560, 3561번 줄) | 낮음 | 없음 |
| T-10 | `app.js` | 경고 알림 클릭 핸들러(4342번 줄) `showProjectDetail(projectId, 'overview')` → `showProjectDetail(projectId, 'tasks')` 교체 | 낮음 | T-03 |
| T-11 | `app.js` | 탭 전환 이벤트 리스너(4722~4724번 줄) `#tab-overview` case 블록 삭제 | 낮음 | T-03 |

### 4.2 구현 순서

1. **Step 1 — 단순 교체 (T-01, T-02, T-08, T-09)**: app.js 내 `formatDate` → `formatDateWithDay` 일괄 교체. 단순 텍스트 치환이므로 사이드 이펙트 없음.
2. **Step 2 — HTML 구조 변경 (T-03, T-04)**: index.html에서 탭 구조 수정 및 인라인 메타 컨테이너 추가.
3. **Step 3 — 함수 신설 (T-05)**: `renderProjectDetailHeader(p)` 함수 작성. 프로젝트명, 유형 badge, 상태 badge, 시작일, 론치일, 설명, 지연 경고를 렌더링한다.
4. **Step 4 — 기존 함수 연결 변경 (T-06)**: `showProjectDetail` 함수에서 (a) 830번 줄 `loadProjectOverview` 호출을 `loadProjectTasks`로 교체, (b) `renderProjectDetailHeader(p)` 호출을 그 앞에 추가(프로젝트 데이터를 먼저 fetch해야 하므로 API 호출 포함), (c) 812번 줄 `tabMap`에서 `'overview'` 키 제거.
5. **Step 5 — 구 함수 제거 (T-07)**: `loadProjectOverview` 함수(833~902번 줄) 전체 삭제.
6. **Step 6 — 참조 정리 (T-10, T-11)**: 4342번 줄 `showProjectDetail(projectId, 'overview')` 교체 및 4722~4724번 줄 탭 이벤트 리스너 `#tab-overview` case 삭제.
7. **Step 7 — 검증**: 앱 재시작 후 각 화면에서 날짜 요일 표시 및 탭 동작 확인.

### 4.3 `renderProjectDetailHeader` 함수 상세 설계

```javascript
function renderProjectDetailHeader(p) {
    // 프로젝트명 설정
    document.getElementById('project-detail-title').textContent = p.name || '';

    // 인라인 메타 렌더링
    var metaEl = document.getElementById('project-detail-meta');
    var metaHtml = '';
    metaHtml += typeBadge(p.projectType) + ' ';
    metaHtml += statusBadge(p.status) + ' ';
    metaHtml += '<span class="text-muted" style="font-size:0.88rem;">';
    metaHtml += formatDateWithDay(p.startDate) + ' ~ ' + formatDateWithDay(p.endDate);
    metaHtml += '</span>';
    if (p.description) {
        metaHtml += ' <span class="text-muted" style="font-size:0.85rem;">| ' + escapeHtml(p.description) + '</span>';
    }
    metaEl.innerHTML = metaHtml;

    // 지연 경고 렌더링
    var delayEl = document.getElementById('project-detail-delay-warning');
    if (p.isDelayed === true) {
        delayEl.innerHTML = '<div class="alert alert-danger py-2 px-3 mb-0" style="font-size:0.85rem;">'
            + '<i class="bi bi-exclamation-triangle-fill"></i> 예상 종료일('
            + formatDateWithDay(p.expectedEndDate) + ')이 론치일('
            + formatDateWithDay(p.endDate) + ')을 초과합니다.</div>';
        delayEl.style.display = 'block';
    } else if (p.isDelayed === false) {
        delayEl.innerHTML = '<div class="alert alert-success py-2 px-3 mb-0" style="font-size:0.85rem;">'
            + '<i class="bi bi-check-circle-fill"></i> 정상 진행 중</div>';
        delayEl.style.display = 'block';
    } else {
        delayEl.style.display = 'none';
    }
}
```

### 4.4 `index.html` 헤더 영역 변경 상세

**변경 전**:
```html
<div class="d-flex align-items-center gap-3">
    <button class="btn btn-outline-secondary btn-sm" onclick="showProjectList()">
        <i class="bi bi-arrow-left"></i> 목록
    </button>
    <h2 id="project-detail-title" class="mb-0"></h2>
</div>
```

**변경 후**:
```html
<div class="d-flex flex-column gap-1 flex-grow-1">
    <div class="d-flex align-items-center gap-3">
        <button class="btn btn-outline-secondary btn-sm" onclick="showProjectList()">
            <i class="bi bi-arrow-left"></i> 목록
        </button>
        <h2 id="project-detail-title" class="mb-0"></h2>
    </div>
    <div id="project-detail-meta" class="d-flex align-items-center gap-2 ps-1" style="font-size:0.88rem;"></div>
    <div id="project-detail-delay-warning" style="display:none;"></div>
</div>
```

**탭 변경 전**:
```html
<ul class="nav nav-tabs mb-3" id="project-detail-tabs">
    <li class="nav-item">
        <a class="nav-link active" data-bs-toggle="tab" href="#tab-overview">개요</a>
    </li>
    <li class="nav-item">
        <a class="nav-link" data-bs-toggle="tab" href="#tab-tasks">태스크</a>
    </li>
    <li class="nav-item">
        <a class="nav-link" data-bs-toggle="tab" href="#tab-members">멤버</a>
    </li>
</ul>
<div class="tab-content">
    <div id="tab-overview" class="tab-pane fade show active">
        <div id="project-overview-content">로딩 중...</div>
    </div>
    <div id="tab-tasks" class="tab-pane fade">
        ...
    </div>
    <div id="tab-members" class="tab-pane fade">
        ...
    </div>
</div>
```

**탭 변경 후**:
```html
<ul class="nav nav-tabs mb-3" id="project-detail-tabs">
    <li class="nav-item">
        <a class="nav-link active" data-bs-toggle="tab" href="#tab-tasks">태스크</a>
    </li>
    <li class="nav-item">
        <a class="nav-link" data-bs-toggle="tab" href="#tab-members">멤버</a>
    </li>
</ul>
<div class="tab-content">
    <div id="tab-tasks" class="tab-pane fade show active">
        ...
    </div>
    <div id="tab-members" class="tab-pane fade">
        ...
    </div>
</div>
```

### 4.5 테스트 계획

| 시나리오 | 확인 항목 |
|----------|-----------|
| 대시보드 로드 | 최근 프로젝트 기간 컬럼에 요일 표시 확인 (`2026-04-11(토)` 형식) |
| 대시보드 마감 임박 카드 | 론치일에 요일 표시 확인 |
| 프로젝트 목록 | 시작일/론치일 컬럼에 요일 표시 확인 |
| 프로젝트 상세 진입 | '개요' 탭 미존재 확인, 기본 탭 '태스크' 활성화 확인 |
| 프로젝트 상세 헤더 | 유형 badge, 상태 badge, 시작일(요일), 론치일(요일), 설명 인라인 표시 확인 |
| 프로젝트 상세 지연 경고 | `isDelayed=true` 프로젝트에서 지연 경고 헤더 아래 표시 확인 |
| 프로젝트 수정 모달 | 지연 경고 메시지 내 날짜에 요일 표시 확인 |
| 태스크 상세 패널 | 시작일/종료일 행에 요일 표시 확인 |
| 멤버별 태스크 패널 상세 | 시작일/종료일 행에 요일 표시 확인 |
| 앱 재시작 | `./gradlew bootRun` 재시작 후 전체 기능 정상 동작 확인 |

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

- **개요 탭 제거 시 JavaScript 탭 전환 로직 영향**: `#tab-overview`를 직접 참조하는 코드가 아래 세 곳에 존재하며 모두 수정이 필요하다.
  1. 812번 줄 `tabMap`의 `'overview': '#tab-overview'` 키 — 제거 필요 (T-06)
  2. 4342번 줄 `showProjectDetail(projectId, 'overview')` — `'tasks'`로 교체 필요 (T-10)
  3. 4722~4724번 줄 탭 이벤트 리스너 `case '#tab-overview'` 블록 — 삭제 필요 (T-11)
- **`loadProjectOverview` 제거 후 orphan 참조**: `project-overview-content` 요소를 제거하면 해당 id를 참조하는 다른 코드가 없는지 확인 필요 (grep 결과상 `loadProjectOverview` 함수 내부에서만 사용).
- **`showProjectDetail` 내 프로젝트 데이터 fetch 누락**: 기존 `loadProjectOverview` 제거 후 프로젝트명 및 메타 정보를 렌더링하려면 `showProjectDetail` 내에서 직접 `/api/v1/projects/{id}` API를 호출해야 한다. 이 fetch 코드 추가를 빠뜨리면 헤더 영역이 비어있게 된다. §4.3의 패턴 코드를 반드시 반영할 것.

### 5.2 주의사항

- `formatDateWithDay`는 입력값이 `null`/`undefined`/`''`이면 `'-'`를 반환하므로 날짜가 없는 경우 안전하다.
- 설명(description)이 길 경우 헤더 영역이 좁아 보일 수 있다. 긴 설명은 말줄임 처리(`text-truncate`, 최대 너비 설정)를 고려한다.

### 5.3 대안

- 개요 탭 정보를 태스크 탭 상단에 접을 수 있는 card 형태로 이동하는 방안도 있으나, 인라인 헤더 방식이 더 간결하므로 본 계획을 따른다.

---

## 6. 참고 사항

### 관련 파일 경로

- `/Users/jakejaehee/project/timeline/src/main/resources/static/js/app.js` — 주 변경 대상
- `/Users/jakejaehee/project/timeline/src/main/resources/static/index.html` — 탭 구조 및 헤더 HTML 변경
- `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/service/BusinessDayCalculator.java` — 서버 종료일 계산 로직 (참고 전용, 변경 없음)

### 관련 함수 위치 (app.js)

| 함수명 | 줄 번호 | 설명 |
|--------|---------|------|
| `formatDate` | 144 | 날짜 포맷 (변경 없음) |
| `formatDateWithDay` | 152 | 날짜+요일 포맷 (기존 함수 활용) |
| `loadDashboard` | ~340 | 대시보드 렌더링 (436, 466번 줄 수정) |
| `loadProjects` | 723 | 프로젝트 목록 렌더링 (754, 755번 줄 수정) |
| `showProjectDetail` | 785 | 프로젝트 상세 진입 (812번 줄 tabMap, 830번 줄 loadProjectOverview 호출 수정) |
| `loadProjectOverview` | 833~902 | 개요 탭 렌더링 (함수 전체 제거 대상) |
| `showProjectModal` | ~1260 | 프로젝트 수정 모달 (1334, 1339번 줄 수정) |
| `calculateEndDateClient` | 3944 | 클라이언트 종료일 계산 (변경 없음, 검증 완료) |
| 경고 알림 클릭 핸들러 | 4342 | `showProjectDetail(projectId, 'overview')` → `'tasks'`로 교체 |
| 탭 전환 이벤트 리스너 | 4716~4733 | `#tab-overview` case(4722~4724번 줄) 삭제 |
