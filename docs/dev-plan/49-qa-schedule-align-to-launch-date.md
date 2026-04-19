# 개발 계획서: QA 기간 론치일 기준 역산 재배치

## 1. 개요

### 기능 설명
론치일(endDate)이 지정된 non-fixedSchedule 프로젝트에서, 일정 계산 결과 QA 종료일이 론치일보다 앞서는 경우(여유 일수 발생 시) QA 종료일이 `launchDate - 1영업일`이 되도록 QA 시작일을 역산하여 재배치한다.

### 개발 배경 및 목적
현재 non-fixedSchedule 계산 경로에서 `project.endDate`가 지정되어 있으면 `launchDate = project.endDate`로 확정되지만, QA 기간은 여전히 `devEndDate` 다음날부터 순방향으로 계산(`qaStartDate = getNextBusinessDay(devEndDate)`, `qaEndDate = calculateEndDate(qaStartDate, qaDays)`)된다. 결과적으로 QA 종료일과 론치일 사이에 불필요한 갭이 생긴다.

예시:
- 개발 종료: 5/12(화)
- QA 5d 순방향 계산: 5/13(수) ~ 5/19(화)
- 론치일: 6/11(목)
- 갭: 5/20 ~ 6/10 (17영업일)

기대 결과:
- QA 종료일: 6/10(수) = 론치일(6/11) - 1영업일
- QA 시작일: 6/4(목) = 6/10 - (5-1)영업일 역산

이미 fixedSchedule 경로(startDate + endDate 모두 지정)에서는 동일한 역산 로직이 구현되어 있으며, 이번 작업은 **non-fixedSchedule 경로 중 endDate만 지정된 경우**에도 같은 규칙을 적용하는 것이다.

### 작성일
2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: `project.endDate != null AND project.startDate == null` (반고정 일정: endDate만 지정)인 경우, QA 기간을 역산 방식으로 계산한다.
  - `qaEndDate = launchDate - 1영업일`
  - `qaStartDate = qaFixedStartDate가 있으면 그대로 사용, 없으면 qaEndDate - (qaDays-1)영업일 역산`
- **FR-002**: `project.startDate != null AND project.endDate != null` (fixedSchedule)인 경우 현재 로직을 유지한다. 이번 변경의 영향을 받지 않는다.
- **FR-003**: `project.endDate == null` (론치일 미지정)인 경우 기존 순방향 계산을 유지한다.
- **FR-004**: QA 종료일 역산 후에도 `qaDays <= 0` 또는 `qaDays == null`이면 QA 계산 자체를 스킵한다 (기존 규칙 유지).
- **FR-005**: `qaFixedStartDate`(마일스톤에 시작일이 명시된 경우)는 역산 QA에서도 그대로 `qaStartDate`로 사용한다 (기존 fixedSchedule 역산과 동일한 처리).

### 2.2 비기능 요구사항

- **NFR-001**: 기존 fixedSchedule 경로 및 `endDate == null` 경로에 영향을 주지 않아야 한다.
- **NFR-002**: 정책 문서(`docs/schedule-calculation-policy.md`, `docs/schedule-calculation-summary.md`)의 섹션 3.6을 수정하여 변경 내용을 반영해야 한다.

### 2.3 가정 사항

- non-fixedSchedule에서 `launchDate` 변수 할당은 QA 계산 이후에 이루어지므로, QA 역산 시에는 `project.getEndDate()`를 직접 참조한다. 코드에서 `LocalDate launchDateForQa = project.getEndDate()`로 지역 변수에 담아 사용하는 이유이다.
- 역산 QA 비가용일은 기존과 동일하게 `qaUnavailable`(공휴일 포함 Set)을 사용한다.
- `subtractBusinessDays()` 헬퍼 메서드가 이미 존재하므로 그대로 활용한다.

### 2.4 제외 범위 (Out of Scope)

- fixedSchedule 경로(startDate + endDate 모두 지정) 로직 변경 없음
- `qaFixedStartDate`가 지정된 경우의 유효성 검증(론치일보다 늦은 경우 등) — 기존과 동일하게 그대로 사용
- QA 시작일이 devEndDate보다 앞서는 경우의 경고 처리 — 이번 범위 제외 (추후 검토)

---

## 3. 시스템 설계

### 3.1 변경 대상 코드 위치

```
src/main/java/com/timeline/service/ScheduleCalculationService.java
  └── computeTimeline() 메서드, non-fixedSchedule 분기 내 QA 계산 블록 (line 788~795)
```

### 3.2 현재 코드 (변경 전)

`computeTimeline()` 메서드의 non-fixedSchedule 분기 (line 788~795):

```java
// [현재] non-fixedSchedule 분기 - QA 계산
if (qaDays != null && qaDays > 0) {
    if (qaFixedStartDate != null) {
        qaStartDate = bizDayCalc.ensureBusinessDay(qaFixedStartDate, qaUnavailable);
    } else {
        qaStartDate = bizDayCalc.getNextBusinessDay(devEndDate, qaUnavailable);
    }
    qaEndDate = bizDayCalc.calculateEndDate(qaStartDate, new BigDecimal(qaDays), BigDecimal.ONE, qaUnavailable);
}
```

그 후 론치일 결정 (line 797~805):
```java
if (totalMd.compareTo(BigDecimal.ZERO) == 0 && project.getEndDate() == null) {
    launchDate = null;
} else if (project.getEndDate() != null) {
    launchDate = project.getEndDate();  // endDate가 지정되면 론치일 = endDate
} else if (qaEndDate != null) {
    launchDate = bizDayCalc.getNextBusinessDay(qaEndDate, holidays);
} else {
    launchDate = bizDayCalc.getNextBusinessDay(devEndDate, holidays);
}
```

**문제**: `project.endDate != null`이면 `launchDate = project.endDate`로 확정되지만, QA는 이미 `devEndDate` 기준 순방향으로 계산되어 버렸다.

### 3.3 변경 후 설계

non-fixedSchedule 분기에서 QA 계산 전에 `project.endDate` 존재 여부를 먼저 확인하여 분기한다:

```java
// [변경 후] non-fixedSchedule 분기 - QA 계산
if (qaDays != null && qaDays > 0) {
    if (project.getEndDate() != null) {
        // endDate가 지정된 경우: fixedSchedule과 동일하게 역산
        // launchDate 변수 할당은 QA 계산 이후에 이루어지므로 project.getEndDate()를 직접 참조
        LocalDate launchDateForQa = project.getEndDate();
        qaEndDate = subtractBusinessDays(launchDateForQa, 1, qaUnavailable);
        if (qaFixedStartDate != null) {
            // fixedSchedule 경로와 동일하게 ensureBusinessDay 보정 없이 그대로 사용
            qaStartDate = qaFixedStartDate;
        } else {
            qaStartDate = subtractBusinessDays(qaEndDate, qaDays - 1, qaUnavailable);
        }
    } else {
        // endDate 미지정: 기존 순방향 계산
        if (qaFixedStartDate != null) {
            qaStartDate = bizDayCalc.ensureBusinessDay(qaFixedStartDate, qaUnavailable);
        } else {
            qaStartDate = bizDayCalc.getNextBusinessDay(devEndDate, qaUnavailable);
        }
        qaEndDate = bizDayCalc.calculateEndDate(qaStartDate, new BigDecimal(qaDays), BigDecimal.ONE, qaUnavailable);
    }
}
```

> **참고**: `qaFixedStartDate` 처리에서 endDate 지정 분기는 fixedSchedule 경로(line 703~704)와 동일하게 `ensureBusinessDay()` 보정 없이 그대로 사용한다. endDate 미지정 기존 순방향 분기(line 789~791)는 `ensureBusinessDay(qaFixedStartDate, qaUnavailable)` 를 호출했으나, 역산 분기에서는 fixedSchedule과의 일관성을 위해 보정을 생략한다.

### 3.4 계산 예시 검증

**입력값**:
- startDate: null (자동), endDate: 2026-06-11(목)
- totalMd: 15d, beCapacity: 1.0
- qaDays: 5d, qaFixedStartDate: null
- 오늘: 2026-04-20(월)

**계산 흐름**:
1. devDays = ceil(15 / 1.0) = 15
2. startDate = 멤버 가용일 기준 (예: 2026-04-20)
3. devCalcStart = 2026-04-20(월)
4. devEndDate = calculateEndDate(4/20, 15일) = 2026-05-08(금)
   - `calculateEndDate`는 시작일(4/20)을 1번째 영업일로 카운트하므로 15번째 영업일은 5/8(금)
5. launchDate = 2026-06-11 (endDate) — QA 계산 후 확정되지만 project.getEndDate()로 역산 시 직접 참조
6. QA 역산:
   - qaEndDate = 2026-06-11 - 1영업일 = 2026-06-10(수)
   - qaStartDate = 2026-06-10 - (5-1)영업일 = 2026-06-04(목)

**결과**: QA 6/4(목) ~ 6/10(수) 5d, 론치 6/11(목)

### 3.5 fixedSchedule vs. non-fixedSchedule(endDate지정) 비교

| 구분 | fixedSchedule | non-fixedSchedule + endDate 지정 |
|------|--------------|----------------------------------|
| 조건 | startDate != null AND endDate != null | startDate == null AND endDate != null |
| 론치일 | project.endDate | project.endDate |
| QA 역산 방식 | `qaEndDate = launchDate - 1영업일` | 동일 (이번 변경으로 추가) |
| qaFixedStartDate | 그대로 사용 | 동일 |
| 기간 부족/여유 경고 | 생성 (ratio 기반) | 생성하지 않음 (기존 유지) |

### 3.6 정책 문서 변경 사항

`docs/schedule-calculation-policy.md` 섹션 3.6 수정:

현재:
> 론치일이 지정되어 있고 QA를 수행하는 경우, 개발완료 후 QA를 시작해 종료한 뒤 론치일까지 여유일(`N days`)이 남더라도 **QA 종료일은 항상 `launchDate - 1영업일`**이 되도록 QA 시작일을 역산해 정한다.

변경 후: 위 설명을 fixedSchedule에만 국한하지 않고, **endDate가 지정된 모든 경우**(fixedSchedule 포함 반고정)로 명시.

`docs/schedule-calculation-summary.md` 섹션 4.4 수정:

현재:
```
#### fixedSchedule (역산 방식)
qaEndDate = launchDate - 1영업일
qaStartDate = qaFixedStartDate ?? (qaEndDate - (qaDays-1)영업일)
```

변경 후:
```
#### endDate 지정 시 (역산 방식: fixedSchedule 또는 endDate만 지정)
조건: project.endDate != null (fixedSchedule 여부 무관)
qaEndDate = launchDate - 1영업일
qaStartDate = qaFixedStartDate ?? (qaEndDate - (qaDays-1)영업일)

#### endDate 미지정 시 (순방향 방식)
조건: project.endDate == null
qaStartDate = qaFixedStartDate 있으면 ensureBusinessDay() 후 사용,
             없으면 getNextBusinessDay(devEndDate)
qaEndDate = calculateEndDate(qaStartDate, qaDays)
```

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 파일 | 설명 | 복잡도 |
|---|------|------|------|--------|
| T1 | 서비스 로직 수정 | `ScheduleCalculationService.java` | `computeTimeline()` non-fixedSchedule QA 계산 블록 분기 추가 | 낮음 |
| T2 | 정책 문서 업데이트 | `docs/schedule-calculation-policy.md` | 섹션 3.6 문구 수정 | 매우 낮음 |
| T3 | 종합 정리 문서 업데이트 | `docs/schedule-calculation-summary.md` | 섹션 4.4 수정 | 매우 낮음 |

### 4.2 구현 순서

1. **Step 1 (T1)**: `ScheduleCalculationService.java`의 `computeTimeline()` 메서드 수정
   - non-fixedSchedule 분기(`else` 블록) 내부의 QA 계산 블록(line 788~795)을 대상으로 함
   - `project.getEndDate() != null` 여부로 분기 추가
   - endDate 지정 시: `subtractBusinessDays()` 사용한 역산 적용
   - endDate 미지정 시: 기존 순방향 코드 유지

2. **Step 2 (T2, T3)**: 정책 문서 두 개 업데이트

### 4.3 상세 변경 코드

변경 위치: `computeTimeline()` 메서드, non-fixedSchedule 분기 내부

```java
// 변경 전 (line 788~795)
if (qaDays != null && qaDays > 0) {
    if (qaFixedStartDate != null) {
        qaStartDate = bizDayCalc.ensureBusinessDay(qaFixedStartDate, qaUnavailable);
    } else {
        qaStartDate = bizDayCalc.getNextBusinessDay(devEndDate, qaUnavailable);
    }
    qaEndDate = bizDayCalc.calculateEndDate(qaStartDate, new BigDecimal(qaDays), BigDecimal.ONE, qaUnavailable);
}
```

```java
// 변경 후
if (qaDays != null && qaDays > 0) {
    if (project.getEndDate() != null) {
        // endDate 지정: 론치일에서 역산 (fixedSchedule과 동일한 방식)
        // launchDate 변수 할당은 이 블록 이후에 이루어지므로 project.getEndDate()를 직접 참조
        LocalDate launchDateForQa = project.getEndDate();
        qaEndDate = subtractBusinessDays(launchDateForQa, 1, qaUnavailable);
        if (qaFixedStartDate != null) {
            // fixedSchedule(line 703~704)과 동일하게 ensureBusinessDay 보정 없이 그대로 사용
            qaStartDate = qaFixedStartDate;
        } else {
            qaStartDate = subtractBusinessDays(qaEndDate, qaDays - 1, qaUnavailable);
        }
    } else {
        // endDate 미지정: 기존 순방향 계산 (변경 없음)
        if (qaFixedStartDate != null) {
            qaStartDate = bizDayCalc.ensureBusinessDay(qaFixedStartDate, qaUnavailable);
        } else {
            qaStartDate = bizDayCalc.getNextBusinessDay(devEndDate, qaUnavailable);
        }
        qaEndDate = bizDayCalc.calculateEndDate(qaStartDate, new BigDecimal(qaDays), BigDecimal.ONE, qaUnavailable);
    }
}
```

### 4.4 테스트 시나리오

| # | 시나리오 | 조건 | 기대 결과 |
|---|---------|------|----------|
| TC-1 | 기본 케이스 (요구사항) | startDate=null, endDate=6/11, qaDays=5, devEndDate=5/8 | qaStart=6/4(목), qaEnd=6/10(수) |
| TC-2 | endDate 미지정 (변경 없음) | startDate=null, endDate=null, qaDays=5, devEndDate=5/8 | qaStart=5/11(월), qaEnd=5/15(금) (기존 유지) |
| TC-3 | fixedSchedule (변경 없음) | startDate=4/20, endDate=6/11, qaDays=5 | qaStart=6/4, qaEnd=6/10 (기존 로직) |
| TC-4 | qaFixedStartDate 지정 + endDate 지정 | endDate=6/11, qaFixedStartDate=6/3 | qaStart=6/3 (지정값 사용), qaEnd=6/10 |
| TC-5 | qaDays=null | endDate=6/11, qaDays=null | qaStart=null, qaEnd=null (스킵) |
| TC-6 | 공휴일 경계 | endDate 직전이 공휴일인 경우 | subtractBusinessDays가 공휴일 건너뜀 확인 |

---

## 5. 리스크 및 고려사항

### 5.1 QA 시작일이 devEndDate보다 앞서는 경우

역산 시 QA 시작일이 devEndDate 이전으로 배치될 수 있다.

예시:
- devEndDate: 5/12
- qaEndDate(역산): 6/10
- qaStartDate(역산): 6/4
- → 정상 (qaStartDate > devEndDate)

그러나 론치일이 매우 가깝고 개발 기간이 긴 경우:
- devEndDate: 6/10
- qaEndDate(역산): 6/10 - 1 = 6/9
- qaStartDate(역산): 6/9 - 4 = 6/3
- → qaStartDate(6/3) < devEndDate(6/10)로 QA가 개발 기간과 겹침

이 상황은 fixedSchedule 경로에서도 동일하게 발생하며, 기존에도 별도 검증/경고 없이 그대로 표시한다. 이번 범위에서는 동일하게 처리(검증 없음)하고 별도 이슈로 추적한다.

### 5.2 기존 fixedSchedule과의 코드 중복

fixedSchedule 분기(line 701~708)와 새로 추가하는 non-fixedSchedule + endDate 분기의 역산 코드가 동일한 패턴이 된다. 현재는 중복을 허용하고, 추후 별도 private 메서드로 추출 가능하다.

---

## 6. 참고 사항

### 6.1 관련 코드 경로

| 파일 | 위치 | 설명 |
|------|------|------|
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | line 688~808 | `computeTimeline()` 전체 |
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | line 701~708 | fixedSchedule QA 역산 (참고용) |
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | line 788~795 | non-fixedSchedule QA 순방향 (변경 대상) |
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | line 860~868 | `subtractBusinessDays()` 헬퍼 |
| `docs/schedule-calculation-policy.md` | 섹션 3.6 | QA 기간 계산 정책 |
| `docs/schedule-calculation-summary.md` | 섹션 4.4 | QA 기간 계산 종합 정리 |

### 6.2 정책 문서 섹션 3.6 현재 내용 (변경 필요)

```
### 3.6 QA 기간 계산

IF fixedSchedule:
    qaEndDate = launchDate - 1영업일
    qaStartDate = qaFixedStartDate ?? (qaEndDate - (qaDays-1)영업일)
ELSE:
    qaStartDate = qaFixedStartDate ?? getNextBusinessDay(devEndDate)
    qaEndDate = calculateEndDate(qaStartDate, qaDays)
```

변경 후 정책:
```
### 3.6 QA 기간 계산

IF project.endDate != null (fixedSchedule 또는 endDate만 지정):
    qaEndDate = launchDate - 1영업일
    qaStartDate = qaFixedStartDate ?? (qaEndDate - (qaDays-1)영업일)
ELSE (endDate 미지정):
    qaStartDate = qaFixedStartDate ?? getNextBusinessDay(devEndDate)
    qaEndDate = calculateEndDate(qaStartDate, qaDays)
```
