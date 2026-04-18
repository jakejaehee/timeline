# 개발 계획서: 일정 계산 결과 화면 UI 개선

## 1. 개요

- **기능 설명**: 일정 계산 결과 모달(`scheduleCalcModal`)의 표시 방식을 3가지 측면에서 개선
  1. KTLO 프로젝트를 결과 목록에서 완전히 제거
  2. 프로젝트명 옆의 '고정' 레이블(badge) 삭제
  3. 자동 계산된 개발 일자(startDate/endDate)에 '자동' 레이블 추가
- **개발 배경**: 현재 KTLO 프로젝트는 `skipped: true`로 회색 행으로 표시되어 노이즈가 됨. '고정' 레이블은 내부 구현 정보를 불필요하게 노출. 반면 어떤 날짜가 자동 계산인지 명시되지 않아 사용자가 혼동함.
- **작성일**: 2026-04-18

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 일정 계산 결과에서 KTLO 프로젝트 행을 표시하지 않는다 (현재는 회색 행으로 표시됨).
- **FR-002**: 프로젝트명 옆에 렌더링되는 `<span class="badge bg-info">고정</span>` 레이블을 제거한다.
- **FR-003**: `fixedSchedule = false`이고 `project.startDate`가 null인 경우 계산된 startDate/devEndDate 표시 영역에 `<span class="badge">자동</span>` 레이블을 추가한다.
- **FR-004**: `fixedSchedule = false`이고 `project.endDate`가 null인 경우 계산된 launchDate 표시 영역에 `<span class="badge">자동</span>` 레이블을 추가한다.
- **FR-005**: 하단 요약 블록(`전체 일정: ... | 총 공수: ...`)의 `firstStart` 계산 시 KTLO(`skipped: true`) 항목을 건너뛰어 올바른 첫 번째 프로젝트 startDate를 참조한다.

### 2.2 비기능 요구사항

- **NFR-001**: 백엔드 API 응답 구조 변경을 최소화하고 가능한 한 프론트엔드에서만 처리한다.
- **NFR-002**: 기존 행 스타일(`r.fixedSchedule ? 'background:#f8f9fa;'`) 제거 여부는 FR-002와 함께 결정한다.

### 2.3 가정 사항

- **'자동' 레이블의 기준**: 백엔드가 현재 이미 `fixedSchedule` 필드를 응답에 포함(`result.put("fixedSchedule", fixedSchedule)`)하고 있으나, startDate와 endDate 각각의 자동 여부는 별도 플래그가 없다. 따라서 아래 논리로 판단한다.
  - **startDate 자동 여부**: `fixedSchedule = false` AND `project.startDate == null` → 멤버 queueStartDate 또는 오늘로 자동 설정된 경우
  - **endDate(launchDate) 자동 여부**: `fixedSchedule = false` AND `project.endDate == null` → QA/DEV 종료일 기준으로 자동 설정된 경우
  - `fixedSchedule = true`이면 startDate/endDate 모두 고정이므로 '자동' 레이블 불필요
  - `fixedSchedule = false`이더라도 `project.startDate != null`이면 startDate는 고정, `project.endDate != null`이면 launchDate는 고정
- **'고정' 행 배경색**: `r.fixedSchedule ? 'background:#f8f9fa;'` 스타일은 '고정' 레이블과 함께 의미를 잃으므로 같이 제거한다.
- KTLO 필터링은 백엔드에서 이미 처리되어 `skipped: true` 로 응답에 포함됨. 변경은 프론트엔드의 렌더링 단계에서만 수행한다.

### 2.4 제외 범위 (Out of Scope)

- 백엔드 `ScheduleCalculationService` 코드 변경 없음 (API 응답 구조 유지)
- KTLO 프로젝트를 프로젝트 목록 체크박스에서 아예 숨기는 작업 (선택 UI는 현행 유지)
- 자동 계산 로직 자체의 변경

---

## 3. 시스템 설계

### 3.1 현재 코드 분석

#### 백엔드 응답 구조 (`ScheduleCalculationService.java`)

```
// KTLO 프로젝트 (line 64-71)
skipped: true
skipReason: "KTLO 프로젝트는 일정 계산에서 제외됩니다."

// 일반 프로젝트 (line 279, 398-441)
fixedSchedule: boolean  // (project.startDate != null && project.endDate != null)
startDate: String
devEndDate: String
launchDate: String
...
```

`fixedSchedule` 판정 로직 (`ScheduleCalculationService.java` line 279):
```java
boolean fixedSchedule = (project.getStartDate() != null && project.getEndDate() != null);
```

비고정(`fixedSchedule = false`) 분기의 startDate 결정 로직 (line 342-353):
- `project.getStartDate() != null` → 프로젝트 startDate 사용 (부분 고정)
- `project.getStartDate() == null` → 멤버 queueStartDate 또는 오늘로 자동 계산

비고정 분기의 endDate 결정 로직 (line 372-378):
- `project.getEndDate() != null` → 프로젝트 endDate 사용 (부분 고정)
- `project.getEndDate() == null` → QA/DEV 종료일 기반으로 자동 계산

#### 현재 프론트엔드 렌더링 (`app.js` line 7905-7971)

| 위치 | 현재 코드 | 변경 방향 |
|------|-----------|-----------|
| line 7912-7916 | `r.skipped` 행을 회색으로 렌더링 후 return | 행 렌더링 없이 `if (r.skipped) return;`으로 교체 |
| line 7917 | `r.fixedSchedule`로 배경색 설정 | 배경색 적용 제거 |
| line 7920 | `r.fixedSchedule`이면 '고정' badge 렌더링 | 해당 줄 삭제 |
| line 7924-7925 | devText 날짜 표시 | '자동' badge 조건부 추가 |
| line 7932 | launchDate 표시 | '자동' badge 조건부 추가 |
| line 7961-7968 | 요약 블록: `data[0].startDate`, `data.length > 0` 조건, `data.reduce()` | skipped 제외한 `validItems` 기준으로 `firstStart`, `lastLaunch`, `totalMdSum` 모두 교체 |

#### '자동' 레이블 판정 로직 (프론트엔드)

현재 응답에 `project.startDate`와 `project.endDate`가 null이었는지 여부를 별도로 전달하는 필드가 없다. 따라서 두 가지 방안을 검토한다.

**방안 A: 백엔드에 `autoStartDate`, `autoLaunchDate` 플래그 추가** (권장)
- 장점: 판정 로직이 명확하고, 프론트엔드가 복잡한 조건 추론 불필요
- 단점: 백엔드 코드 소폭 수정 필요
- 구현: `calculateSingleProject()` 결과 조립 부분에 두 줄 추가

```java
// 추가할 두 줄 (line 398 이후 결과 조립 블록)
result.put("autoStartDate", !fixedSchedule && project.getStartDate() == null);
result.put("autoLaunchDate", !fixedSchedule && project.getEndDate() == null);
```

**방안 B: 프론트엔드에서 `fixedSchedule` 필드만으로 추론**
- `fixedSchedule = true` → 둘 다 고정
- `fixedSchedule = false` → startDate/launchDate 둘 다 '자동'으로 간주 (단순화)
- 단점: `fixedSchedule = false`이지만 startDate만 null이고 endDate는 있는 부분 고정 케이스를 구분 못함

**결론: 방안 A 채택.** `fixedSchedule = false`이더라도 부분 고정 케이스가 존재하므로(`project.startDate != null`, `project.endDate != null` 각각 독립 가능) 정확한 표현을 위해 백엔드에 2개 플래그를 추가한다.

### 3.2 API 설계

기존 엔드포인트 유지. 응답 DTO에 2개 필드 추가.

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/projects/schedule-calculate` | 일정 계산 (기존 유지) |

응답 변경 사항 (일반 프로젝트 항목):

| 기존 필드 | 변경 |
|-----------|------|
| `fixedSchedule: boolean` | 유지 |
| (신규) `autoStartDate: boolean` | startDate가 자동 계산인 경우 true |
| (신규) `autoLaunchDate: boolean` | launchDate가 자동 계산인 경우 true |

### 3.3 서비스 계층

**`ScheduleCalculationService.java`** — 결과 조립 블록 line 402(`result.put("fixedSchedule", fixedSchedule)`) 바로 다음에 2줄 추가:

```java
result.put("fixedSchedule", fixedSchedule);
result.put("autoStartDate", !fixedSchedule && project.getStartDate() == null);   // 신규
result.put("autoLaunchDate", !fixedSchedule && project.getEndDate() == null);    // 신규
result.put("startDate", startDate.toString());
```

### 3.4 프론트엔드

**`app.js`** — `renderScheduleCalcResult()` 함수 (line 7905-7971) 수정:

#### FR-001: KTLO 행 렌더링 제거

```js
// 현재 (line 7912-7916): skipped 행을 회색으로 표시 후 return
if (r.skipped) {
    html += '<tr style="background:#f0f0f0;"><td><strong>' + escapeHtml(r.projectName) + '</strong> <span class="badge bg-secondary" style="font-size:0.65rem;">KTLO</span></td>';
    html += '<td colspan="6" class="text-muted" style="font-size:0.8rem;">' + escapeHtml(r.skipReason) + '</td></tr>';
    return;
}

// 변경: 행을 출력하지 않고 그냥 return
if (r.skipped) return;
```

#### FR-002: '고정' 레이블 및 배경색 제거

```js
// 제거 대상 (line 7917): 배경색 스타일
var rowStyle = r.fixedSchedule ? ' style="background:#f8f9fa;"' : '';
html += '<tr' + rowStyle + '>';

// 변경:
html += '<tr>';

// 제거 대상 (line 7920): '고정' badge
if (r.fixedSchedule) html += ' <span class="badge bg-info" style="font-size:0.65rem;">고정</span>';
// 해당 줄 전체 삭제
```

#### FR-003/FR-004: '자동' 레이블 추가

개발 날짜 셀 (line 7924-7925):
```js
// 현재
var devText = formatDateShort(r.startDate) + '-' + formatDateShort(r.devEndDate) + ' ' + (r.devDays || 0) + 'd';
html += '<td style="white-space:nowrap;">' + devText + '</td>';

// 변경: startDate가 자동이면 '자동' badge 추가 (var devText 선언을 autoLabel/devStartStr로 분리)
var autoLabel = '<span class="badge bg-secondary" style="font-size:0.6rem; margin-left:2px;">자동</span>';
var devStartStr = formatDateShort(r.startDate) + (r.autoStartDate ? autoLabel : '');
devText = devStartStr + '-' + formatDateShort(r.devEndDate) + ' ' + (r.devDays || 0) + 'd';
html += '<td style="white-space:nowrap;">' + devText + '</td>';
```

론치일 셀 (line 7932):
```js
// 현재
html += '<td><strong>' + formatDateShort(r.launchDate) + '</strong></td>';

// 변경: launchDate가 자동이면 '자동' badge 추가
var launchAutoLabel = r.autoLaunchDate
    ? ' <span class="badge bg-secondary" style="font-size:0.6rem;">자동</span>' : '';
html += '<td><strong>' + formatDateShort(r.launchDate) + '</strong>' + launchAutoLabel + '</td>';
```

#### FR-005: 요약 블록 firstStart/lastLaunch 및 totalMdSum 보정

현재 요약 블록(line 7961-7968):
```js
// 현재
if (data.length > 0) {
    var firstStart = data[0].startDate;           // KTLO skipped 항목이 첫 번째면 undefined
    var lastLaunch = data[data.length - 1].launchDate; // KTLO skipped 항목이 마지막이면 undefined
    ...
    var totalMdSum = data.reduce(function(s, r) { return s + parseFloat(r.totalMd || 0); }, 0);
    // KTLO 항목은 totalMd가 없으므로 || 0으로 자동 처리되지만, 명시적이지 않음
}
```

변경:
```js
// 변경: skipped 항목 제외 후 첫/마지막 유효 항목 참조. totalMdSum도 유효 항목만 합산.
var validItems = data.filter(function(r) { return !r.skipped; });
if (validItems.length > 0) {
    var firstStart = validItems[0].startDate;
    var lastLaunch = validItems[validItems.length - 1].launchDate;
    html += '<div class="mt-2 p-2 bg-light rounded" style="font-size:0.85rem;">';
    html += '<strong>전체 일정:</strong> ' + formatDateShort(firstStart) + ' ~ ' + formatDateShort(lastLaunch);
    var totalMdSum = validItems.reduce(function(s, r) { return s + parseFloat(r.totalMd || 0); }, 0);
    html += ' | 총 공수: ' + totalMdSum + ' MD';
    html += '</div>';
}
```

비고: `data.length > 0` 조건을 `validItems.length > 0`으로 교체하면 KTLO 전용 선택 시 요약 블록이 표시되지 않는다. `totalMdSum` reduce도 `validItems` 기준으로 변경하여 KTLO 항목의 null `totalMd`가 0으로 잘못 합산되는 것을 방지한다.

### 3.5 기존 시스템 연동

- `ScheduleCalculationController.java`: 변경 없음 (서비스 결과를 그대로 반환)
- `scheduleCalcModal` HTML: 변경 없음
- `updateScheduleCalcBtn()`, `runScheduleCalc()`: 변경 없음

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 파일 | 작업 | 복잡도 | 의존성 |
|---|------|------|--------|--------|
| T-1 | `ScheduleCalculationService.java` | 결과 조립 블록에 `autoStartDate`, `autoLaunchDate` 2개 필드 추가 | 낮음 | 없음 |
| T-2 | `app.js` | `r.skipped` 분기에서 행 렌더링 제거 (return 유지) | 낮음 | 없음 |
| T-3 | `app.js` | `rowStyle` 배경색 변수 및 `고정` badge 코드 삭제 | 낮음 | 없음 |
| T-4 | `app.js` | devText 셀에 `r.autoStartDate` 기반 '자동' badge 추가 | 낮음 | T-1 |
| T-5 | `app.js` | launchDate 셀에 `r.autoLaunchDate` 기반 '자동' badge 추가 | 낮음 | T-1 |
| T-6 | `app.js` | 요약 블록 `firstStart`/`lastLaunch` 계산을 유효 항목(`!r.skipped`)으로 한정 | 낮음 | 없음 |

### 4.2 구현 순서

1. **T-1**: `ScheduleCalculationService.java` — 결과 조립 블록에 2개 boolean 필드 추가
2. **T-2, T-3**: `app.js` — KTLO 행 제거, '고정' 레이블/배경색 제거
3. **T-4, T-5**: `app.js` — '자동' 레이블 추가 (T-1 완료 후)
4. **T-6**: `app.js` — 요약 블록 보정

### 4.3 테스트 계획

| 시나리오 | 기대 결과 |
|----------|-----------|
| KTLO 프로젝트를 포함해 일정 계산 실행 | KTLO 행이 결과 테이블에 표시되지 않음 |
| startDate, endDate 모두 있는 프로젝트 | '자동' 레이블 없음, '고정' 레이블도 없음 |
| startDate null, endDate null인 프로젝트 | startDate, launchDate 모두 '자동' badge 표시 |
| startDate 있고 endDate null인 프로젝트 | startDate에 '자동' 없음, launchDate에 '자동' badge 표시 |
| startDate null, endDate 있는 프로젝트 | startDate에 '자동' badge, launchDate에 '자동' 없음 |
| KTLO 프로젝트만 선택 후 일정 계산 | 테이블 행 없음, 요약 블록 미표시 |
| KTLO + 일반 프로젝트 혼합 | KTLO 제외, 유효 항목만 표시. 요약 블록은 유효 첫/마지막 기준 |

---

## 5. 리스크 및 고려사항

- **요약 블록 빈 상태**: KTLO 프로젝트만 선택된 경우 `validItems.length === 0`이 될 수 있다. 요약 블록 렌더링 조건을 `if (validItems.length > 0)`으로 변경하여 보호한다. 현재 코드의 `if (data.length > 0)` 조건은 KTLO만 선택해도 true가 되어 `firstStart`가 undefined인 채로 렌더링되는 버그가 있다.
- **totalMdSum 합산 범위**: `data.reduce()`를 `validItems.reduce()`로 교체하여 KTLO 항목(totalMd 없음)이 공수 합산에서 제외되도록 한다. 현재 코드의 `r.totalMd || 0`이 null을 0으로 처리하므로 실제 숫자 오류는 없지만, validItems 기준으로 통일하는 것이 의미상 일관성을 유지한다.
- **devEndDate의 '자동' 여부**: 비고정 케이스에서 devEndDate는 항상 공수 기반으로 계산된다. 그러나 요구사항이 startDate/launchDate에 집중되어 있으므로 devEndDate에는 '자동' 레이블을 추가하지 않는다.

---

## 6. 참고 사항

- 수정 대상 파일
  - `src/main/java/com/timeline/service/ScheduleCalculationService.java` — line 402(`result.put("fixedSchedule", fixedSchedule)`) 직후에 2줄 추가
  - `src/main/resources/static/js/app.js` (line 7905-7971, `renderScheduleCalcResult()` 함수)
- 관련 HTML: `src/main/resources/static/index.html` (line 1607-1622, `scheduleCalcModal`)
- `fixedSchedule` 판정 위치: `ScheduleCalculationService.java` line 279
- 기존 KTLO 처리: `ScheduleCalculationService.java` line 63-71 (백엔드에서 `skipped: true`로 마킹, `continue`로 `calculateSingleProject()` 미호출)
- 자동 멤버 배정 '자동' badge는 별개 기능 (BE 멤버 목록, line 7936-7939)으로 이번 변경과 무관
