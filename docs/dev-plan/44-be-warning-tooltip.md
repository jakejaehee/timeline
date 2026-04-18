# 개발 계획서: BE 투입 경고 메시지 툴팁 추가

## 1. 개요

- **기능 설명**: 일정 계산 결과 화면에서 "BE N명 추가 투입 필요" 경고 메시지에 마우스를 올리면, 해당 경고의 근거가 되는 totalMd 구간별 목표 인원 기준표를 툴팁으로 표시한다.
- **개발 배경 및 목적**: 사용자가 경고 메시지를 보고 "왜 추가 투입이 필요한가?"를 직관적으로 파악할 수 있도록 근거 정보를 제공한다. 현재는 경고 문자열만 노출되어 판단 기준이 불투명하다.
- **작성일**: 2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 일정 계산 결과 테이블의 경고 행에서 "BE N명 추가 투입 필요" 문구에 마우스를 올리면 툴팁이 표시된다.
- FR-002: 툴팁 내용은 totalMd 구간별 목표 인원 기준표이다.

  | totalMd | 목표 인원 |
  |---------|----------|
  | 1~5     | 1명      |
  | 6~15    | 2명      |
  | 16~30   | 3명      |
  | 31+     | 4명      |

- FR-003: 툴팁은 "BE N명 추가 투입 필요" 패턴에 해당하는 경고 문구에만 선택적으로 적용한다. 다른 경고 문구(기간 부족, QA 충돌 등)에는 적용하지 않는다.
- FR-004: 프론트엔드 단독으로 처리하며 백엔드 API 변경이 없다.

### 2.2 비기능 요구사항

- NFR-001: 프로젝트 기존 UI 패턴과 일관성을 유지한다 (Bootstrap 5.3 기반).
- NFR-002: 추가 JS 라이브러리 도입 없이 Bootstrap 내장 tooltip을 활용한다.
- NFR-003: 툴팁 내 기준표는 HTML 테이블로 구성하여 가독성을 확보한다.

### 2.3 가정 사항

- 백엔드는 `warning` 필드에 복수의 경고를 `" / "` 구분자로 이어붙인 단일 문자열로 내려준다. (현재 코드: `String.join(" / ", warnings)`)
- "BE N명 추가 투입 필요" 경고는 두 가지 케이스에서 생성된다.
  - Case A (기간 지정, 인원 capacity 부족): `"BE N명 추가 투입 필요. 현재 인원(M명) 기준 예상 론치일: YYYY-MM-DD"` (ScheduleCalculationService.java:201)
  - Case B (시작일/종료일 모두 미지정, 명시적 할당 인원 < 목표 인원): `"BE N명 추가 투입 필요 (현재 M명)"` (ScheduleCalculationService.java:266). 조건: `project.getStartDate() == null && project.getEndDate() == null`이고 totalMd > 0이며 `beMembers.size() < targetCount`인 경우에만 생성된다. startDate만 지정하고 endDate가 null인 경우에는 이 경고가 생성되지 않는다.
- 툴팁이 적용될 판별 패턴: 경고 문자열이 `"BE "` 로 시작하고 `"추가 투입 필요"` 를 포함하는 경우.
- Bootstrap tooltip은 `data-bs-toggle="tooltip"` + `data-bs-html="true"` 방식으로 HTML 콘텐츠를 지원한다.

### 2.4 제외 범위 (Out of Scope)

- 백엔드 응답 구조 변경 (warning 문자열 분리, 타입 필드 추가 등)
- 기간 부족 경고, QA 충돌 경고 등 다른 경고 유형에 대한 툴팁
- 모바일 터치 이벤트 대응 (마우스 hover 기준)

---

## 3. 시스템 설계

### 3.1 데이터 모델

변경 없음. 백엔드 API 응답 스키마는 그대로 유지한다.

### 3.2 API 설계

변경 없음. `POST /api/v1/projects/schedule-calculate` 응답의 `warning` 필드를 그대로 사용한다.

현재 응답 예시 (변경 전/후 동일):
```json
{
  "warning": "BE 1명 추가 투입 필요 (현재 2명)"
}
```

### 3.3 서비스 계층

변경 없음.

### 3.4 프론트엔드

**변경 대상 파일**: `src/main/resources/static/js/app.js`

**변경 함수**: `renderScheduleCalcResult(data)` (app.js:7905)

#### 현재 경고 렌더링 코드 (app.js:7950~7953)

```javascript
if (r.warning) {
    var warningText = escapeHtml(r.warning).replace(/(\d{4}-\d{2}-\d{2})/g, function(m) { return formatDateShort(m); });
    html += '<tr><td colspan="7" class="text-warning" style="font-size:0.8rem; background:#fff8e1;">
              <i class="bi bi-exclamation-triangle-fill"></i> ' + escapeHtml(r.projectName) + ': ' + warningText + '</td></tr>';
}
```

현재 문제점: `warningText`에 `escapeHtml`을 먼저 적용하면 날짜 regex 치환이 HTML 엔티티 이후에 의도대로 동작하지 않는다. 또한 날짜 치환 후 다시 `escapeHtml(r.projectName)`이 혼재되어 있어 코드 흐름이 일관되지 않다. (단, 현재는 기능상 문제 없음 — 날짜 형식은 안전한 문자만 포함하므로.)

#### 변경 방향

1. `warning` 문자열을 `" / "` 기준으로 split하여 개별 경고 세그먼트 배열로 분리한다.
2. 각 세그먼트를 순회하며 `isBeMemberWarning(segment)` 헬퍼 함수로 BE 투입 경고 여부를 판별한다.
3. BE 투입 경고 세그먼트에는 `<span>` 으로 감싸고 Bootstrap tooltip 속성을 부여한다.
4. 툴팁 HTML 콘텐츠는 미리 상수로 정의한 기준표 HTML 문자열을 사용한다.
5. 렌더링 후 Bootstrap tooltip 초기화(`bootstrap.Tooltip` 생성)를 실행한다.

#### 신규 헬퍼 함수: `isBeMemberWarning(text)`

```
판별 조건: text.startsWith('BE ') && text.includes('추가 투입 필요')
반환: boolean
```

#### 신규 상수: `BE_WARNING_TOOLTIP_HTML`

기준표 HTML 문자열 (Bootstrap tooltip의 `title` 속성으로 삽입):

```html
<table class="table table-sm table-bordered mb-0" style="font-size:0.75rem; min-width:140px;">
  <thead class="table-dark">
    <tr><th>총 공수(MD)</th><th>목표 인원</th></tr>
  </thead>
  <tbody>
    <tr><td>1 ~ 5</td><td>1명</td></tr>
    <tr><td>6 ~ 15</td><td>2명</td></tr>
    <tr><td>16 ~ 30</td><td>3명</td></tr>
    <tr><td>31+</td><td>4명</td></tr>
  </tbody>
</table>
```

#### 변경 후 경고 행 렌더링 흐름 (의사코드)

```
segments = r.warning.split(' / ')
renderedSegments = segments.map(seg =>
    // 날짜 변환은 BE 경고/비 BE 경고 모두 동일하게 적용
    // Case A 메시지("...예상 론치일: YYYY-MM-DD")에 날짜가 포함되므로
    // BE 경고 세그먼트에도 날짜 변환 후 텍스트를 span 내부에 사용해야 함
    var displayText = escapeHtml(seg).replace(/(\d{4}-\d{2}-\d{2})/g, function(m) { return formatDateShort(m); })
    if isBeMemberWarning(seg):
        return '<span data-bs-toggle="tooltip" data-bs-html="true"
                      data-bs-placement="top"
                      title="[기준표 HTML]">' + displayText + '</span>'
    else:
        return displayText
)
warningCellHtml = renderedSegments.join(' / ')
```

**주의**: BE 경고(Case A)의 메시지 포맷에는 날짜(`YYYY-MM-DD`)가 포함된다. 날짜 변환을 BE 경고 세그먼트에서 생략하면 기존 동작(`escapeHtml` 후 날짜 변환)과 달리 원형 날짜 문자열이 그대로 노출되는 회귀가 발생한다. 따라서 `displayText` 변수에 날짜 변환까지 적용한 후, BE 경고와 비 BE 경고 모두에서 공통으로 사용해야 한다.

렌더링 완료 후 `renderScheduleCalcResult` 함수 내 `document.getElementById('schedule-calc-result').innerHTML = html;` 직후에 Bootstrap tooltip 초기화:

```javascript
document.querySelectorAll('#schedule-calc-result [data-bs-toggle="tooltip"]').forEach(function(el) {
    new bootstrap.Tooltip(el, { html: true });
});
```

`{ html: true }` 옵션을 생성자에 명시한다. 이는 프로젝트 내 기존 tooltip 초기화 패턴(app.js line 1264: `new bootstrap.Tooltip(el, { html: true })`)과 일치한다. `data-bs-html="true"` 속성과 생성자 옵션 중 하나만 지정해도 HTML 렌더링이 활성화되나, 프로젝트 일관성을 위해 생성자 옵션 방식을 사용한다.

#### Bootstrap tooltip 활성화 조건 확인

현재 프로젝트에 Bootstrap 5.3이 이미 적용되어 있으며, `bootstrap.Tooltip`은 별도 초기화 코드 없이 `new bootstrap.Tooltip(el, { html: true })` 호출만으로 동작한다.

**주의**: Bootstrap tooltip의 `html: true` 옵션은 기본적으로 XSS 방지를 위해 `sanitize: true`가 활성화되어 있다. Bootstrap 5.3의 기본 허용 목록(allowList)에는 `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` 태그가 **포함되어 있지 않다**. 따라서 기준표 HTML이 sanitize 과정에서 제거되는 것을 방지하려면 tooltip 초기화 전에 allowList를 확장해야 한다.

```javascript
// allowList 확장 (table 관련 태그 추가)
var tooltipAllowList = bootstrap.Tooltip.Default.allowList;
tooltipAllowList.table = [];
tooltipAllowList.thead = ['class'];
tooltipAllowList.tbody = [];
tooltipAllowList.tr = [];
tooltipAllowList.th = [];
tooltipAllowList.td = [];

document.querySelectorAll('#schedule-calc-result [data-bs-toggle="tooltip"]').forEach(function(el) {
    new bootstrap.Tooltip(el, { html: true });
});
```

`bootstrap.Tooltip.Default.allowList`는 전역 객체를 직접 변경하므로, 이 코드 실행 후 프로젝트 내 모든 tooltip에서 table 관련 태그가 허용된다. 이 tooltip은 해당 화면에서만 나타나므로 부작용은 없다.

### 3.5 기존 시스템 연동

영향 받는 코드:
- `app.js` → `renderScheduleCalcResult` 함수만 변경
- `ScheduleCalculationService.java` → 변경 없음
- `index.html` → 변경 없음 (Bootstrap JS 이미 로드됨)

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | 툴팁 콘텐츠 상수 정의 | `BE_WARNING_TOOLTIP_HTML` 상수를 `renderScheduleCalcResult` 함수 상단에 선언 | 낮음 | 없음 |
| T2 | `isBeMemberWarning` 헬퍼 함수 추가 | 경고 세그먼트가 BE 투입 경고인지 판별 | 낮음 | 없음 |
| T3 | 경고 렌더링 로직 수정 | `r.warning` 처리 블록을 segment split → 개별 처리 방식으로 교체 | 중간 | T1, T2 |
| T4 | Bootstrap tooltip 초기화 코드 추가 | `renderScheduleCalcResult` 내 `innerHTML` 할당 직후에 allowList 확장(table 관련 태그) + tooltip 초기화 루프 추가 | 낮음 | T3 |
| T5 | 동작 검증 | 기간 지정/미지정 두 케이스, 복합 경고(" / " 구분) 케이스에서 툴팁 정상 표시 확인 | 낮음 | T4 |

### 4.2 구현 순서

1. **Step 1 - 상수 및 헬퍼 추가**: `renderScheduleCalcResult` 함수 바로 앞에 `BE_WARNING_TOOLTIP_HTML` 상수 선언과 `isBeMemberWarning(text)` 헬퍼 함수를 작성한다.
2. **Step 2 - 경고 행 렌더링 수정**: `if (r.warning)` 블록 내부를 수정한다. warning 문자열을 split 후 각 segment를 BE 경고 여부에 따라 분기 처리하고, BE 경고에는 tooltip 속성이 부여된 `<span>`을 생성한다.
3. **Step 3 - tooltip 초기화 추가**: `document.getElementById('schedule-calc-result').innerHTML = html;` 바로 다음 줄에 allowList 확장 코드와 `querySelectorAll` tooltip 초기화 코드를 추가한다. allowList 확장(`bootstrap.Tooltip.Default.allowList`에 table/thead/tbody/tr/th/td 추가)을 tooltip 생성자 호출 전에 실행해야 기준표 HTML이 sanitize로 제거되지 않는다.
4. **Step 4 - 검증**: 브라우저에서 일정 계산 실행 후 경고 메시지 hover 동작 확인.

### 4.3 테스트 계획

- **케이스 1 (기간 미지정, BE 부족)**: 프로젝트에 BE 멤버를 목표 인원보다 적게 할당하고 일정 계산 실행 → `"BE N명 추가 투입 필요 (현재 M명)"` 문구에 tooltip 표시 확인.
- **케이스 2 (기간 지정, capacity 부족)**: 프로젝트에 endDate 지정 + BE capacity 부족 상태로 계산 → `"BE N명 추가 투입 필요. 현재 인원(M명) 기준 예상 론치일: ..."` 문구에 tooltip 표시 확인.
- **케이스 3 (복합 경고)**: BE 경고와 기간 부족 경고가 동시에 발생하는 상황 → BE 경고 세그먼트에만 tooltip이 적용되고, 기간 부족 경고 세그먼트는 일반 텍스트로 표시됨을 확인.
- **케이스 4 (경고 없음)**: 경고 없는 정상 케이스에서 tooltip 관련 코드가 실행되지 않음을 확인.

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

- **Bootstrap tooltip HTML sanitize 이슈**: Bootstrap 5.3의 `sanitize: true` 기본값으로 인해 `<table>` 관련 태그가 필터링된다. Bootstrap 5.3의 기본 allowList에는 `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` 태그가 포함되어 있지 않으므로, 기준표 HTML을 렌더링하려면 **반드시** `bootstrap.Tooltip.Default.allowList`를 사전에 확장해야 한다. 구체적인 확장 코드는 §3.4 "Bootstrap tooltip 활성화 조건 확인" 항목 참조.
  - 대안: allowList 확장 대신 `sanitize: false` 옵션을 Tooltip 생성자에 전달하는 방법도 있으나, sanitize 완전 비활성화는 XSS 위험이 있으므로 allowList 확장 방식을 권장한다. 또는 기준표를 HTML 대신 텍스트 형식(각 구간을 줄 바꿈으로 나열)으로 fallback하면 allowList 확장 없이 동작 가능하다.
- **tooltip 초기화 시점**: `innerHTML` 할당 후 즉시 `querySelectorAll`로 DOM 요소를 찾아 tooltip을 초기화하는 방식은 동기적으로 동작하므로 타이밍 문제 없음.
- **복수 실행 중복 초기화**: 사용자가 일정 계산 버튼을 여러 번 클릭하면 `schedule-calc-result` 영역이 innerHTML로 교체되므로 이전 tooltip 인스턴스는 자동으로 소멸된다. 추가적인 destroy 처리 불필요.

### 5.2 의존성 리스크

- 변경 범위가 `app.js` 내 단일 함수(`renderScheduleCalcResult`)로 국한되어 있어 다른 기능에 미치는 영향 없음.

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `src/main/resources/static/js/app.js`: `renderScheduleCalcResult` 함수 (line 7905~7969)
- `src/main/java/com/timeline/service/ScheduleCalculationService.java`: `getTargetMemberCount` 메서드 (line 568~574), BE 경고 생성 (line 201, 266)

### 핵심 판단 근거: 프론트엔드 단독 처리

백엔드 변경이 불필요한 이유:
1. 툴팁 콘텐츠(기준표)는 고정 데이터이므로 서버에서 내려줄 필요 없다.
2. BE 투입 경고 여부 판별은 `warning` 문자열 패턴 매칭으로 프론트엔드에서 충분히 처리 가능하다.
3. 백엔드에서 `warningType` 필드를 추가하는 방안도 가능하나, 변경 범위가 넓어지고 얻는 이점이 없다.

### Bootstrap 5.3 tooltip 참고

- 공식 문서: https://getbootstrap.com/docs/5.3/components/tooltips/
- `data-bs-html="true"` 속성으로 HTML 콘텐츠 활성화
- `data-bs-placement="top"` 으로 표시 위치 지정 (기본값 top, 화면 경계에서 자동 조정됨)
