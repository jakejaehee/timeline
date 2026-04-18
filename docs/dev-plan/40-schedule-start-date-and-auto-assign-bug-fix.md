# 개발 계획서: 일정 계산 버그 수정 - 자동 투입 가용일 판단 오류 및 프로젝트 시작일 비가용일 허용

## 1. 개요

- **기능 설명**: 일정 계산(`ScheduleCalculationService`)의 두 가지 버그를 수정한다.
  - **버그 1**: 자동 투입(스쿼드 기반 `autoAssigned=true`) 경로에서 멤버의 기존 프로젝트 론치일을 고려하지 않아, 아직 다른 프로젝트에 투입 중인 멤버를 잘못 투입하는 문제
  - **버그 2**: 기간 미지정(`startDate=null`) 프로젝트에서 개발 시작일(`startDate`)이 비가용일(주말/공휴일)로 결정될 수 있는 문제
- **개발 배경**:
  - 버그 1: '파트너 소비기한별 입고신청(1P/2P)' 프로젝트 일정 계산 시, '유즈드 매입' 프로젝트(론치 5/25)에 투입 중인 송재호·권동희가 '파트너 소비기한별' 개발 기간(5/4~5/20)에 자동 투입됨. 5/25 이전 구간이므로 투입 불가임에도 가용으로 잘못 판단한 것.
  - 버그 2: '유즈드 매입' 프로젝트 일정 계산 결과의 `startDate`가 4/18(토요일)로 표시됨. `queueStartDate`(멤버의 다음 투입 가능일) 또는 `LocalDate.now()`를 그대로 `startDate`로 사용하면서 비가용일 보정을 하지 않은 것.
- **작성일**: 2026-04-18

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 자동 투입(스쿼드 기반) 경로에서 `filterAvailableMembers`가 호출될 때, 기간 지정 프로젝트(`startDate != null && endDate != null`)는 `projEstimatedEnd`로 실제 론치일(`project.getEndDate()`)을 사용해야 한다. 기간 미지정 프로젝트는 기존의 1명 기준 최악 상한(`autoEstEnd`)을 유지한다.
- **FR-002**: 기간 미지정 프로젝트(`startDate=null`)에서 `startDate`는 `멤버의 queueStartDate` 또는 `LocalDate.now()` 중 더 늦은 날짜를 선택한 뒤, 비가용일이면 다음 가용일로 보정하여 결정되어야 한다.
- **FR-003**: 자동 투입 경로에서 기간 미지정인 경우 `filterEndDate`(1명 기준 최악 상한 종료일) 계산의 시작일은 `ensureBusinessDay(projStartEstimate, holidays)`로 보정된 날짜를 사용해야 한다.
- **FR-004**: 기간 미지정이고 멤버의 `queueStartDate`가 다른 프로젝트의 론치 이후 날짜(비가용일 가능성 있음)로 설정된 경우에도 비가용일 보정이 적용되어야 한다.

### 2.2 비기능 요구사항

- **NFR-001**: 고정 일정(`fixedSchedule=true`) 프로젝트의 기존 동작에 영향을 주지 않는다. 고정 일정에서는 `startDate = project.getStartDate()`를 그대로 사용하는 것이 의도된 동작이다.
- **NFR-002**: 이미 올바르게 동작하고 있는 명시적 할당(`autoAssigned=false`) 경로의 가용 판단 로직(`isMemberBusy`, `getMemberAvailableFrom`)은 변경하지 않는다.
- **NFR-003**: UI 응답 형식(`startDate`, `beMembers` 등 필드명)을 변경하지 않는다.

### 2.3 가정 사항

- '유즈드 매입' 프로젝트: `startDate=null`, `endDate=null`, 명시적 BE 멤버 없음, 스쿼드 기반 자동 투입 대상
- '파트너 소비기한별 입고신청' 프로젝트: `startDate=5/4`, `endDate=5/20` (기간 지정)
- 버그 1 관련: 멤버(송재호, 권동희)의 `memberBusyPeriods`에 '유즈드 매입' 프로젝트 기간 `[유즈드 매입 startDate, 론치 다음 영업일 5/26)` 구간이 기록되어 있음 (calculateSchedule 루프에서 이전 프로젝트 종료 후 누적됨)
- 버그 2 관련: '유즈드 매입' 프로젝트 계산 시 `beMembers`의 `queueStartDate`가 모두 null이거나 비가용일인 경우 `startDate`가 `LocalDate.now() = 4/18(토)` 또는 비가용일로 결정됨
- 2026-04-18 현재 `LocalDate.now()` = 4/18(토요일)
- `holidays` Set에 공휴일이 포함되어 있으나, 주말(토/일)은 `BusinessDayCalculator.isBusinessDay()`에서 별도 처리됨

### 2.4 제외 범위 (Out of Scope)

- 명시적 할당(`autoAssigned=false`) 경로의 `isMemberBusy` 판정 로직 변경 (이미 39번 계획서에서 수정됨)
- `memberBusyPeriods` 누적 방식 변경
- `qaAssigneeBusyPeriods` 중복 감지 로직 변경
- 고정 일정 프로젝트의 `startDate` 처리 방식 변경 (이미 올바름)
- 새로운 필드 추가

---

## 3. 버그 분석

### 3.1 버그 1 상세 분석: 자동 투입 시 가용 멤버 필터링 기준 오류

**위치**: `ScheduleCalculationService.java`, `calculateSingleProject()` 내 자동 할당 블록 (라인 118~201)

**문제가 되는 코드**:

```java
// Step 1-2: 가용 멤버 필터링
LocalDate projStartEstimate = estimateProjectStart(project);
// ...
int autoEstDevDays = Math.max((int) Math.ceil(totalMd.doubleValue()), 1);
LocalDate autoEstEnd = bizDayCalc.calculateEndDate(
        bizDayCalc.ensureBusinessDay(projStartEstimate, holidays),  // ← autoEstEnd 시작일은 보정함
        new BigDecimal(autoEstDevDays), BigDecimal.ONE, holidays);
List<Member> availableMembers = filterAvailableMembers(
        squadMemberPool, projStartEstimate, autoEstEnd, memberBusyPeriods);  // ← projStartEstimate는 원본값
```

**`estimateProjectStart` 구현**:

```java
private LocalDate estimateProjectStart(Project project) {
    if (project.getStartDate() != null) return project.getStartDate();
    return LocalDate.now();  // ← 비가용일 보정 없음
}
```

**`filterAvailableMembers` → `isMemberBusy` 판정 기준**:

```java
// 기간 겹침: projStart < period[1](exclusive) AND projEstimatedEnd >= period[0](inclusive)
boolean overlaps = projStart.isBefore(period[1]) && !projEstimatedEnd.isBefore(period[0]);
if (overlaps && !period[1].isBefore(projEstimatedEnd)) {
    return true;  // period[1] >= projEstimatedEnd → 투입불가
}
```

**버그 1 시나리오 재현 ('파트너 소비기한별 입고신청' 프로젝트, `startDate=5/4`, `endDate=5/20`):**

| 항목 | 값 |
|------|-----|
| `projStartEstimate` | `5/4` (`project.getStartDate()`) |
| `autoEstEnd` | `calculateEndDate(5/5(월), 전체MD, 1명, holidays)` → 예: `6/10` |
| 송재호의 `memberBusyPeriods` | `[유즈드 매입 시작일, 유즈드 매입 론치 5/25 다음 영업일 5/26)` → `[X, 5/26)` |
| `isMemberBusy(송재호)` 판정 | `5/4 < 5/26(period[1])` → `true`, `5/26 < autoEstEnd(6/10)` → `period[1] < projEstimatedEnd` → **투입불가 판정 FALSE** |

잠깐, 이 시나리오를 다시 정밀 검토해야 합니다. `isMemberBusy`가 `period[1] >= projEstimatedEnd`일 때만 투입불가를 반환하므로:

- `period[1] = 5/26`, `projEstimatedEnd(autoEstEnd) = 6/10 이상`이면 → `5/26 < 6/10` → `isMemberBusy = false` → **가용으로 판정됨**

즉, **기간 지정 프로젝트**(`5/4~5/20`)를 자동 투입으로 처리할 경우, `autoEstEnd`가 `5/20`보다 훨씬 늦게(1명 기준 전체MD 소화 날짜) 산출되기 때문에, 멤버의 바쁜 기간 종료(`5/26`)가 `autoEstEnd` 이전에 끝나면 **가용으로 오판**된다.

**버그의 핵심**:

자동 투입 경로에서 `autoEstEnd`는 "1명이 전체 MD를 소화하는 데 필요한 날짜"이지만, 실제 프로젝트가 `endDate=5/20`으로 기간이 확정된 경우, 멤버의 가용 판단 기준점은 **프로젝트의 실제 종료일(5/20)** 이어야 한다. `autoEstEnd`가 `6/10`이면 `5/26` 바쁨인 멤버도 가용으로 잘못 분류된다.

**기간 지정(`startDate + endDate`) 자동 투입의 올바른 판단 기준**:

`filterAvailableMembers` 호출 시 `projEstimatedEnd`로 `project.getEndDate()`(= 실제 론치일)를 전달해야 한다.

| 시나리오 | `projEstimatedEnd`로 사용할 값 | 이유 |
|----------|-------------------------------|------|
| `startDate != null && endDate != null` (기간 지정) | `project.getEndDate()` | 실제 론치일이 확정된 경우 정확한 기준 사용 |
| `startDate == null || endDate == null` (기간 미지정) | `calculateEndDate(projStartEstimate, totalMd, 1, holidays)` | 1명 기준 최악 상한 추정값 사용 (기존 로직 유지) |

**수정 요약**:

`autoEstEnd` 산출 로직을 `hasDates(기간 지정 여부)`에 따라 분기한다:

```
// 기간 지정: 실제 종료일을 기준으로 가용 판단
if (project.getStartDate() != null && project.getEndDate() != null) {
    filterAvailableMembers(pool, projStartEstimate, project.getEndDate(), memberBusyPeriods)
} else {
    // 기간 미지정: 1명 기준 최악 상한
    filterAvailableMembers(pool, projStartEstimate, autoEstEnd, memberBusyPeriods)
}
```

---

### 3.2 버그 2 상세 분석: 기간 미지정 프로젝트의 `startDate`가 비가용일로 결정됨

**위치**: `ScheduleCalculationService.java`, `calculateSingleProject()` 내 `else` 블록 (라인 330~366)

**문제가 되는 코드**:

```java
} else {  // fixedSchedule = false (기간 미지정 또는 startDate만 있음)
    if (project.getStartDate() != null) {
        startDate = project.getStartDate();  // startDate만 있으면 그대로 사용 → 올바름(의도적)
    } else {
        LocalDate earliestMemberStart = beMembers.stream()
                .map(Member::getQueueStartDate)
                .filter(Objects::nonNull)
                .min(LocalDate::compareTo)
                .orElse(null);
        startDate = earliestMemberStart != null ? earliestMemberStart : LocalDate.now();
        // ↑ queueStartDate 또는 today를 비가용일 보정 없이 그대로 startDate로 사용
    }
```

**결과**: `startDate`가 4/18(토요일)로 결정됨.

- `today = 4/18(토)` → `beMembers`에 `queueStartDate`가 null인 멤버만 있거나 `queueStartDate`가 모두 null이면 `startDate = LocalDate.now() = 4/18(토)`
- 또는 멤버의 `queueStartDate`가 비가용일(예: 주말이나 공휴일)이면 그 날짜가 그대로 `startDate`가 됨

**참고**: `devCalcStart`(실제 개발 시작 계산 기준일)는 이미 `ensureBusinessDay()`로 보정되고 있다:

```java
LocalDate calcBaseDate = startDate.isBefore(today) ? today : startDate;
LocalDate devCalcStart = bizDayCalc.ensureBusinessDay(calcBaseDate, beUnavailable);  // ← devCalcStart는 보정됨
```

그러나 응답으로 내보내는 `startDate`는 보정 전 값이다:

```java
result.put("startDate", startDate.toString());  // ← 비보정된 startDate
```

**수정 요약**:

`startDate = earliestMemberStart != null ? earliestMemberStart : LocalDate.now();` 이후 즉시 `ensureBusinessDay(startDate, holidays)` 보정을 적용한다.

```java
startDate = earliestMemberStart != null ? earliestMemberStart : LocalDate.now();
startDate = bizDayCalc.ensureBusinessDay(startDate, holidays);  // 비가용일 보정 추가
```

---

### 3.3 두 버그의 연관성

버그 1과 버그 2는 독립적이다. 버그 1은 자동 투입 경로에서 **기간 지정** 프로젝트의 가용 멤버 필터링 기준이 잘못된 문제고, 버그 2는 **기간 미지정** 프로젝트의 응답 `startDate`가 비가용일이 될 수 있는 문제다. 두 버그 모두 `calculateSingleProject()` 내에서 발생하지만 각각 별도 코드 경로에 존재한다.

---

## 4. 시스템 설계

### 4.1 수정 대상 파일

**파일**: `src/main/java/com/timeline/service/ScheduleCalculationService.java`

---

### 4.2 버그 1 수정 설계

**위치**: `calculateSingleProject()` 내 자동 할당 블록 (라인 123~201)

**수정 전 코드** (라인 130~136):

```java
// Step 1-3 & 1-4: 필요 인원 결정 및 선택
// 자동 할당: projEstimatedEnd를 1명 기준 최악 상한으로 산출
int autoEstDevDays = Math.max((int) Math.ceil(totalMd.doubleValue()), 1);
LocalDate autoEstEnd = bizDayCalc.calculateEndDate(
        bizDayCalc.ensureBusinessDay(projStartEstimate, holidays),
        new BigDecimal(autoEstDevDays), BigDecimal.ONE, holidays);
List<Member> availableMembers = filterAvailableMembers(squadMemberPool, projStartEstimate, autoEstEnd, memberBusyPeriods);
```

**수정 후 코드**:

```java
// Step 1-3 & 1-4: 필요 인원 결정 및 선택
// 가용 판단 기준 종료일: 기간 지정이면 실제 론치일, 미지정이면 1명 기준 최악 상한
LocalDate projStartEstimateAdj = bizDayCalc.ensureBusinessDay(projStartEstimate, holidays);
boolean hasDatesForFilter = (project.getStartDate() != null && project.getEndDate() != null);
LocalDate filterEndDate;
if (hasDatesForFilter) {
    filterEndDate = project.getEndDate();  // 실제 론치일 기준
} else {
    int autoEstDevDays = Math.max((int) Math.ceil(totalMd.doubleValue()), 1);
    filterEndDate = bizDayCalc.calculateEndDate(projStartEstimateAdj, new BigDecimal(autoEstDevDays), BigDecimal.ONE, holidays);
}
List<Member> availableMembers = filterAvailableMembers(squadMemberPool, projStartEstimate, filterEndDate, memberBusyPeriods);
```

**변수명 변경 이유**:

- `autoEstEnd`를 `filterEndDate`로 교체하여 의미를 명확히 함
- 기존 `autoEstEnd`를 참조하는 하위 코드가 없으므로 안전한 변경
- `hasDatesForFilter`는 이미 하위 라인 145에 `hasDates`로 동일 조건이 선언되어 있으나, `filterAvailableMembers` 호출 시점(라인 136)은 `hasDates` 선언(라인 145) 이전이므로 필터링 단계에서 별도 변수로 선언해야 함
- `filterAvailableMembers` 호출 시 `projStartEstimate`는 보정 전 원본값을 유지한다. `isMemberBusy` 내부의 `projStart < period[1]` 겹침 판정은 1~2일 보정 여부에 의미 있는 영향이 없으며, 실제 개발 시작 계산은 하위 `devCalcStart = ensureBusinessDay(...)` 에서 별도 보정함

**부수 효과 없음 확인**:

- `autoEstEnd`는 `filterAvailableMembers` 호출에만 사용됨. 하위의 `hasDates`/인원 선정 로직에는 영향 없음.
- `filterAvailableMembers` 내부 로직(`isMemberBusy`)은 변경하지 않음. 파라미터만 수정.

---

### 4.3 버그 2 수정 설계

**위치**: `calculateSingleProject()` 내 `else(fixedSchedule=false)` 블록 (라인 330~366)

**수정 전 코드** (라인 331~340):

```java
if (project.getStartDate() != null) {
    startDate = project.getStartDate();
} else {
    LocalDate earliestMemberStart = beMembers.stream()
            .map(Member::getQueueStartDate)
            .filter(Objects::nonNull)
            .min(LocalDate::compareTo)
            .orElse(null);
    startDate = earliestMemberStart != null ? earliestMemberStart : LocalDate.now();
}
```

**수정 후 코드**:

```java
if (project.getStartDate() != null) {
    startDate = project.getStartDate();
} else {
    LocalDate earliestMemberStart = beMembers.stream()
            .map(Member::getQueueStartDate)
            .filter(Objects::nonNull)
            .min(LocalDate::compareTo)
            .orElse(null);
    startDate = earliestMemberStart != null ? earliestMemberStart : LocalDate.now();
    startDate = bizDayCalc.ensureBusinessDay(startDate, holidays);  // 비가용일 보정 추가
}
```

**변경 1줄 추가**: `startDate = bizDayCalc.ensureBusinessDay(startDate, holidays);`

**`holidays` 사용 이유**: `startDate`는 "프로젝트 개발 시작 예정일"로서 특정 멤버의 개인휴가와 무관하다. `beUnavailable`은 `holidays` + BE 멤버 개인휴가 합집합이므로, 개인휴가를 고려하지 않는 `startDate` 보정에는 `holidays`만 사용하는 것이 의미적으로 적절하다.

**부수 효과 없음 확인**:

- `startDate`는 이후 `calcBaseDate = startDate.isBefore(today) ? today : startDate`로 사용됨. 보정된 `startDate`가 공휴일/주말 등 비가용일이 아니므로 `calcBaseDate`도 올바른 값이 됨.
- `devCalcStart = bizDayCalc.ensureBusinessDay(calcBaseDate, beUnavailable)`로 이중 보정이 되지만 무해함(`ensureBusinessDay`는 이미 영업일이면 해당 날짜를 그대로 반환).
- `result.put("startDate", startDate.toString())`에 보정된 값이 반영됨.

---

### 4.4 API 설계

변경 없음. 기존 `POST /api/v1/schedule/calculate` 엔드포인트 그대로 사용.

응답 `startDate` 필드의 값이 비가용일이 되지 않도록 보정됨 (버그 2 수정 효과).

| Method | Endpoint | 설명 | 변경 사항 |
|--------|----------|------|----------|
| POST | /api/v1/schedule/calculate | 일정 계산 | (버그 1) 자동 투입 가용 판단 기준 종료일 보정, (버그 2) startDate 비가용일 보정 |

---

### 4.5 서비스 계층 변경

**`ScheduleCalculationService.java`**

| 위치 | 변경 유형 | 내용 |
|------|-----------|------|
| 자동 할당 블록 (라인 130~136) | 수정 | `autoEstEnd` → `filterEndDate`로 교체, 기간 지정 여부에 따라 실제 론치일 또는 최악 상한 중 선택 |
| fixedSchedule=false 블록 (라인 339 직후) | 추가 | `startDate = bizDayCalc.ensureBusinessDay(startDate, holidays);` 1줄 추가 |

**변경 범위 최소화**: 두 수정 모두 각각 1~7줄 수준의 국소적 변경이며, 다른 메서드에 영향 없음.

---

### 4.6 프론트엔드 (app.js)

변경 없음. `startDate`가 올바른 날짜로 반환되면 기존 렌더링 로직이 그대로 동작함.

---

## 5. 구현 계획

### 5.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | 버그 1: 자동 투입 필터링 기준 종료일 보정 | 라인 130~136 수정. `autoEstEnd` → 기간 지정이면 `project.getEndDate()`, 미지정이면 기존 최악 상한 사용 | 낮음 | - |
| T-02 | 버그 2: `startDate` 비가용일 보정 | 라인 339 직후 `ensureBusinessDay` 1줄 추가 | 매우 낮음 | - |

### 5.2 구현 순서

1. **T-01** (버그 1): `calculateSingleProject()` 자동 할당 블록에서 `filterEndDate` 산출 로직 수정
   - 조건 분기: `project.getStartDate() != null && project.getEndDate() != null`이면 `filterEndDate = project.getEndDate()`
   - 그 외: 기존 `autoEstEnd` 로직 유지 (`calculateEndDate(projStartEstimateAdj, totalMd, 1명, holidays)`)
   - `filterAvailableMembers` 호출 시 `filterEndDate` 전달

2. **T-02** (버그 2): `fixedSchedule=false` 블록의 `startDate` 결정 직후 `ensureBusinessDay` 보정 1줄 추가

### 5.3 테스트 계획

#### 버그 1 수동 테스트 시나리오

| 케이스 | 조건 | 기대 결과 |
|--------|------|-----------|
| TC-01: 버그 재현 | '파트너 소비기한별 입고신청' 기간 지정(5/4~5/20), 송재호·권동희의 `memberBusyPeriods`에 `[X, 5/26)` 존재 | 송재호·권동희는 `filterEndDate(5/20) < 5/26(period[1])` → 투입불가 → `availableMembers`에서 제외됨 |
| TC-02: 기간 미지정 자동 투입 | `startDate=null`, `endDate=null` | 기존 동작 유지 (1명 기준 최악 상한 사용) |
| TC-03: 기간 지정 + 론치 이후 바쁜 멤버 없음 | 기간 지정, 멤버 바쁜 기간이 `endDate` 이전에 종료 | 가용으로 올바르게 분류 |

#### 버그 2 수동 테스트 시나리오

| 케이스 | 조건 | 기대 결과 |
|--------|------|-----------|
| TC-04: 버그 재현 | 기간 미지정, `today=4/18(토)`, `queueStartDate=null` | `startDate = 4/21(월)` (다음 영업일) |
| TC-05: `queueStartDate`가 비가용일 | `queueStartDate=5/3(일)` | `startDate = 5/4(월)` |
| TC-06: `queueStartDate`가 영업일 | `queueStartDate=5/5(월)` | `startDate = 5/5(월)` (변경 없음) |
| TC-07: 고정 일정 프로젝트 | `startDate=4/18(토)` 고정 | `startDate = 4/18(토)` 그대로 (수정 범위 외, 기존 동작 유지) |

---

## 6. 리스크 및 고려사항

### 6.1 버그 1 관련 리스크

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| `filterEndDate = project.getEndDate()`가 론치일인 경우 의미 | 론치일 당일까지 바쁜 멤버는 투입불가 → 론치 당일 가용한 멤버도 차단될 수 있음 | 허용 가능 수준. 론치일 당일은 사실상 개발 참여 불가. 필요 시 `project.getEndDate().minusDays(1)` 사용 가능하나 현 단계에서는 불필요 |
| 기간 지정이지만 `totalMd`가 기간 내에 수용 불가 | 필터링 후 가용 멤버가 0명이 될 수 있음 | 기존 capacity 부족 경고 로직이 이미 처리함 (라인 162~191) |

### 6.2 버그 2 관련 리스크

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| `project.getStartDate() != null`인 경우 | `startDate = project.getStartDate()`를 그대로 사용하는데, 이것이 비가용일이면? | 이 경우는 수정 대상 아님. 사용자가 명시적으로 비가용일로 설정한 것이므로 보정하지 않는다. UI에서 경고하는 것은 별도 과제로 남김 |
| 자동 투입 경로에서 `projStartEstimate`의 비가용일 보정 여부 | `estimateProjectStart()`가 비가용일을 반환해도, `filterAvailableMembers`의 `projStart`는 원본값 그대로 전달됨 | 기간 겹침 판단(`projStart < period[1]`)에서 `projStart`가 비가용일이어도 계산상 오류는 발생하지 않음. 실제 개발 시작은 `devCalcStart = ensureBusinessDay(...)` 에서 보정됨. 허용 가능 수준 |

---

## 7. 참고 사항

### 관련 파일 경로

| 파일 | 경로 |
|------|------|
| 핵심 수정 대상 | `src/main/java/com/timeline/service/ScheduleCalculationService.java` |
| 영업일 계산 유틸 | `src/main/java/com/timeline/service/BusinessDayCalculator.java` |
| 프론트엔드 | `src/main/resources/static/js/app.js` |
| 이전 자동 투입 버그픽스 계획서 | `docs/dev-plan/39-schedule-auto-assign-member-bug-fix.md` |

### 핵심 수정 위치 요약

| 버그 | 파일 라인 | 수정 내용 | 변경량 |
|------|-----------|-----------|--------|
| 버그 1 | 라인 130~136 | `autoEstEnd` → 기간 지정 여부에 따른 `filterEndDate` 분기 산출 | 7줄 교체 |
| 버그 2 | 라인 339 직후 | `startDate = bizDayCalc.ensureBusinessDay(startDate, holidays);` 추가 | 1줄 추가 |

### 버그 1 판정 로직 재확인

`isMemberBusy(memberId, projStart, projEstimatedEnd, memberBusyPeriods)` 판정:

```
overlaps = projStart < period[1] AND projEstimatedEnd >= period[0]
투입불가 = overlaps AND period[1] >= projEstimatedEnd
```

- 기간 지정 `projEstimatedEnd = project.getEndDate() = 5/20`, 멤버 바쁜 기간 `period[1] = 5/26`
  - `overlaps = 5/4 < 5/26(true) AND 5/20 >= period[0](true)` → 겹침
  - `투입불가 = 5/26 >= 5/20(true)` → **투입불가 (올바른 판정)**
- 기존 `projEstimatedEnd = autoEstEnd = 6/10`, 동일 멤버
  - `overlaps = 5/4 < 5/26(true) AND 6/10 >= period[0](true)` → 겹침
  - `투입불가 = 5/26 >= 6/10(false)` → **가용 (잘못된 판정)** ← 버그
