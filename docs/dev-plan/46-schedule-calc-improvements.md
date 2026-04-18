# 개발 계획서: 일정 계산 개선 4종

## 1. 개요

- **기능 설명**: ScheduleCalculationService 및 app.js의 일정 계산 관련 버그 4종 수정
- **개발 배경 및 목적**: 일정 계산 결과의 정확도 향상 및 UI 가독성 개선
- **작성일**: 2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: '미분류' 프로젝트(이름이 정확히 "미분류"인 프로젝트)를 일정 계산에서 완전 제외한다. KTLO와 동일하게 `skipped: true`로 처리하며, 결과 테이블에도 표시하지 않는다.
- **FR-002**: 0 MD 프로젝트라도 앞 프로젝트의 론치일 다음 영업일을 시작일로 설정해야 한다. 현재 `launchDate` 기준이 아닌 `memberBusyPeriods`의 순차 흐름과 무관하게 고정 시작일이 반환되는 문제를 수정한다.
- **FR-003**: 자동 투입된 멤버 중 `lateJoinDate`(= `availableFrom`)가 개발 종료일(`devEndDate`) 이후인 멤버는 투입 대상에서 제외한다. 해당 멤버는 QA 참여자 목록에도, `_beMemberIds`(바쁜 기간 누적)에도 포함되지 않는다.
- **FR-004**: 경고 행(warning row)의 텍스트 가독성을 개선한다. 노란 배경(`#fff8e1`)에 흰색 텍스트(`text-warning`)가 아닌, 진한 색상(`text-dark` 또는 `#856404`)으로 변경한다. BE 투입 필요 경고의 Bootstrap tooltip도 기본 흰 글씨가 아닌 다크 테마 tooltip(`data-bs-theme="dark"` 또는 커스텀 스타일)으로 변경한다.

### 2.2 비기능 요구사항

- **NFR-001**: 기존 계산 로직의 다른 경로(fixedSchedule, 명시적 할당 등)에는 영향을 주지 않는다.
- **NFR-002**: DB 스키마 변경 없이 순수 로직 수정만으로 해결한다.

### 2.3 가정 사항

- '미분류' 프로젝트의 식별 기준은 `project.getName().equals("미분류")` 이름 문자열 비교 방식을 사용한다. `ktlo` 플래그와 별도로, 이름 비교로 처리한다.
- 0 MD 시작일 보정 문제는 `fixedSchedule=false`이고 `project.getStartDate()==null`인 경우(자동 시작일 산출 경로)에서 발생한다. 0 MD 프로젝트는 자동 할당 블록이 `totalMd > 0` 조건으로 진입하지 못해 `beMembers`가 비어 있고, 결과적으로 `earliestMemberStart`도 null이 되어 `startDate = LocalDate.now()`로 고정된다. 앞 프로젝트의 론치일 정보는 `memberBusyPeriods`에 기록되어 있으나 이를 참조하는 경로가 없어 발생하는 버그이다.
- 개발 완료일(`devEndDate`) 기준으로 lateJoinDate 초과 여부를 판단한다. `devEndDate`는 Step 2 계산 이후 확정된다.
- UI 색상 수정은 `text-warning` 클래스(Bootstrap 기본: 노란색 텍스트, 흰 배경에서 가시성 보장되나 노란 배경에서는 보이지 않음)를 `text-dark` 또는 인라인 `color:#856404`(Bootstrap warning-emphasis 색상)으로 교체한다.

### 2.4 제외 범위 (Out of Scope)

- '미분류' 프로젝트의 삭제 또는 프로젝트 목록에서의 숨김 처리 (일정 계산에서만 제외)
- 0 MD + fixedSchedule=true 경로 (기간 지정이면 사용자가 startDate를 직접 입력하므로 보정 불필요)
- lateJoinDate 초과 멤버의 UI 표시 방식 변경 (제외된 멤버를 busyMembers 등으로 표시할지 여부; 이번에는 단순 제외만 처리)
- tooltip 내부 테이블 구조 변경

---

## 3. 시스템 설계

### 3.1 데이터 모델

엔티티 변경 없음. 기존 `Project`, `Member`, `ProjectMember` 엔티티를 그대로 사용한다.

### 3.2 API 설계

API 변경 없음. `POST /api/v1/projects/schedule-calculate` 엔드포인트 그대로 사용.

응답 구조 변화 (FR-001):
- 기존: `skipped: true, skipReason: "KTLO 프로젝트는 일정 계산에서 제외됩니다."` (KTLO 전용)
- 신규 추가: `skipped: true, skipReason: "'미분류' 프로젝트는 일정 계산에서 제외됩니다."` (미분류 전용)

### 3.3 서비스 계층 변경 사항

**파일**: `src/main/java/com/timeline/service/ScheduleCalculationService.java`

#### FR-001: 미분류 프로젝트 제외

변경 위치: `calculateSchedule()` 메서드, KTLO 스킵 처리 직후 (약 64~72번 줄)

현재 코드:
```java
// KTLO 프로젝트는 일정 계산에서 제외
if (Boolean.TRUE.equals(project.getKtlo())) {
    // ... skipped 처리
    continue;
}
```

추가 로직:
```
KTLO 체크 직후에 추가:
if ("미분류".equals(project.getName())) {
    skipped 맵 생성 후 continue
}
```

`skipReason` 메시지: `"'미분류' 프로젝트는 일정 계산에서 제외됩니다."`

#### FR-002: 0 MD 프로젝트 시작일 보정

변경 위치: `calculateSingleProject()` → else 분기 (fixedSchedule=false), 약 355~393번 줄

**현재 문제**: `project.getStartDate()==null`인 0 MD 프로젝트에서 `startDate`가 `LocalDate.now()`로 고정된다. 이유는 두 가지다.

1. 자동 할당 블록(라인 131)이 `totalMd.compareTo(BigDecimal.ZERO) > 0` 조건으로 진입하므로, 0 MD 프로젝트는 `beMembers`가 비어 있고 `lateJoinDates`도 채워지지 않는다.
2. fixedSchedule=false 분기(라인 356~393)에서 `earliestMemberStart = beMembers.stream()...min()...orElse(null)` → beMembers가 비어 있으면 null → `startDate = LocalDate.now()`가 된다.

따라서 앞 프로젝트의 론치일 다음 영업일이 `memberBusyPeriods`에 기록되어 있어도, 0 MD 프로젝트는 이를 참조하지 못하고 항상 오늘 날짜를 시작일로 반환한다.

**수정 방향**: `beMembers`가 비어 있거나 `earliestMemberStart`가 null인 경우, `memberBusyPeriods`에서 관련 스쿼드 멤버들의 바쁜 기간 종료일 최대값을 직접 조회하여 시작일 후보로 사용한다.

현재 시작일 산출 로직 (fixedSchedule=false, `project.getStartDate()==null` 경로):
```java
// 라인 359~366
LocalDate earliestMemberStart = beMembers.stream()
        .map(Member::getQueueStartDate)
        .filter(Objects::nonNull)
        .min(LocalDate::compareTo)
        .orElse(null);
startDate = earliestMemberStart != null ? earliestMemberStart : LocalDate.now();
startDate = bizDayCalc.ensureBusinessDay(startDate, holidays);
```

수정 방향:
```
1. earliestMemberStart가 null (beMembers가 비거나 queueStartDate 없음)인 경우:
   a. 전체 스쿼드 멤버 풀(squadMemberPool)의 memberBusyPeriods 종료일 중 최대값을 candidate로 사용
   b. candidate가 없으면 LocalDate.now() 유지
2. 최종 startDate = bizDayCalc.ensureBusinessDay(candidate, holidays)
```

> **주의**: 수정 대상은 fixedSchedule=false 이고 `project.getStartDate()==null`인 경우만이다. `beMembers`가 비어 있는 경우(0 MD 또는 가용 멤버 없음)에 한해 추가 보정 경로를 실행한다. 기존 `earliestMemberStart` 산출 로직은 `beMembers`가 있는 경우 그대로 유지한다.

#### FR-003: lateJoinDate가 devEndDate 이후인 멤버 제외

변경 위치: `calculateSingleProject()`, Step 2 일정 계산 완료 후 (devEndDate 확정 이후)

추가 로직 위치: devEndDate 계산 직후 (fixedSchedule=false 분기의 devEndDate 확정 후 및 fixedSchedule=true 분기 모두 적용)

**처리 순서**:
1. devEndDate 확정
2. `lateJoinDates` 맵에서 `availableFrom > devEndDate`인 멤버를 필터링
3. 해당 멤버를 `beMembers`에서 제거
4. `beCapacity` 재계산 (제거된 멤버의 capacity 빼기)
5. 제거된 멤버는 **`busyMembers`로 이동하지 않는다**. `busyMembers`는 `!autoAssigned` 블록에서만 채워지는 목록이며, 제거된 멤버를 여기에 추가하면 `_beMemberIds` 조립 시 다시 포함된다(`allIds`에 `busyMembers`도 포함, 라인 454~455). 대신 별도 `lateExcludedMembers` 목록으로 구성하여 응답에만 포함한다.
6. `_beMemberIds`에는 포함하지 않는다. 실제 코드에서 `_beMemberIds = beMembers + busyMembers`이므로, `beMembers`에서 제거하고 `busyMembers`에도 추가하지 않으면 자동으로 `_beMemberIds`에서 제외된다.

**응답 구조 추가 (선택)**:
- `lateExcludedMembers`: `[{name, availableFrom}]` 형태로 응답에 포함하여 UI에서 "개발 기간 이후 합류 불가" 표시 가능

단, FR-003은 자동 투입(autoAssigned=true) 경우에만 적용한다. 명시적 할당(autoAssigned=false) 경우는 사용자가 직접 지정한 것이므로 제외 처리하지 않는다.

#### devEndDate 기준 정의

- fixedSchedule=false: 개발 계산 완료 후의 `devEndDate` (라인 370~374, `calculateEndDate(devCalcStart, devDays, ...)` 결과)
- fixedSchedule=true: 동일하게 실제 계산된 `devEndDate` (라인 322~326, `calculateEndDate(devCalcStart, devDays, ...)` 결과). `devEndTarget`(멤버 선정 시 QA 역산용 변수)과는 다른 변수이므로 혼동 주의. lateJoinDate 비교에는 실제 계산된 `devEndDate`를 사용한다.

### 3.4 프론트엔드 변경 사항

**파일**: `src/main/resources/static/js/app.js`

#### FR-004a: 경고 행 텍스트 색상 수정

변경 위치: `renderScheduleCalcResult()` 함수, 약 7982번 줄

현재 코드:
```html
<tr>
  <td colspan="7" class="text-warning" style="font-size:0.8rem; background:#fff8e1;">
    <i class="bi bi-exclamation-triangle-fill"></i> ...
  </td>
</tr>
```

문제: `background:#fff8e1`(밝은 노란색) + `class="text-warning"`(Bootstrap warning = `#ffc107` 노란색 텍스트) → 노란 배경에 노란 글씨라 보이지 않음

수정:
- `class="text-warning"` → `class=""` (제거) 또는 `style="color:#856404;"` 추가
- `#856404`는 Bootstrap 5의 `$warning-text-emphasis` 값 (어두운 금색, 노란 배경에서 충분한 대비)

최종 스타일 예시:
```html
<td colspan="7" style="font-size:0.8rem; background:#fff8e1; color:#856404;">
```

#### FR-004b: BE 투입 필요 경고 tooltip 색상 수정

변경 위치: `renderScheduleCalcResult()` 함수, 약 7977번 줄

현재 코드:
```js
'<span data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="top"
  title="' + escapeHtml(BE_WARNING_TOOLTIP_HTML) + '"
  style="cursor:help; border-bottom:1px dotted #ffc107;">'
```

문제: Bootstrap 기본 tooltip은 어두운 배경(#000) + 흰 텍스트. `BE_WARNING_TOOLTIP_HTML`의 `<tbody>` 행은 흰 배경이므로, tooltip의 기본 어두운 배경 위에 흰 배경 표가 렌더링되면 외곽은 어둡고 내부는 흰 배경에 기본 글씨색이 혼재하여 시각적으로 일관성이 없다. 또한 `<thead class="table-dark">`의 th 글씨(Bootstrap 기본 흰색)가 tooltip의 기본 어두운 배경과 겹쳐 구분이 어렵다. `data-bs-theme="dark"`를 적용하면 tooltip 전체가 다크 테마로 통일되어 표 내부도 다크 스타일로 렌더링된다.

수정 방법 2가지 중 선택:
- **방법 A**: `data-bs-theme="dark"` 속성을 `<span>`에 추가 → tooltip 전체가 다크 테마 (간단하지만 배경색도 변경됨)
- **방법 B**: `BE_WARNING_TOOLTIP_HTML`의 tbody 행에 명시적 인라인 스타일 (`style="color:#212529; background:#fff;"`) 추가 → tooltip 기본 흰 배경에서 검정 글씨 보장

**권장: 방법 A** (`data-bs-theme="dark"`) — 코드 변경 최소화, Bootstrap 표준 방식

수정 후 span:
```html
<span data-bs-toggle="tooltip" data-bs-html="true" data-bs-placement="top"
  data-bs-theme="dark"
  title="..." style="cursor:help; border-bottom:1px dotted #ffc107;">
```

### 3.5 기존 시스템 연동

- `calculateSchedule()`: 변경 없음 (FR-001 스킵 처리 추가만)
- `calculateSingleProject()`: FR-002, FR-003 로직 추가. 기존 fixedSchedule, 명시적 할당 경로에 영향 없음
- `_beMemberIds` 누적: FR-003 제외 멤버는 이 목록에도 포함하지 않아야 함 (다음 프로젝트 바쁜 기간 계산 오염 방지)

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | FR-001 미분류 스킵 처리 | `calculateSchedule()`에 이름 비교 스킵 로직 추가 | 낮음 | 없음 |
| T-02 | FR-002 0 MD 시작일 보정 | `calculateSingleProject()`에서 memberBusyPeriods 기반 시작일 보정 (earliestMemberStart null 경로) | 중간 | 없음 |
| T-03 | FR-003 lateJoinDate > devEndDate 멤버 제외 | devEndDate 확정 후 필터링 + capacity 재계산 + _beMemberIds 제외 | 중간 | 없음 (T-02와 처리 위치 독립) |
| T-04 | FR-004a 경고 행 텍스트 색상 수정 | `renderScheduleCalcResult()` td 인라인 스타일 변경 | 낮음 | 없음 |
| T-05 | FR-004b tooltip 다크 테마 적용 | span에 `data-bs-theme="dark"` 추가 | 낮음 | 없음 |

### 4.2 구현 순서

1. **Step 1 (T-01)**: `ScheduleCalculationService.calculateSchedule()`에 미분류 프로젝트 스킵 처리 추가. KTLO 스킵 블록 직후에 추가.

2. **Step 2 (T-02)**: `calculateSingleProject()` — fixedSchedule=false + `project.getStartDate()==null` 경로에서 `earliestMemberStart`가 null인 경우(0 MD이거나 beMembers 없음) `memberBusyPeriods`를 직접 참조하는 보정 로직 추가.

   구체적 변경:
   - `earliestMemberStart`가 null인 경우에만 보정 경로 진입
   - 스쿼드 멤버 풀(`squadMemberPool`)을 다시 조회하거나, 기존에 조회한 풀을 활용하여 각 멤버의 `memberBusyPeriods` 종료일 최대값을 candidate로 사용
   - `startDate` 재산출: `candidate != null ? candidate : LocalDate.now()` → `bizDayCalc.ensureBusinessDay()`
   - `lateJoinDates`는 0 MD 경로에서는 비어 있으므로 시작일 산출에 사용하지 않는다.

3. **Step 3 (T-03)**: devEndDate 확정 직후 (fixedSchedule 분기 모두 처리 완료 후) lateJoinDate 초과 멤버 필터링.

   ```
   devEndDate 확정 후:
   if (autoAssigned) {
       제거 대상 = lateJoinDates에서 value > devEndDate인 멤버
       beMembers에서 제거
       beCapacity 재계산
       lateJoinDates에서도 제거
       _beMemberIds 구성 시 제외
   }
   ```

4. **Step 4 (T-04, T-05)**: `app.js`에서 경고 행 td 스타일 변경 및 tooltip span에 `data-bs-theme="dark"` 추가.

### 4.3 테스트 계획

| 시나리오 | 기대 결과 |
|---------|---------|
| '미분류' 프로젝트 포함하여 계산 요청 | '미분류' 프로젝트는 결과 테이블에 표시되지 않음 (skipped 처리) |
| 0 MD 프로젝트가 다른 프로젝트 뒤에 배치된 경우 | 앞 프로젝트 론치일 다음 영업일이 시작일로 표시됨 |
| 멤버의 availableFrom이 devEndDate 이후인 경우 (자동 투입) | 해당 멤버가 beMembers에서 제외되어 beCount 감소 및 다음 프로젝트 바쁜 기간 미포함 |
| 멤버의 availableFrom이 devEndDate 이전인 경우 | 기존대로 정상 포함 |
| 경고 행 렌더링 | 노란 배경에 진한 금색(#856404) 텍스트로 표시 |
| BE 투입 필요 경고 tooltip hover | 다크 테마 tooltip으로 표시 (흰 글씨 문제 없음) |

---

## 5. 리스크 및 고려사항

### 5.1 FR-002 시작일 재산출 로직의 복잡성

현재 `calculateSingleProject()`에서 `startDate` 산출은 Step 1 (beMembers 결정, 라인 106~269) 이후의 fixedSchedule 분기(라인 316 이후)에서 이루어진다. 그러나 0 MD 경로에서는 `beMembers`가 비어 `lateJoinDates`도 채워지지 않은 상태이므로, 이를 참조하는 로직을 추가하면 항상 null을 반환한다. 즉, lateJoinDates를 시작일 산출에 활용할 수 없고 `memberBusyPeriods`를 직접 참조해야 한다.

**완화 방안**: `earliestMemberStart`가 null(beMembers 없거나 queueStartDate 없음)이고 `project.getStartDate()==null`인 경우에만 추가 보정 경로를 적용한다. 보정 시 `lateJoinDates`는 0 MD 경로에서 비어 있으므로 사용할 수 없고, `memberBusyPeriods`에서 직접 종료일 최대값을 조회한다. 기존 `earliestMemberStart` 산출 로직은 beMembers가 있는 경우 그대로 유지하여 변경 범위를 최소화한다.

### 5.2 FR-003 devEndDate 확정 시점

FR-003은 devEndDate가 확정된 이후에만 처리 가능하다. fixedSchedule=true와 false 두 분기 모두에서 devEndDate 확정 후 동일한 필터링 로직이 실행되어야 하므로, 두 분기 이후의 공통 영역에 배치하거나 각 분기 내부에서 처리해야 한다.

**완화 방안**: 두 분기 종료 후, `// ===== 결과 조립 =====` 직전 공통 블록에 필터링 로직 배치. `devEndDate`가 이미 확정된 시점이므로 안전하게 처리 가능.

### 5.3 FR-003 자동 투입에만 적용

명시적 할당(autoAssigned=false) 경우는 사용자가 직접 지정한 멤버이므로 자동 제외하면 안 된다. 조건문으로 `autoAssigned` 플래그를 반드시 체크해야 한다.

### 5.4 tooltip data-bs-theme 브라우저 지원

Bootstrap 5.3부터 `data-bs-theme="dark"` 지원. 프로젝트에서 Bootstrap 5.3을 사용하므로 호환 문제 없음.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 위치 | 설명 |
|------|------|------|
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | 64~72 줄 | KTLO 스킵 처리 → FR-001 추가 위치 |
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | 126~222 줄 | autoAssigned 분기, lateJoinDates 채우기 → FR-002, FR-003 연관 |
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | 355~393 줄 | fixedSchedule=false 분기, startDate/devEndDate 산출. FR-002 수정 대상은 356~365줄 (`earliestMemberStart` null 경로) |
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | 413~458 줄 | 결과 조립 → FR-003 필터링 적용 위치 (결과 조립 직전) |
| `src/main/resources/static/js/app.js` | 7972~7983 줄 | 경고 행 렌더링 → FR-004a 수정 위치 |
| `src/main/resources/static/js/app.js` | 7974~7978 줄 | BE 투입 경고 tooltip span → FR-004b 수정 위치 |
| `src/main/java/com/timeline/service/JiraImportService.java` | 676~690 줄 | '미분류' 프로젝트 생성/조회 (참고용, 수정 불필요) |

### 미분류 프로젝트 식별 방식 결정 근거

`Project` 엔티티에 별도 `type`, `category` 필드가 없다. `ktlo` 플래그처럼 전용 불리언을 추가하는 방법도 있으나, 이번 요구사항은 코드 변경 최소화를 목표로 하므로 이름 비교(`"미분류".equals(project.getName())`) 방식을 채택한다.

향후 '미분류' 외의 특수 카테고리가 늘어난다면, `Project` 엔티티에 `skipScheduleCalc` 플래그를 추가하는 방향을 고려할 수 있다.
