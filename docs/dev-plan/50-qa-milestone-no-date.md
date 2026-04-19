# 개발 계획서: QA 마일스톤 시작일/종료일 제거

## 1. 개요

- **기능 설명**: QA 유형 마일스톤에서 시작일/종료일 입력 필드를 제거하고, 백엔드에서도 해당 날짜를 null로 강제 설정한다.
- **개발 배경 및 목적**: QA 마일스톤의 날짜는 일정 계산 엔진이 자동으로 산출하므로, 사용자가 직접 입력할 필요가 없다. 입력 필드를 노출하면 혼동을 유발하고 잘못된 데이터가 저장될 수 있다.
- **작성일**: 2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 마일스톤 추가 폼에서 QA 유형 선택 시 시작일/종료일 입력 필드를 숨긴다.
- FR-002: 마일스톤 목록(테이블)에서 QA 유형 행의 시작일/종료일 셀을 빈 텍스트(`-`)로 표시하고, date input을 렌더링하지 않는다.
- FR-003: 백엔드 `createMilestone` 로직에서 type이 QA이면 startDate, endDate를 무조건 null로 저장한다.
- FR-004: 백엔드 `updateMilestone` 로직에서 type이 QA이면 startDate, endDate를 무조건 null로 저장한다.
- FR-005: 기존에 QA 마일스톤에 날짜 값이 저장되어 있더라도 수정 시 null로 덮어쓴다.

### 2.2 비기능 요구사항

- NFR-001: DB 마이그레이션 없음 (컬럼 제거가 아닌 null 허용 유지).
- NFR-002: 기존 비 QA 마일스톤의 시작일/종료일 동작은 변경하지 않는다.

### 2.3 가정 사항

- QA 유형 마일스톤의 `days` 필드(일수)는 기존대로 편집 가능하게 유지한다.
- QA 유형의 `qaAssignees` 필드는 기존대로 유지한다.
- `MilestoneType.QA` 외 다른 유형에는 이번 변경이 적용되지 않는다.

### 2.4 제외 범위 (Out of Scope)

- 간트차트 마일스톤 표시 로직 변경 없음.
- 프로젝트 목록 토글에서 마일스톤 행 표시(`toggleProjectMilestones`) 변경 없음.
- DB 컬럼 삭제 또는 엔티티 구조 변경 없음.

---

## 3. 시스템 설계

### 3.1 데이터 모델

변경 없음. `ProjectMilestone.startDate`, `ProjectMilestone.endDate`는 기존대로 nullable로 유지한다.

### 3.2 API 설계

기존 엔드포인트를 그대로 사용하며, 내부 로직만 변경한다.

| Method | Endpoint | 변경 내용 |
|--------|----------|----------|
| POST | `/api/v1/projects/{id}/milestones` | type == QA이면 startDate, endDate를 null로 강제 |
| PUT  | `/api/v1/projects/{id}/milestones/{milestoneId}` | type == QA(현재 또는 변경 후)이면 startDate, endDate를 null로 강제 |

### 3.3 서비스 계층

**파일**: `src/main/java/com/timeline/service/ProjectService.java`

#### createMilestone() 변경

```
// 기존: body에 startDate, endDate가 있으면 그대로 저장
// 변경: type이 QA이면 startDate, endDate 파싱 블록 자체를 건너뜀
```

`body.get("type")`을 먼저 확인하여 `MilestoneType.QA`이면 아래 두 블록을 실행하지 않는다.

```java
// 변경 전 (line 375~380)
if (body.get("startDate") != null && !((String) body.get("startDate")).isBlank()) {
    builder.startDate(LocalDate.parse((String) body.get("startDate")));
}
if (body.get("endDate") != null && !((String) body.get("endDate")).isBlank()) {
    builder.endDate(LocalDate.parse((String) body.get("endDate")));
}

// 변경 후
boolean isQa = "QA".equals(body.get("type"));
if (!isQa) {
    if (body.get("startDate") != null && !((String) body.get("startDate")).isBlank()) {
        builder.startDate(LocalDate.parse((String) body.get("startDate")));
    }
    if (body.get("endDate") != null && !((String) body.get("endDate")).isBlank()) {
        builder.endDate(LocalDate.parse((String) body.get("endDate")));
    }
}
```

#### updateMilestone() 변경

type 결정 후(기존 type + body의 type 변경 적용 이후) QA 여부를 판단하여 startDate, endDate를 null로 강제한다.

```
// 변경 전 (line 401~408)
if (body.containsKey("startDate")) {
    String sd = (String) body.get("startDate");
    milestone.setStartDate(sd != null && !sd.isBlank() ? LocalDate.parse(sd) : null);
}
if (body.containsKey("endDate")) {
    String ed = (String) body.get("endDate");
    milestone.setEndDate(ed != null && !ed.isBlank() ? LocalDate.parse(ed) : null);
}

// 변경 후
boolean isQa = milestone.getType() == com.timeline.domain.enums.MilestoneType.QA;
if (isQa) {
    milestone.setStartDate(null);
    milestone.setEndDate(null);
} else {
    if (body.containsKey("startDate")) {
        String sd = (String) body.get("startDate");
        milestone.setStartDate(sd != null && !sd.isBlank() ? LocalDate.parse(sd) : null);
    }
    if (body.containsKey("endDate")) {
        String ed = (String) body.get("endDate");
        milestone.setEndDate(ed != null && !ed.isBlank() ? LocalDate.parse(ed) : null);
    }
}
```

주의 1: `body.containsKey("type")`으로 type이 변경되는 경우, type 설정 코드(line 394~397)가 먼저 실행된 뒤 `milestone.getType()`으로 판단해야 한다. 기존 코드 순서(`type → days → startDate → endDate`)가 이미 그 순서이므로 별도 재정렬 불필요.

주의 2: `saveMilestoneOrder()`가 `{ sortOrder: N }` 만 담아 PUT을 호출하는 경우에도, QA 마일스톤이면 `isQa = true`가 되어 `setStartDate(null)`, `setEndDate(null)`이 실행된다. 이는 "QA 마일스톤의 날짜는 항상 null" 정책(FR-005)과 일치하는 의도된 동작이다. QA 마일스톤에 날짜가 잔존해 있다면 순서 변경 시에도 자연스럽게 정리된다.

### 3.4 프론트엔드

#### (A) 마일스톤 추가 폼 — `onMsTypeChange()` 확장

**파일**: `src/main/resources/static/js/app.js` (line 4229)

QA 선택 시 시작일/종료일 `col-auto` wrapper를 숨기고, 다른 유형 선택 시 다시 보인다.

```
// 변경 전: QA 선택 시 proj-ms-qa-wrap만 표시/숨김. 날짜 wrapper show/hide 없음
// 변경 후: proj-ms-qa-wrap + 시작일/종료일 wrapper도 show/hide

function onMsTypeChange(typeValue) {
    var wrap = document.getElementById('proj-ms-qa-wrap');
    var startWrap = document.getElementById('proj-ms-start-wrap');  // 신규 id
    var endWrap = document.getElementById('proj-ms-end-wrap');      // 신규 id
    if (!wrap) return;
    if (typeValue === 'QA') {
        wrap.style.display = '';
        if (startWrap) startWrap.style.display = 'none';
        if (endWrap) endWrap.style.display = 'none';
        // 날짜 값도 초기화
        var s = document.getElementById('proj-ms-start');
        var e = document.getElementById('proj-ms-end');
        if (s) s.value = '';
        if (e) e.value = '';
    } else {
        wrap.style.display = 'none';
        if (startWrap) startWrap.style.display = '';
        if (endWrap) endWrap.style.display = '';
        // 기존 초기화 로직 유지
        var badges = document.getElementById('proj-ms-qa-badges');
        if (badges) badges.innerHTML = '';
        var search = document.getElementById('proj-ms-qa-search');
        if (search) search.value = '';
        var results = document.getElementById('proj-ms-qa-results');
        if (results) { results.innerHTML = ''; results.style.display = 'none'; }
    }
}
```

#### (B) 마일스톤 추가 폼 — `index.html` wrapper id 추가

**파일**: `src/main/resources/static/index.html` (line 241~248)

시작일/종료일 `col-auto` div에 id를 부여하여 JS에서 참조 가능하게 한다.

```html
<!-- 변경 전 -->
<div class="col-auto">
    <label class="form-label mb-0" style="font-size:0.8rem;">시작일</label>
    <input type="date" class="form-control form-control-sm" id="proj-ms-start">
</div>
<div class="col-auto">
    <label class="form-label mb-0" style="font-size:0.8rem;">종료일</label>
    <input type="date" class="form-control form-control-sm" id="proj-ms-end">
</div>

<!-- 변경 후 -->
<div class="col-auto" id="proj-ms-start-wrap">
    <label class="form-label mb-0" style="font-size:0.8rem;">시작일</label>
    <input type="date" class="form-control form-control-sm" id="proj-ms-start">
</div>
<div class="col-auto" id="proj-ms-end-wrap">
    <label class="form-label mb-0" style="font-size:0.8rem;">종료일</label>
    <input type="date" class="form-control form-control-sm" id="proj-ms-end">
</div>
```

#### (C) 마일스톤 목록 테이블 — `loadProjectMilestones()` 내 QA 행 처리

**파일**: `src/main/resources/static/js/app.js` (line 4032~4034)

QA 유형 행에서 시작일/종료일 셀을 date input 대신 `-` 텍스트로 렌더링한다.

```javascript
// 변경 전 (line 4032~4034): 모든 행에 동일하게 date input 렌더링
html += '<td><div class="d-flex align-items-center gap-1"><input type="date" ... id="startDate">...</div></td>';
html += '<td><div class="d-flex align-items-center gap-1"><input type="date" ... id="endDate">...</div></td>';

// 변경 후: QA 유형이면 빈 셀, 아니면 기존 input
if (ms.type === 'QA') {
    html += '<td class="text-muted" style="font-size:0.8rem;">-</td>';
    html += '<td class="text-muted" style="font-size:0.8rem;">-</td>';
} else {
    html += '<td><div class="d-flex align-items-center gap-1"><input type="date" class="form-control form-control-sm" value="' + (ms.startDate || '') + '" onchange="updateProjectMilestone(' + ms.id + ', \'startDate\', this.value)" style="width:140px;"><small class="text-muted text-nowrap">' + formatDayOnly(ms.startDate) + '</small></div></td>';
    html += '<td><div class="d-flex align-items-center gap-1"><input type="date" class="form-control form-control-sm" value="' + (ms.endDate || '') + '" onchange="updateProjectMilestone(' + ms.id + ', \'endDate\', this.value)" style="width:140px;"><small class="text-muted text-nowrap">' + formatDayOnly(ms.endDate) + '</small></div></td>';
}
```

#### (D) 마일스톤 추가 함수 — `addProjectMilestone()` QA 시 날짜 body 제외

**파일**: `src/main/resources/static/js/app.js` (line 4246)

현재 `addProjectMilestone()`은 `if (startDate) body.startDate = startDate;`와 `if (endDate) body.endDate = endDate;`를 조건 없이 body에 포함한다. (A)의 `onMsTypeChange()`에서 날짜 input 값을 초기화하므로 QA 선택 후 즉시 추가 시에는 빈 값이 전달되나, 날짜 입력 후 유형을 QA로 바꾼 경우 초기화가 적용되어 문제없다. 그러나 명시적 방어 코드를 추가하여 QA이면 body에 날짜를 포함하지 않도록 한다.

```javascript
// 변경 전 (line 4258~4259)
if (startDate) body.startDate = startDate;
if (endDate) body.endDate = endDate;

// 변경 후
if (type !== 'QA') {
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
}
```

주의: `onMsTypeChange()`의 날짜 초기화와 이 방어 코드가 모두 동작하여 이중 안전망이 된다. 백엔드 FR-003에서도 QA이면 null 강제하므로 세 겹의 방어가 적용된다.

### 3.5 기존 시스템 연동

- `milestoneToMap()` (ProjectService line 424): `startDate`, `endDate`를 그대로 직렬화하는데, QA의 경우 null이 반환되므로 프론트에서 `ms.startDate === null`로 자연스럽게 처리됨. 별도 변경 불필요.
- `calcWorkingDays()` JS 함수: `msCalcDays` 계산(line 4025)은 QA/비QA 분기 이전에 실행되므로 코드상 생략 불필요. QA 마일스톤은 `ms.startDate`와 `ms.endDate`가 null이므로 `msCalcDays`도 null이 되고, (C) 변경에서 QA 분기가 먼저 return하므로 일수 렌더링에 실질적인 영향이 없다.

---

## 4. 구현 계획

### 4.1 작업 분해

| # | 작업 | 파일 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-1 | index.html: 시작일/종료일 wrapper에 id 추가 | `index.html` | 낮음 | 없음 |
| T-2 | app.js: `onMsTypeChange()` 확장 — QA 선택 시 날짜 wrapper 숨김 및 값 초기화 | `app.js` | 낮음 | T-1 |
| T-3 | app.js: `loadProjectMilestones()` — QA 행 날짜 셀 `-` 렌더링 | `app.js` | 낮음 | 없음 |
| T-4 | ProjectService: `createMilestone()` — QA이면 날짜 null 강제 | `ProjectService.java` | 낮음 | 없음 |
| T-5 | ProjectService: `updateMilestone()` — QA이면 날짜 null 강제 | `ProjectService.java` | 낮음 | 없음 |
| T-6 | app.js: `addProjectMilestone()` — QA이면 body에 날짜 미포함 | `app.js` | 낮음 | 없음 |

### 4.2 구현 순서

1. **T-1** `index.html` wrapper id 추가 (HTML 변경)
2. **T-4, T-5** `ProjectService.java` 백엔드 로직 수정 (서로 독립적이므로 동시 가능)
3. **T-2, T-6** `onMsTypeChange()` 확장 및 `addProjectMilestone()` 방어 코드 추가 (T-1 완료 후)
4. **T-3** `loadProjectMilestones()` QA 분기 추가
5. app.js `?v=` 쿼리 파라미터 갱신 (`index.html` 내 `app.js?v=...`)

### 4.3 테스트 계획

**수동 테스트 시나리오**

1. 마일스톤 추가 폼에서 유형을 QA로 선택하면 시작일/종료일 필드가 사라지는지 확인
2. 유형을 다른 값으로 바꾸면 시작일/종료일 필드가 다시 나타나는지 확인
3. QA 마일스톤 추가 후 목록에서 시작일/종료일 셀이 `-`로 표시되는지 확인
4. 비 QA 마일스톤의 시작일/종료일은 기존대로 date input으로 표시되는지 확인
5. API를 직접 호출하여 QA 마일스톤 POST/PUT 시 응답의 `startDate`, `endDate`가 null인지 확인
6. 기존 QA 마일스톤에 날짜가 저장된 경우, PUT 호출 시 null로 교체되는지 확인

---

## 5. 리스크 및 고려사항

| 리스크 | 내용 | 대응 |
|--------|------|------|
| 기존 QA 마일스톤에 날짜 데이터 잔존 | DB에 이미 날짜가 저장된 QA 마일스톤이 있을 수 있음 | updateMilestone에서 QA이면 항상 null로 덮어씀으로써 다음 수정 시 자연스럽게 정리됨. 일괄 정리가 필요하면 별도 DB 쿼리(`UPDATE project_milestone SET start_date=NULL, end_date=NULL WHERE type='QA'`) 실행 |
| 간트차트 마일스톤 렌더링 | frappe-gantt에 마일스톤을 그릴 때 날짜를 사용할 수 있음 | 간트차트는 TaskService 기반으로 날짜를 계산하며, QA 마일스톤은 이미 일정 계산 엔진이 별도로 처리하므로 영향 없음 |
| type 변경 시 날짜 처리 순서 | PUT 요청에서 type과 startDate가 동시에 올 수 있음 | updateMilestone 내에서 type 적용 코드가 날짜 처리 코드보다 먼저 실행되는 현재 순서를 유지하면 문제 없음 |

---

## 6. 참고 사항

### 관련 파일 경로

| 파일 | 경로 | 관련 위치 |
|------|------|----------|
| 마일스톤 엔티티 | `src/main/java/com/timeline/domain/entity/ProjectMilestone.java` | startDate, endDate 필드 |
| MilestoneType enum | `src/main/java/com/timeline/domain/enums/MilestoneType.java` | `QA` 값 |
| 서비스 | `src/main/java/com/timeline/service/ProjectService.java` | `createMilestone()` line 363, `updateMilestone()` line 390 |
| 컨트롤러 | `src/main/java/com/timeline/controller/ProjectController.java` | line 161~181 |
| HTML 추가 폼 | `src/main/resources/static/index.html` | line 218~270 |
| JS 로직 | `src/main/resources/static/js/app.js` | `loadProjectMilestones()` line 3996, `onMsTypeChange()` line 4229, `addProjectMilestone()` line 4246 |
