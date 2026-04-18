# 개발 계획서: 마일스톤 추가 폼 - QA 유형 선택 시 QA 담당자 검색 입력란 표시

## 1. 개요

### 기능 설명
프로젝트 마일스톤 추가 폼에서 유형(type)을 **QA**로 선택하면, QA 담당자를 검색하여 지정할 수 있는 입력란이 동적으로 나타나도록 한다. 생성 시점에 QA 담당자를 함께 저장할 수 있어야 한다.

### 개발 배경 및 목적
현재 QA 담당자(`qaAssignees`)는 마일스톤을 **생성한 이후** 목록 행의 인라인 셀에서만 지정 가능하다. 생성 폼에는 QA 담당자 입력란이 없어, 사용자가 마일스톤을 생성한 뒤 한 번 더 목록으로 가서 담당자를 설정해야 하는 불편함이 있다. 생성 시점에 QA 담당자를 한 번에 지정할 수 있도록 UX를 개선한다.

### 작성일
2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항
- FR-001: 마일스톤 추가 폼의 유형 `<select>`에서 **QA**를 선택하면 QA 담당자 검색 입력란이 나타난다.
- FR-002: QA 이외의 유형을 선택하거나 선택 초기화 시 QA 담당자 입력란은 숨겨진다.
- FR-003: QA 담당자 검색 입력란은 기존 목록 행의 `qa-assignee-search` 패턴과 동일한 UX를 사용한다 (텍스트 입력 → 드롭다운 목록 → 뱃지 추가/제거).
- FR-004: 추가 버튼 클릭 시 선택된 QA 담당자 ID 목록을 `qaAssignees` 필드에 포함하여 POST 요청을 보낸다.
- FR-005: 마일스톤 추가 성공 후 QA 담당자 선택 상태도 초기화된다.
- FR-006: 멤버 목록은 `_msAllMembers` 캐시를 재사용한다. 마일스톤 탭이 이미 로드된 상태이면 캐시가 존재하므로 별도 API 호출 불필요.

### 2.2 비기능 요구사항
- NFR-001: 백엔드 변경 없음. 기존 `POST /api/v1/projects/{id}/milestones` API는 이미 `qaAssignees` 필드를 지원하므로 프론트엔드만 수정한다.
- NFR-002: 기존 목록 행의 QA 담당자 편집 UX와 시각적으로 일관성을 유지한다.
- NFR-003: `_msAllMembers`가 비어있을 경우(탭 첫 진입 전 폼 인터랙션)를 안전하게 처리한다.

### 2.3 가정 사항
- 생성 폼에서 선택하는 QA 담당자는 여러 명 지정 가능하다 (기존 목록 행과 동일).
- `_msAllMembers`는 `loadProjectMilestones()` 호출 시 채워지므로, 사용자가 탭에 들어온 시점에는 이미 데이터가 있다.
- 별도의 서버 검색 API 없이 클라이언트 측 필터링으로 충분하다 (기존 패턴과 동일).

### 2.4 제외 범위 (Out of Scope)
- 백엔드 API 변경 (변경 불필요)
- 마일스톤 목록 행의 기존 QA 담당자 편집 UI 변경
- 생성 폼 이외의 다른 화면에서의 QA 담당자 입력 개선

---

## 3. 시스템 설계

### 3.1 데이터 모델
변경 없음. 기존 `ProjectMilestone.qaAssignees` 컬럼(`VARCHAR(500)`, 쉼표 구분 멤버 ID 문자열)을 그대로 사용한다.

### 3.2 API 설계
변경 없음. 기존 API를 그대로 활용한다.

| Method | Endpoint | 설명 | Request | Response |
|--------|----------|------|---------|----------|
| POST | `/api/v1/projects/{id}/milestones` | 마일스톤 생성 | `{ name, type, days, startDate, endDate, qaAssignees }` | `{ success, data }` |
| GET | `/api/v1/members` | 멤버 목록 조회 (기존 캐시 재사용) | - | `{ success, data: [{id, name, role}] }` |

`qaAssignees`는 이미 `ProjectService.createMilestone()`에서 `body.containsKey("qaAssignees")` 분기로 처리되므로 추가 없이 프론트에서 해당 키를 body에 포함하면 된다.

### 3.3 서비스 계층
변경 없음.

### 3.4 프론트엔드

#### 3.4.1 index.html — 마일스톤 추가 폼 변경

**파일:** `src/main/resources/static/index.html` (line 218~254)

현재 추가 폼 구조 (변경 전):
```html
<div class="row g-2 align-items-end">
    <div class="col-auto">유형 select</div>
    <div class="col-auto">이름 input</div>
    <div class="col-auto">일수 input</div>
    <div class="col-auto">시작일 input</div>
    <div class="col-auto">종료일 input</div>
    <div class="col-auto">추가 button</div>
</div>
```

변경 후: 유형 select와 추가 버튼 사이에 `id="proj-ms-qa-wrap"` div 삽입. 초기 `display:none`.

```html
<!-- 추가할 부분: 종료일 col-auto 다음, 추가 버튼 col-auto 직전에 삽입 -->
<div class="col-auto" id="proj-ms-qa-wrap" style="display:none;">
    <label class="form-label mb-0" style="font-size:0.8rem;">QA 담당자</label>
    <div class="qa-assignee-cell" id="proj-ms-qa-cell">
        <div class="d-flex flex-wrap gap-1 mb-1" id="proj-ms-qa-badges"></div>
        <div class="position-relative">
            <input type="text"
                   class="form-control form-control-sm"
                   id="proj-ms-qa-search"
                   placeholder="멤버 검색..."
                   style="width:150px;"
                   autocomplete="off">
        </div>
        <div class="list-group position-absolute"
             id="proj-ms-qa-results"
             style="z-index:1050; max-height:150px; overflow-y:auto; display:none; width:200px;">
        </div>
    </div>
</div>
```

**주요 ID 목록:**
- `proj-ms-qa-wrap` — 전체 래퍼 (show/hide 대상)
- `proj-ms-qa-cell` — 클릭 외부 감지용 `.qa-assignee-cell` 컨테이너
- `proj-ms-qa-badges` — 선택된 QA 담당자 뱃지 목록
- `proj-ms-qa-search` — 검색 텍스트 input
- `proj-ms-qa-results` — 검색 결과 드롭다운

#### 3.4.2 app.js — 함수 변경 및 신규 함수 추가

**파일:** `src/main/resources/static/js/app.js`

##### (A) `proj-ms-type` select에 `onchange` 핸들러 연결

`index.html`의 `<select id="proj-ms-type">` 태그에 `onchange="onMsTypeChange(this.value)"` 속성 추가.

또는 `loadProjectMilestones()` 이후 또는 페이지 초기화 시 JS로 이벤트 리스너를 바인딩한다.

선택: `index.html` 태그에 `onchange` 인라인 속성으로 추가하는 것이 기존 코드 패턴과 일치한다.

##### (B) 신규 함수: `onMsTypeChange(typeValue)`

```
위치: addProjectMilestone() 함수 근처 (line 4156 부근)

동작:
- typeValue === 'QA' 이면 proj-ms-qa-wrap을 display:'' 로 변경
- 그 외이면 display:'none', 뱃지/검색란 초기화
```

##### (C) 신규 함수: `initMsFormQaSearch()`

```
위치: initQaAssigneeSearch() 함수 근처 (line 4091 부근)

동작:
- #proj-ms-qa-search input에 oninput 이벤트 바인딩
- _msAllMembers 기반 클라이언트 필터링 (이름/역할 매칭)
- 이미 선택된 멤버 제외
- 결과 클릭 시 addMsFormQaAssignee(memberId) 호출
- 외부 클릭 시 드롭다운 닫기 (기존 document click 이벤트와 통합)
```

`initMsFormQaSearch()`는 `loadProjectMilestones()` 내에서 `_msAllMembers`가 채워진 직후, `milestones.length === 0` early return 분기보다 **앞에** 호출해야 한다. `milestones.length === 0`일 때 return하면 함수 말미에 도달하지 못하므로, `_msAllMembers` 세팅 직후(`results` 처리 완료 후)에 호출해야 마일스톤이 없는 상태에서도 QA 폼 검색이 정상 동작한다.

구체적 위치:
```js
_msAllMembers = (results[1].success && results[1].data) ? results[1].data : [];
initMsFormQaSearch(); // _msAllMembers 세팅 직후, milestones 길이 체크 이전
var milestones = (res.success && res.data) ? res.data : [];
if (milestones.length === 0) { ... return; }
```

`input.oninput` 할당 방식으로 구현하면 재호출 시 자동 덮어쓰므로 중복 등록 문제 없음.

##### (D) 신규 함수: `addMsFormQaAssignee(memberId)`

```
동작:
- _msAllMembers에서 memberId로 멤버 찾기
- #proj-ms-qa-badges에 뱃지 HTML 추가
- #proj-ms-qa-search 값 초기화, #proj-ms-qa-results 숨기기
```

뱃지 HTML 패턴 (기존 목록 행과 동일):
```html
<span class="badge bg-light text-dark border" style="font-size:0.75rem;">
  {name} <button type="button" class="btn-close" style="font-size:0.5rem;"
                 onclick="removeMsFormQaAssignee({memberId})"></button>
</span>
```

##### (E) 신규 함수: `removeMsFormQaAssignee(memberId)`

```
동작:
- #proj-ms-qa-badges 내에서 해당 memberId를 가진 뱃지 제거
```

뱃지 제거 시 `onclick` 속성에서 ID를 파싱하는 방식 대신, `data-member-id` 속성을 뱃지 span에 추가하면 더 안전하게 처리 가능.

##### (F) 신규 함수: `getMsFormQaIds()`

```
동작:
- #proj-ms-qa-badges 내 뱃지들의 data-member-id 값을 수집하여 배열로 반환
```

##### (G) `addProjectMilestone()` 함수 수정 (line 4156)

변경 전 (실제 코드 line 4156~4182):
```js
var body = { name: name, sortOrder: null };
if (type) body.type = type;
if (days) body.days = parseInt(days);
if (startDate) body.startDate = startDate;
if (endDate) body.endDate = endDate;
var res = await apiCall('/api/v1/projects/' + projectId + '/milestones', 'POST', body);
if (res.success) {
    showToast('마일스톤이 추가되었습니다.', 'success');
    document.getElementById('proj-ms-type').value = '';
    document.getElementById('proj-ms-name').value = '';
    document.getElementById('proj-ms-days').value = '';
    document.getElementById('proj-ms-start').value = '';
    document.getElementById('proj-ms-end').value = '';
    await loadProjectMilestones();
}
```

변경 후 (추가·수정 부분만 표시):
```js
var body = { name: name, sortOrder: null };
if (type) body.type = type;
if (days) body.days = parseInt(days);
if (startDate) body.startDate = startDate;
if (endDate) body.endDate = endDate;
// [추가] QA 유형이면 qaAssignees 포함
if (type === 'QA') {
    var qaIds = getMsFormQaIds();
    body.qaAssignees = qaIds.join(','); // 담당자 없으면 빈 문자열
}
var res = await apiCall('/api/v1/projects/' + projectId + '/milestones', 'POST', body);
if (res.success) {
    showToast('마일스톤이 추가되었습니다.', 'success');
    document.getElementById('proj-ms-type').value = '';
    document.getElementById('proj-ms-name').value = '';
    document.getElementById('proj-ms-days').value = '';
    document.getElementById('proj-ms-start').value = '';
    document.getElementById('proj-ms-end').value = '';
    onMsTypeChange(''); // [추가] QA 입력란 숨김 및 뱃지 초기화
    await loadProjectMilestones();
}
```

#### 3.4.3 외부 클릭 드롭다운 닫기 통합

기존 `initQaAssigneeSearch()` 내부의 `document.addEventListener('click', ...)` 핸들러 조건:

```js
if (!e.target.closest('.qa-assignee-cell')) {
    document.querySelectorAll('.qa-assignee-results').forEach(...닫기...);
}
```

§3.4.1에서 추가하는 `#proj-ms-qa-cell` div에는 `class="qa-assignee-cell"`이 이미 부여되어 있으므로, 기존 외부 클릭 핸들러가 신규 폼 드롭다운도 자동으로 처리한다. 단, `initQaAssigneeSearch()`는 `loadProjectMilestones()` 내에서 매번 호출될 때 `document.addEventListener('click', ...)`를 반복 등록한다. 이는 기존 코드의 동작이며 이번 범위에서 수정하지 않는다.

`initMsFormQaSearch()` 자체의 외부 클릭 처리는 별도로 등록할 필요가 없다. 단, `initMsFormQaSearch()` 내에서 `input.oninput`을 함수 할당 방식(`input.oninput = function() {...}`)으로 등록하면 덮어쓰기가 되어 중복 등록 문제가 없다. `initMsFormQaSearch()`가 `loadProjectMilestones()` 호출 시마다 재호출되는 경우에도 이 방식이면 안전하다. 플래그(`_msFormQaSearchInited`) 방식도 유효하나 오히려 단순한 oninput 할당 방식을 권장한다.

### 3.5 기존 시스템 연동
- `_msAllMembers` 전역 변수: `loadProjectMilestones()` 에서 채워지며, 신규 함수들이 참조
- `initQaAssigneeSearch()`: 기존 목록 행 QA 검색 초기화 함수. 수정하지 않음. `initMsFormQaSearch()`는 별도 함수로 분리
- `addProjectMilestone()`: qaAssignees body 포함 로직 추가

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | index.html — QA 담당자 래퍼 div 삽입 | `#proj-ms-qa-wrap` div를 추가 폼에 삽입 (초기 숨김) | 낮음 | - |
| T2 | index.html — `proj-ms-type` onchange 연결 | select에 `onchange="onMsTypeChange(this.value)"` 속성 추가 | 낮음 | T1 |
| T3 | app.js — `onMsTypeChange()` 구현 | QA 선택 시 래퍼 표시, 그 외 숨김 및 초기화 | 낮음 | T1 |
| T4 | app.js — `initMsFormQaSearch()` 구현 | 검색 input 이벤트 바인딩, 드롭다운 목록 렌더링 | 중간 | - |
| T5 | app.js — `addMsFormQaAssignee()` / `removeMsFormQaAssignee()` / `getMsFormQaIds()` 구현 | 뱃지 추가/제거/ID 수집 | 낮음 | T1 |
| T6 | app.js — `addProjectMilestone()` 수정 | qaAssignees body 포함 및 성공 시 초기화 | 낮음 | T3, T5 |
| T7 | app.js — `loadProjectMilestones()` 수정 | `_msAllMembers` 세팅 직후, `milestones.length === 0` early return 이전 위치에 `initMsFormQaSearch()` 호출 추가 | 낮음 | T4 |

### 4.2 구현 순서

1. **Step 1 (T1, T2):** `index.html`에 `#proj-ms-qa-wrap` div 삽입 및 `onchange` 속성 추가
2. **Step 2 (T3):** `app.js`에 `onMsTypeChange()` 구현 — QA 선택 시 입력란 표시/숨김
3. **Step 3 (T4, T5):** `app.js`에 `initMsFormQaSearch()`, `addMsFormQaAssignee()`, `removeMsFormQaAssignee()`, `getMsFormQaIds()` 구현
4. **Step 4 (T6):** `addProjectMilestone()` 수정 — qaAssignees 포함 및 초기화
5. **Step 5 (T7):** `loadProjectMilestones()` 내 `_msAllMembers` 세팅 직후, `milestones.length === 0` early return 이전 위치에 `initMsFormQaSearch()` 호출 추가
6. **Step 6:** 브라우저 동작 검증 (QA 선택 → 담당자 검색 → 추가 → 뱃지 표시 → 마일스톤 생성 → 목록에 QA 담당자 표시)

### 4.3 테스트 계획

| 시나리오 | 확인 항목 |
|---------|----------|
| 유형 선택: QA | QA 담당자 입력란이 나타남 |
| 유형 선택: 개발, 분석 등 QA 이외 | QA 담당자 입력란 숨겨짐 |
| QA 선택 후 유형 변경 | 입력란 숨겨지고, 이미 선택된 뱃지 초기화됨 |
| QA 담당자 검색 | 이름/역할로 필터링된 결과 드롭다운 표시 |
| 이미 선택된 담당자 | 드롭다운 목록에서 제외됨 |
| 결과 클릭 | 뱃지 추가, 검색란 초기화, 드롭다운 닫힘 |
| 뱃지 X 클릭 | 해당 뱃지 제거 |
| QA 유형으로 마일스톤 추가 | POST body에 qaAssignees 포함, 목록에 QA 담당자 뱃지 표시 |
| QA 담당자 없이 QA 유형 추가 | qaAssignees 빈 문자열 또는 미포함으로 정상 생성 |
| 마일스톤 추가 성공 후 | 폼 초기화, QA 담당자 입력란 숨겨짐, 뱃지 없음 |
| `_msAllMembers` 비어있을 때 검색 | "검색 결과 없음" 메시지 표시, 오류 없음 |

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 리스크 | 내용 | 완화 방안 |
|--------|------|----------|
| `_msAllMembers` 타이밍 | 마일스톤 탭을 처음 열기 전에 폼과 상호작용하면 캐시가 비어있음 | 검색 시 배열이 비어있으면 "검색 결과 없음"으로 처리; UX상 탭 진입 → 로드 후 폼 사용이 자연스러운 흐름이므로 별도 API 호출 불필요 |
| `initMsFormQaSearch()` 중복 등록 | `loadProjectMilestones()`가 마일스톤 조작마다 재호출되므로 이벤트 리스너 중복 등록 가능성 | `_msFormQaSearchInited` 플래그로 최초 1회만 등록, 또는 `input.oninput = function()` 할당 방식(덮어쓰기)으로 중복 방지 |
| 드롭다운 z-index 충돌 | 추가 폼의 드롭다운이 테이블 위에 올라와야 함 | `z-index:1050` 적용 (기존 패턴과 동일) |

### 5.2 의존성 리스크
- 없음. 백엔드 변경이 불필요하며, 기존 API와 캐시를 재사용한다.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 위치 | 내용 |
|------|------|------|
| `src/main/resources/static/index.html` | line 218~254 | 마일스톤 추가 폼 (`#proj-ms-type`, `#proj-ms-name` 등) |
| `src/main/resources/static/js/app.js` | line 3991~3994 | `_milestoneTypeLabels`, `_milestoneTypeOptions`, `_msAllMembers` 전역 변수 |
| `src/main/resources/static/js/app.js` | line 3996~4062 | `loadProjectMilestones()` — 멤버 목록 API 호출 및 `_msAllMembers` 채움, QA 담당자 인라인 셀 렌더링 (함수 종료: line 4062, `milestones.length === 0` early return: line 4010~4013) |
| `src/main/resources/static/js/app.js` | line 4091~4122 | `initQaAssigneeSearch()` — 목록 행 QA 검색 이벤트 바인딩 패턴 (신규 함수의 참고 모델) |
| `src/main/resources/static/js/app.js` | line 4124~4154 | `getCurrentQaIds()`, `addQaAssignee()`, `removeQaAssignee()` — 목록 행 QA 담당자 추가/제거 패턴 |
| `src/main/resources/static/js/app.js` | line 4156~4182 | `addProjectMilestone()` — 마일스톤 생성 함수 (수정 대상) |
| `src/main/java/com/timeline/service/ProjectService.java` | line 363~387 | `createMilestone()` — qaAssignees 포함 처리 이미 구현됨 |
| `src/main/java/com/timeline/domain/entity/ProjectMilestone.java` | line 48~49 | `qaAssignees` 컬럼 정의 (`VARCHAR(500)`) |
