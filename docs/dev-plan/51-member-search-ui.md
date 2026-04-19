# 개발 계획서: 멤버 선택 검색 UI 개선

## 1. 개요

- **기능 설명**: 멤버를 선택하는 5개 UI 요소에 검색 기능을 추가하여 사용 편의성을 개선한다.
- **개발 배경 및 목적**: 멤버 수가 많아질수록 일반 `<select>` 드롭다운으로는 원하는 멤버를 빠르게 찾기 어렵다. 검색형 UI로 전환하여 이름 일부만 입력해도 즉시 필터링되도록 한다.
- **작성일**: 2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: PPL 선택(`#project-ppl`)을 검색 가능한 커스텀 드롭다운으로 교체한다. 전체 멤버를 대상으로 단일 선택한다.
- FR-002: EPL 선택(`#project-epl`)을 검색 가능한 커스텀 드롭다운으로 교체한다. 전체 멤버를 대상으로 단일 선택한다.
- FR-003: 태스크 모달 담당자 선택(`#task-assignee`)을 검색 가능한 커스텀 드롭다운으로 교체한다. 해당 프로젝트 멤버만 대상으로 단일 선택한다.
- FR-004: 프로젝트 멤버 대량 추가 모달(`#add-project-member-list`)의 체크박스 리스트 위에 검색 input을 추가하여 이름으로 필터링한다. 체크박스 다중 선택 방식은 유지한다.
- FR-005: 멤버 비가용일 탭의 멤버 선택(`#leave-member-select`)을 검색 가능한 커스텀 드롭다운으로 교체한다. 전체 멤버를 대상으로 단일 선택한다.
- FR-006: 검색형 커스텀 드롭다운은 "선택 안함" 초기화 기능을 제공한다 (X 버튼 또는 input 클리어).
- FR-007: 드롭다운 외부 클릭 시 결과 목록이 닫힌다.
- FR-008: 검색 결과가 없으면 "결과 없음" 메시지를 표시한다.

### 2.2 비기능 요구사항

- NFR-001: 기존 데이터 저장 로직(`saveProject()`, `saveTask()`, `loadMemberLeaves()`)을 최소한으로 수정한다. 숨겨진 `<input type="hidden">`에 ID를 저장하는 방식으로 기존 `.value` 읽기 코드를 유지한다.
- NFR-002: 새 JavaScript 파일이나 외부 라이브러리를 추가하지 않는다. 기존 `app.js`와 `index.html`만 수정한다.
- NFR-003: Bootstrap 5.3과 기존 CSS 스타일과 일관성을 유지한다.

### 2.3 가정 사항

- 커스텀 드롭다운은 공통 헬퍼 함수(`initMemberSearchDropdown()`)로 구현하여 5곳에서 재사용한다.
- 표시 텍스트 input에는 검색어를 입력하고, 선택 완료 시 멤버 이름으로 고정 표시된다.
- 프로젝트 모달에서 PPL/EPL은 기존처럼 `allMembers` 배열을 로드 후 드롭다운을 초기화한다.
- 태스크 모달의 담당자는 프로젝트 선택 후 `currentProjectMembers` 배열을 기반으로 드롭다운을 재초기화한다.

### 2.4 제외 범위 (Out of Scope)

- 백엔드 API 변경 없음 (순수 프론트엔드 작업)
- 스쿼드 선택, 프로젝트 선택 드롭다운은 이번 범위 제외
- 기존에 이미 검색 기능이 있는 곳(`#proj-member-search`, `#proj-ms-qa-search`, `#squad-member-search`)은 변경 없음

---

## 3. 시스템 설계

### 3.1 커스텀 드롭다운 구조 (단일 선택, FR-001~003, FR-005)

기존 `<select id="XXX">` 를 아래 HTML 구조로 교체한다.

```html
<!-- 기존 -->
<select class="form-select" id="project-ppl">
  <option value="">선택 안함</option>
</select>

<!-- 변경 후 -->
<div class="member-search-dropdown position-relative" id="project-ppl-wrap">
  <input type="hidden" id="project-ppl" value="">
  <div class="input-group input-group-sm">
    <input type="text"
           class="form-control"
           id="project-ppl-search"
           placeholder="이름으로 검색..."
           autocomplete="off">
    <button type="button"
            class="btn btn-outline-secondary"
            id="project-ppl-clear"
            style="display:none;"
            onclick="clearMemberDropdown('project-ppl')">
      <i class="bi bi-x"></i>
    </button>
  </div>
  <div id="project-ppl-results"
       class="position-absolute w-100"
       style="display:none; z-index:1060; background:#fff; border:1px solid #dee2e6;
              border-radius:4px; box-shadow:0 4px 8px rgba(0,0,0,0.1);
              max-height:200px; overflow-y:auto; top:100%; left:0;">
  </div>
</div>
```

ID 명명 규칙:
- 숨겨진 필드: `{원본id}` (기존 코드 `.value` 읽기 변경 불필요)
- 표시 input: `{원본id}-search`
- 결과 목록: `{원본id}-results`
- 클리어 버튼: `{원본id}-clear`
- 래퍼: `{원본id}-wrap`

### 3.2 공통 헬퍼 함수 설계 (app.js 신규 추가)

```javascript
/**
 * 단일 선택 멤버 검색 드롭다운 초기화
 * @param {string} baseId     - 숨겨진 input의 id (예: 'project-ppl')
 * @param {Array}  members    - { id, name, role, team? } 배열
 * @param {string} placeholder
 */
function initMemberSearchDropdown(baseId, members, placeholder) { ... }

/**
 * 단일 선택 멤버 검색 드롭다운 값 설정 (수정 모드에서 기존 값 복원)
 * @param {string} baseId
 * @param {number|string|null} memberId  - 선택할 멤버 ID (null이면 초기화)
 * @param {Array}  members
 */
function setMemberDropdownValue(baseId, memberId, members) { ... }

/**
 * 단일 선택 멤버 검색 드롭다운 초기화 (X 버튼 클릭)
 * @param {string} baseId
 */
function clearMemberDropdown(baseId) { ... }
```

`initMemberSearchDropdown()` 내부 동작:
1. `#{baseId}-search` input의 `oninput` 이벤트: 키워드로 `members` 배열 필터링 (이름 + role 포함)
2. 필터 결과를 `#{baseId}-results` 목록으로 렌더링
3. 항목 클릭 시:
   - `#{baseId}` (hidden) `.value = m.id`
   - `#{baseId}-search` `.value = m.name + ' (' + m.role + ')'`
   - `#{baseId}-results` 숨김
   - `#{baseId}-clear` 버튼 표시
4. `onfocus` 이벤트: 검색어가 있으면 목록 재표시
5. `onblur` / 외부 클릭: 목록 닫기 (단, 항목 클릭과의 race condition 주의 — `mousedown` 방지 or `setTimeout` 처리)

`setMemberDropdownValue(baseId, memberId, members)`:
- `members.find(m => m.id == memberId)` 로 멤버 찾기
- 찾으면 hidden value 설정, search input에 이름 표시, clear 버튼 표시
- 없으면 `clearMemberDropdown(baseId)` 호출

`clearMemberDropdown(baseId)`:
- hidden `.value = ''`
- search input `.value = ''`
- results 숨김
- clear 버튼 숨김

### 3.3 4번 — 프로젝트 멤버 대량 추가 모달 (체크박스 필터, FR-004)

기존 체크박스 리스트 구조는 유지하고, 모달 body 상단에 검색 input만 추가한다.

```html
<!-- addProjectMemberModal modal-body 변경 -->
<div class="modal-body">
  <input type="hidden" id="add-project-member-project-id">
  <!-- 신규: 검색 input -->
  <div class="mb-2">
    <input type="text"
           class="form-control form-control-sm"
           id="add-project-member-search"
           placeholder="이름으로 필터링..."
           autocomplete="off"
           oninput="filterAddProjectMemberList()">
  </div>
  <div id="add-project-member-list" style="max-height:400px; overflow-y:auto;"></div>
</div>
```

신규 함수 `filterAddProjectMemberList()`:
- `#add-project-member-search` 입력값을 소문자로 변환하여, `#add-project-member-list` 내 각 `.form-check` 항목의 `<label>` 텍스트(`textContent`)와 비교
- 키워드가 label 텍스트에 포함되면 해당 `.form-check`의 `style.display = ''`, 포함되지 않으면 `'none'`
- 검색어가 빈 문자열이면 모든 `.form-check` 항목을 표시(`style.display = ''`)

모달이 열릴 때(`showAddProjectMemberModal()`) 검색 input 초기화: `.value = ''` 후 `filterAddProjectMemberList()` 호출.

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | HTML 교체 — PPL/EPL | `index.html` 1141~1151줄 `<select>` → 커스텀 드롭다운 래퍼로 교체 | 낮음 | 없음 |
| T2 | HTML 교체 — 태스크 담당자 | `index.html` 1200~1204줄 `<select>` → 커스텀 드롭다운 래퍼로 교체 | 낮음 | 없음 |
| T3 | HTML 교체 — 비가용일 멤버 | `index.html` 522~525줄 `<select>` → 커스텀 드롭다운 래퍼로 교체 | 낮음 | 없음 |
| T4 | HTML 추가 — 대량 추가 검색 input | `index.html` 1001~1003줄 modal-body에 검색 input 추가 | 낮음 | 없음 |
| T5 | JS 공통 헬퍼 함수 구현 | `app.js`에 `initMemberSearchDropdown()`, `setMemberDropdownValue()`, `clearMemberDropdown()` 추가 | 중간 | 없음 |
| T6 | JS — PPL/EPL 연동 | `showProjectModal()` 내 `project-ppl`/`project-epl` 채우는 로직 교체 (app.js 2628~2658) | 낮음 | T1, T5 |
| T7 | JS — 태스크 담당자 연동 | `loadTaskModalProjectData()` 내 담당자 select 채우는 로직 교체 (app.js 4806~4839) | 중간 | T2, T5 |
| T8 | JS — 비가용일 멤버 연동 | `loadSettingsSection()` 내 `leave-member-select` 채우는 로직 교체 (app.js 6528~6538) | 낮음 | T3, T5 |
| T9 | JS — 대량 추가 필터 함수 | `filterAddProjectMemberList()` 구현, `showAddProjectMemberModal()` 초기화 추가 | 낮음 | T4 |
| T10 | JS — 저장 로직 검증 | `saveProject()`, `saveTask()`, `loadMemberLeaves()` 에서 hidden input 값을 그대로 읽는지 확인 및 필요 시 수정 | 낮음 | T5~T9 |
| T11 | JS — 외부 클릭 닫기 처리 | `document` 레벨에서 단일 클릭 핸들러로 모든 커스텀 드롭다운 결과 닫기 | 낮음 | T5 |

### 4.2 구현 순서

1. **Step 1 — 공통 헬퍼 함수 작성** (T5, T11): `app.js` 적절한 위치(기존 `filterProjMemberSearch` 함수 근처)에 `initMemberSearchDropdown`, `setMemberDropdownValue`, `clearMemberDropdown` 함수를 추가한다. 외부 클릭 핸들러도 함께 등록한다.

2. **Step 2 — HTML 교체** (T1, T2, T3, T4): `index.html`에서 `<select>` 4곳을 커스텀 드롭다운 래퍼로 교체하고, 대량 추가 모달에 검색 input을 추가한다.

3. **Step 3 — PPL/EPL 연동** (T6): `showProjectModal()` 함수에서 `document.getElementById('project-ppl').innerHTML = memberOptHtml` 방식을 `initMemberSearchDropdown('project-ppl', allMembers, '이름으로 검색...')` 로 교체한다. 기존 값 복원(`p.pplId`)은 `setMemberDropdownValue('project-ppl', p.pplId, allMembers)` 로 처리한다.

4. **Step 4 — 태스크 담당자 연동** (T7): `loadTaskModalProjectData()` 함수에서 담당자 select 채우는 부분을 `initMemberSearchDropdown('task-assignee', currentProjectMembers, '이름으로 검색...')` 로 교체한다. 기존 값 복원(`prevAssignee`, `t.assignee.id`)은 `setMemberDropdownValue` 로 처리한다.

   주의: `task-assignee` 값 변경 시 `checkAssigneeConflict()` 등을 트리거하는 코드(app.js 4733, 5827, 5960)가 `document.getElementById('task-assignee').value` 를 직접 읽으므로 hidden input에 값이 올바르게 들어가 있어야 한다.

5. **Step 5 — 비가용일 멤버 연동** (T8): `loadSettingsSection()` 함수에서 `leave-member-select` 채우는 부분을 `initMemberSearchDropdown('leave-member-select', members, '이름으로 검색...')` 로 교체한다. 드롭다운에서 멤버 선택 시 `loadMemberLeaves()` 를 자동 호출해야 하므로, `initMemberSearchDropdown` 의 선택 콜백 파라미터를 통해 처리한다.

   비가용일 탭은 멤버 선택 자체가 `onchange="loadMemberLeaves()"` 역할을 하므로, 선택 콜백에서 `loadMemberLeaves()` 를 직접 호출한다.

6. **Step 6 — 대량 추가 필터** (T9): `filterAddProjectMemberList()` 함수를 추가하고, `showAddProjectMemberModal()` 에서 검색 input 초기화 코드를 추가한다.

7. **Step 7 — 저장 로직 검증** (T10): `saveProject()`(2732~2733줄), `saveTask()`(4876줄), `loadMemberLeaves()`(7658줄) 에서 `document.getElementById('...').value` 로 값을 읽는 코드가 hidden input을 참조하므로 동작이 그대로 유지되는지 확인한다. ID가 바뀐 경우에만 수정한다. (`project-ppl`, `project-epl`, `task-assignee`, `leave-member-select` 모두 ID가 유지되므로 저장 로직 변경은 불필요하다.)

### 4.3 상세 변경 지점

#### index.html 변경

| 위치 | 현재 | 변경 |
|------|------|------|
| 1141~1145줄 | `<select id="project-ppl">` | 커스텀 드롭다운 래퍼 (`id="project-ppl-wrap"`) |
| 1147~1151줄 | `<select id="project-epl">` | 커스텀 드롭다운 래퍼 (`id="project-epl-wrap"`) |
| 1200~1204줄 | `<select id="task-assignee">` | 커스텀 드롭다운 래퍼 (`id="task-assignee-wrap"`) |
| 1001~1003줄 | `<div id="add-project-member-list">` | 검색 input 추가 후 리스트 (`max-height` 현행 400px 유지, 검색 input 추가 후 충분하므로 변경 불필요) |
| 522~525줄 | `<select id="leave-member-select">` | 커스텀 드롭다운 래퍼 (`id="leave-member-select-wrap"`) |

#### app.js 변경

| 위치 | 현재 | 변경 |
|------|------|------|
| 2628~2635줄 | PPL/EPL `innerHTML = memberOptHtml` | `initMemberSearchDropdown` 호출 |
| 2657~2658줄 | `project-ppl.value = p.pplId` | `setMemberDropdownValue` 호출 |
| 2614~2615줄 | `project-ppl.value = ''` (초기화) | `clearMemberDropdown` 호출 |
| 4806~4839줄 | 담당자 `assigneeSelect.innerHTML` | `initMemberSearchDropdown` 호출 |
| 4616줄 | `task-assignee.value = ''` (초기화) | `clearMemberDropdown` 호출 |
| 4684줄 | `task-assignee.value = t.assignee.id` | `setMemberDropdownValue` 호출 |
| 6528~6538줄 | `leave-member-select innerHTML` | `initMemberSearchDropdown` 호출 |
| 신규 | — | `filterAddProjectMemberList()` 함수 추가 |
| 2559~2582줄 | `showAddProjectMemberModal()` | 검색 input 초기화 코드 추가 |

### 4.4 함수 시그니처 상세

```javascript
/**
 * 단일 선택 멤버 검색 드롭다운 초기화
 * @param {string}    baseId       숨겨진 input id (기존 select id와 동일)
 * @param {Array}     members      [{id, name, role, team?}]
 * @param {string}    [placeholder='이름으로 검색...']
 * @param {Function}  [onSelect]   선택 완료 콜백 (memberId, memberObj) => void
 */
function initMemberSearchDropdown(baseId, members, placeholder, onSelect) { ... }
```

- `onSelect` 콜백을 통해 비가용일 탭에서 `loadMemberLeaves()` 를 자동 호출할 수 있다.
- 태스크 모달의 `task-assignee` 선택 시 hidden input에 값이 설정된 직후 `dispatchEvent(new Event('change'))` 를 수동 dispatch 하여 `initAssigneeConflictCheck()` 가 등록한 기존 `change` 핸들러(`checkAssigneeConflict`, `updateTaskDateFieldsVisibility`, `triggerDatePreview`, flatpickr 재초기화)를 그대로 재활용한다.

### 4.5 테스트 계획

| 시나리오 | 검증 항목 |
|---------|---------|
| 프로젝트 생성 모달 열기 | PPL/EPL 드롭다운이 검색 input으로 표시됨 |
| PPL 검색 후 선택 | 이름이 input에 표시되고 hidden에 ID 저장됨 |
| 프로젝트 수정 모달 열기 | 기존 PPL/EPL 이름이 input에 복원됨 |
| 저장 | `saveProject()` 호출 시 `pplId`, `eplId` 정상 전송 |
| X 버튼 클릭 | 선택 초기화, hidden value = '' |
| 태스크 모달 — 프로젝트 선택 후 | 담당자 드롭다운에 프로젝트 멤버만 표시 |
| 태스크 수정 모달 열기 | 기존 담당자 이름 복원됨 |
| 담당자 선택 후 저장 | `saveTask()` 에 `assigneeId` 정상 전송 |
| 비가용일 탭 멤버 선택 | `loadMemberLeaves()` 자동 호출됨 |
| 대량 추가 모달 검색 input 입력 | 체크박스 목록 실시간 필터링 |
| 대량 추가 모달 검색 비움 | 전체 목록 표시 |
| 외부 클릭 | 열린 드롭다운 결과 목록 닫힘 |
| 검색 결과 없음 | "결과 없음" 메시지 표시 |

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

- **태스크 담당자 관련 연쇄 동작**: `task-assignee` 값이 바뀔 때 `checkAssigneeConflict()`, `loadMemberLeaveDatesCache()`, `fetchDatePreview()` 등이 `.value` 를 직접 읽는다 (app.js 5827, 6017, 6024줄). hidden input에 값이 설정된 직후 이 함수들이 호출되도록 `onSelect` 콜백을 정확히 연결해야 한다.
  - **완화**: 기존에 `task-assignee` onChange 이벤트로 동작하던 로직을 `onSelect` 콜백으로 이전하거나, 선택 직후 DOM 이벤트(`change`)를 수동 dispatch 한다.

- **`checkAssigneeConflict` 내 담당자 이름 읽기 방식**: `checkAssigneeConflict()`(app.js 5875줄)에서 충돌 경고 메시지 생성 시 `assigneeSelect.options[assigneeSelect.selectedIndex].text` 방식으로 담당자 이름을 읽는다. `task-assignee`가 hidden input으로 교체되면 `.options` 속성이 없어 런타임 오류가 발생한다.
  - **완화**: `onSelect` 콜백에서 `memberObj.name` 을 전역 변수(`currentTaskAssigneeName`)에 저장해두고, `checkAssigneeConflict()` 내에서 해당 변수를 참조하도록 수정한다. 또는 `initMemberSearchDropdown` 선택 시 `#{baseId}-search` input의 표시값에서 이름을 파싱한다.

- **모달 재사용 시 드롭다운 재초기화**: 태스크 모달은 프로젝트 선택(`task-modal-project-id`)이 바뀔 때마다 `loadTaskModalProjectData()` 를 재호출하며 담당자 목록을 새로 채운다. `initMemberSearchDropdown` 가 여러 번 호출될 경우 이벤트 핸들러 중복 등록이 발생하지 않도록 기존 핸들러를 제거하거나 `input.oninput = fn` (재할당) 방식으로 처리한다.

- **`showTaskModalForScheduleMember` 내 직접 value 할당**: `showTaskModalForScheduleMember()`(app.js 4783줄)에서 `assigneeSelect.value = currentScheduleMemberId` 로 담당자를 직접 선택한다. `task-assignee`가 hidden input으로 교체된 후에는 hidden input에 값을 넣는 것만으로는 부족하고, `-search` input에 멤버 이름 표시 및 clear 버튼 활성화도 함께 처리해야 한다.
  - **완화**: `showTaskModalForScheduleMember()` 내 직접 할당 코드를 `setMemberDropdownValue('task-assignee', currentScheduleMemberId, currentProjectMembers)` 호출로 교체한다.

- **비가용일 `leave-member-select` 의 onchange 제거**: 기존 HTML에서 `onchange="loadMemberLeaves()"` 가 인라인으로 선언되어 있다. 커스텀 드롭다운으로 교체하면 이 인라인 이벤트가 사라지므로 반드시 `onSelect` 콜백으로 대체해야 한다.

- **`initAssigneeConflictCheck` 와 change 이벤트 바인딩**: `initAssigneeConflictCheck()`(app.js 5900줄)는 DOMContentLoaded 시 1회만 호출되어 `task-assignee` 에 `addEventListener('change', ...)` 를 등록한다. `task-assignee`가 hidden input으로 교체되면 이 `change` 이벤트가 자동으로 발생하지 않으므로, `onSelect` 콜백에서 `dispatchEvent(new Event('change'))` 를 수동 dispatch 하는 방법이 가장 안전하다. 이 경우 `initAssigneeConflictCheck` 내 기존 코드를 수정할 필요가 없다.

### 5.2 UX 고려사항

- 드롭다운 결과 목록의 `z-index`는 모달 위에 표시되어야 하므로 `z-index: 1060` (Bootstrap 모달은 1055) 이상으로 설정한다.
- 결과 목록이 모달 하단에서 잘리는 경우 `max-height` + `overflow-y:auto` 로 처리한다.
- `onblur` 와 항목 클릭의 race condition: `mousedown` 에서 `e.preventDefault()` 를 호출하거나, `blur` 이벤트에서 `setTimeout(100ms)` 지연 처리하여 클릭 이벤트가 먼저 실행되도록 한다.

---

## 6. 참고 사항

### 6.1 관련 기존 코드 경로

| 파일 | 위치 | 설명 |
|------|------|------|
| `src/main/resources/static/index.html` | 522~525줄 | `#leave-member-select` 현재 HTML |
| `src/main/resources/static/index.html` | 993~1011줄 | `#addProjectMemberModal` 현재 HTML |
| `src/main/resources/static/index.html` | 1141~1151줄 | `#project-ppl`, `#project-epl` 현재 HTML |
| `src/main/resources/static/index.html` | 1200~1204줄 | `#task-assignee` 현재 HTML |
| `src/main/resources/static/js/app.js` | 595~627줄 | `filterProjMemberSearch()` — 기존 검색 패턴 참고 |
| `src/main/resources/static/js/app.js` | 975~999줄 | `filterSquadMemberSearch()` — 기존 검색 패턴 참고 |
| `src/main/resources/static/js/app.js` | 2546~2582줄 | `showAddProjectMemberModal()` |
| `src/main/resources/static/js/app.js` | 2614~2615줄 | PPL/EPL 초기화 |
| `src/main/resources/static/js/app.js` | 2628~2658줄 | PPL/EPL 채우기 및 기존값 복원 |
| `src/main/resources/static/js/app.js` | 2732~2745줄 | `saveProject()` PPL/EPL 값 읽기 |
| `src/main/resources/static/js/app.js` | 4616줄 | `task-assignee` 초기화 |
| `src/main/resources/static/js/app.js` | 4684줄 | `task-assignee` 기존값 복원 |
| `src/main/resources/static/js/app.js` | 4806~4839줄 | `loadTaskModalProjectData()` 담당자 채우기 |
| `src/main/resources/static/js/app.js` | 4876줄 | `saveTask()` assigneeId 읽기 |
| `src/main/resources/static/js/app.js` | 5827줄 | `checkAssigneeConflict()` assigneeId 읽기 |
| `src/main/resources/static/js/app.js` | 6017~6024줄 | `loadMemberLeaveDatesCache()` 관련 assigneeId 읽기 |
| `src/main/resources/static/js/app.js` | 6528~6538줄 | `loadSettingsSection()` 비가용일 멤버 드롭다운 채우기 |
| `src/main/resources/static/js/app.js` | 7657~7665줄 | `loadMemberLeaves()` memberId 읽기 |
