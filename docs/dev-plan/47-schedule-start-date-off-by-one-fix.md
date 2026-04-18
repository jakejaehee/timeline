# 개발 계획서: 프로젝트 시작일 off-by-one 버그 수정

## 1. 개요

- **기능 설명**: 일정 계산(`calculateSchedule()`)에서 멤버의 busy period 종료일이 잘못 설정되어 프로젝트 시작일이 1 영업일 늦게 산정되는 버그 수정
- **개발 배경**: '유즈드 매입' 프로젝트에서 송재호는 앞 프로젝트가 없는데도 +2일에 시작되고, 권동희는 론치일(5/18 월) 다음날인 5/19(화)가 아닌 5/20(수)에 시작되며, 이재훈은 아예 투입되지 않는 현상이 발견됨
- **작성일**: 2026-04-19

---

## 2. 버그 원인 분석

### 2.1 코드 위치

`ScheduleCalculationService.java`, `calculateSchedule()` 메서드, line 88~101:

```java
// 이 프로젝트의 기간을 참여 멤버의 바쁜 기간에 추가
String startStr = (String) result.get("startDate");
String launchStr = (String) result.get("launchDate");
if (startStr != null && launchStr != null) {
    LocalDate projStart = LocalDate.parse(startStr);
    LocalDate projLaunchNextDay = bizDayCalc.getNextBusinessDay(LocalDate.parse(launchStr), holidays);  // <-- 핵심 버그
    @SuppressWarnings("unchecked")
    List<Long> allBeMemberIds = (List<Long>) result.get("_beMemberIds");
    if (allBeMemberIds != null) {
        for (Long mid : allBeMemberIds) {
            memberBusyPeriods.computeIfAbsent(mid, k -> new ArrayList<>())
                    .add(new LocalDate[]{projStart, projLaunchNextDay});  // period[1] = 론치일+1
        }
    }
}
```

**`period[1]`(busy period 종료일)에 `getNextBusinessDay(launchDate)`를 사용하고 있다.**

즉, 론치일이 5/18(월)이면 `period[1] = 5/19(화)`로 저장된다.

### 2.2 getMemberAvailableFrom()의 반환값 해석

`getMemberAvailableFrom()` (line 568~586):

```java
private LocalDate getMemberAvailableFrom(Long memberId, LocalDate projStart, LocalDate projEstimatedEnd,
                                           Map<Long, List<LocalDate[]>> memberBusyPeriods) {
    ...
    // latestEnd가 projStart 이전이거나 같으면 즉시 가용
    if (latestEnd != null && !latestEnd.isAfter(projStart)) {  // latestEnd <= projStart
        return null;
    }
    return latestEnd;  // <-- latestEnd = period[1] = 론치일+1(exclusive) = 5/19
}
```

`latestEnd`는 곧 `period[1]`이고, 그 값 자체를 **가용 시작일(availableFrom)**로 반환한다.

`!latestEnd.isAfter(projStart)` 조건(즉, `latestEnd <= projStart`)은 "busy period가 이미 종료된 경우 즉시 가용" 처리인데, 현재 `period[1]`은 exclusive end이므로 `period[1] == projStart`는 "busy가 projStart 직전 날까지"를 의미하여 즉시 가용이 올바르다. 수정 후 `period[1]`이 inclusive로 바뀌면 이 조건을 `latestEnd.isBefore(projStart)` (`latestEnd < projStart`)로 변경해야 `latestEnd == projStart`(론치일 = 다음 프로젝트 시작일) 케이스를 즉시가용으로 처리하지 않고 올바르게 다음 영업일을 반환한다.

### 2.3 프로젝트 startDate 결정 로직에서의 영향

**자동 할당 경로** (line 226~232): 자동 배정된 멤버의 `lateJoinDates`에 `getMemberAvailableFrom()`의 반환값이 저장됨.

**명시적 할당 경로** (line 238~269): `isMemberBusy()`와 `getMemberAvailableFrom()`으로 멤버를 분류하고, `lateJoinDates`에 가용 시작일이 저장됨.

**`startDate` 결정** (line 366~394, `fixedSchedule == false` 경우):

```java
LocalDate earliestMemberStart = beMembers.stream()
        .map(Member::getQueueStartDate)   // <-- Member.queueStartDate 사용
        .filter(Objects::nonNull)
        .min(LocalDate::compareTo)
        .orElse(null);
```

이 경로에서는 `Member.queueStartDate`를 사용하는데, `queueStartDate`는 **관리자가 수동으로 설정하는 날짜**이다. 자동 배정 시에는 `lateJoinDates`가 `availableFrom`으로 사용되지만, `startDate` 자체는 `queueStartDate`에서 읽어온다.

그런데 `lateJoinDates.get(m.getId())`가 `period[1]` = 론치일+1 = 5/19를 반환하고, 이 값이 **UI 표시용 `availableFrom`**이자 **실질적 계산 기준**이 된다.

### 2.4 off-by-one이 발생하는 정확한 경로

| 단계 | 현재 (버그) | 올바른 동작 |
|------|------------|------------|
| 론치일 | 5/18(월) | 5/18(월) |
| `period[1]` 저장 | `getNextBusinessDay(5/18)` = **5/19(화)** | **5/18(월)**이어야 함 (론치일 자체) |
| `getMemberAvailableFrom()` 반환 | **5/19** | **5/19** (론치일 당일이 아닌, 그 다음날부터 가용이므로 올바름) |
| 실제 가용 시작일 | 5/19 반환 후, 호출부에서 추가 변환 없이 그대로 사용 | 동일 |

**결론**: `period[1]`을 `론치일+1 영업일`로 저장하고 있고, `getMemberAvailableFrom()`이 `period[1]` 자체를 "가용 시작일"로 반환하므로, **가용 시작일이 론치일+2 영업일**이 된다.

올바른 의미론:
- `period` = `[startDate, endDate]`에서 **endDate가 exclusive**라면, `getMemberAvailableFrom()`은 `period[1]` 자체를 가용 시작일로 반환하는 현재 코드가 맞다. 단, `period[1]`을 `론치일+1`(exclusive end)로 저장하면 가용 시작일 = 론치일+1이 되어 올바르다. 실제로는 `getNextBusinessDay`를 추가 적용하여 론치일+2가 되므로, 이 해석에서도 버그가 존재한다.
- `period` = `[startDate, endDate]`에서 **endDate가 inclusive**라면, `getMemberAvailableFrom()`은 `period[1]`의 다음 영업일을 반환해야 한다. 본 계획서는 이 방법(방법 B)을 채택한다.

### 2.5 이재훈 미투입 문제 분석

24 MD는 16~30 구간이므로 `getTargetMemberCount(24)`가 3명을 요구한다. off-by-one으로 인해 이재훈(무진장 론치 5/8)의 `availableFrom`이 5/10으로 계산되어야 하는데 5/12(수)가 되고, 이로 인해:

1. `filterAvailableMembers()`의 `isMemberBusy()` 판단에서 프로젝트 예상 종료일보다 이재훈의 busy end(5/9, 즉 5/8+next)가 더 이른 경우 가용으로 판단되어야 하는데, 계산 오류로 달라질 수 있음
2. 또는 `lateJoin` 후 `lateJoin > devEndDate` 조건 (line 431)으로 제외될 수 있음

정확한 원인은 수정 전 로그를 통해 확인 필요.

---

## 3. 수정 방향 분석

### 3.1 방법 A: period[1]을 론치일 자체로 저장 (endDate inclusive)

```java
// 변경 전
LocalDate projLaunchNextDay = bizDayCalc.getNextBusinessDay(LocalDate.parse(launchStr), holidays);
memberBusyPeriods...add(new LocalDate[]{projStart, projLaunchNextDay});

// 변경 후
LocalDate projLaunch = LocalDate.parse(launchStr);
memberBusyPeriods...add(new LocalDate[]{projStart, projLaunch});
```

이 경우, `getMemberAvailableFrom()`이 `period[1]`을 반환하므로 "가용 시작일 = 론치일"이 된다. 즉 **론치 당일부터 가용**이 된다는 의미가 되어 실제로 원하는 것보다 1일 빠르다(론치 당일은 바쁘므로, 론치 다음 영업일부터 가용해야 함).

따라서 `getMemberAvailableFrom()`의 반환값을 사용하는 곳에서 **다음 영업일로 변환**하는 처리가 필요하게 된다.

### 3.2 방법 B: getMemberAvailableFrom()이 period[1]의 다음 영업일을 반환 (현재 구조 유지)

현재 `period[1]`의 의미를 "busy period exclusive end"로 고정하되, `getMemberAvailableFrom()`에서 반환값을 명확히 "가용 시작일"로 보장:

```java
// 변경 전 (period[1] = 론치일+1, 반환값 = period[1])
return latestEnd;  // 론치일+1 자체를 반환 → 가용시작일 = 론치일+1

// 변경 후 (period[1] = 론치일, 반환값 = period[1]+1)
return bizDayCalc.getNextBusinessDay(latestEnd, holidays);  // 론치일의 다음영업일
// + busy period 저장 시 period[1] = 론치일 (getNextBusinessDay 제거)
```

이렇게 하면 `period[1]` = 론치일(5/18), 반환값 = 5/19(화)로 가용 시작일이 정확해진다.

### 3.3 방법 C: getMemberAvailableFrom()은 그대로 두고, period[1]만 론치일로 수정

- `period[1]` = 론치일(5/18)로 저장
- `getMemberAvailableFrom()`은 `period[1]`을 반환 → 반환값 = 5/18
- 호출부에서 getNextBusinessDay()를 적용 → 실제 가용일 = 5/19

이렇게 하면 `isMemberBusy()`의 overlap 판단도 함께 변경되어야 한다:

```java
// isMemberBusy의 겹침 판단 (현재)
boolean overlaps = projStart.isBefore(period[1]) && !projEstimatedEnd.isBefore(period[0]);
// period[1]이 exclusive이므로 projStart < period[1]이면 겹침
```

만약 `period[1]`이 inclusive로 바뀌면 겹침 판단도 `projStart <= period[1]`로 변경해야 한다.

### 3.4 권장 수정 방법: 방법 B (최소 변경, 의미론 명확화)

**가장 안전한 수정**: busy period 저장 시 `getNextBusinessDay()` 제거, `getMemberAvailableFrom()`에서 반환 시 `getNextBusinessDay()` 적용.

변경 요약:
1. **`calculateSchedule()` (line 93)**: `projLaunchNextDay`를 `projLaunch`로 변경하여 론치일 자체를 `period[1]`로 저장
2. **`isMemberBusy()` (line 554)**: `period[1]`이 inclusive가 되므로 겹침 판단을 `!projStart.isAfter(period[1])`로 변경 (두 번째 `!period[1].isBefore(projEstimatedEnd)` 조건은 변경 불필요)
3. **`getMemberAvailableFrom()` (line 574, 582, 585)**: (a) 겹침 판단을 `!projStart.isAfter(period[1])`로 변경, (b) 즉시가용 판단을 `latestEnd.isBefore(projStart)`(`<` 기준)으로 변경, (c) `return latestEnd`를 `return bizDayCalc.getNextBusinessDay(latestEnd, holidays)`로 변경

단, 방법 B는 `getMemberAvailableFrom()`에 `holidays`를 전달받아야 한다는 시그니처 변경이 필요하다.

---

## 4. 시스템 설계

### 4.1 변경 대상

`ScheduleCalculationService.java` 한 파일만 수정.

### 4.2 수정 상세 설계

#### 수정 1: calculateSchedule() — busy period 저장 시 종료일을 론치일로 변경

**위치**: line 88~102

```java
// 변경 전
LocalDate projLaunchNextDay = bizDayCalc.getNextBusinessDay(LocalDate.parse(launchStr), holidays);
...
.add(new LocalDate[]{projStart, projLaunchNextDay});

// 변경 후
LocalDate projLaunch = LocalDate.parse(launchStr);
...
.add(new LocalDate[]{projStart, projLaunch});
```

이제 `period[1]` = 론치일 (inclusive).

#### 수정 2: isMemberBusy() — period[1]이 inclusive로 바뀌었으므로 겹침 판단 수정

**위치**: line 548~561

```java
// 변경 전: period[1]이 exclusive → projStart < period[1]이면 겹침
boolean overlaps = projStart.isBefore(period[1]) && !projEstimatedEnd.isBefore(period[0]);
if (overlaps && !period[1].isBefore(projEstimatedEnd)) {
    return true;
}

// 변경 후: period[1]이 inclusive → projStart <= period[1]이면 겹침
boolean overlaps = !projStart.isAfter(period[1]) && !projEstimatedEnd.isBefore(period[0]);
if (overlaps && !period[1].isBefore(projEstimatedEnd)) {
    // 두 번째 조건 !period[1].isBefore(projEstimatedEnd) 은 period[1] >= projEstimatedEnd를 의미.
    // period[1]이 inclusive 론치일로 바뀌어도 이 조건의 의미(론치일이 예상 종료일 이상이면 투입불가)는 그대로 유효하여 변경 불필요.
    return true;
}
```

#### 수정 3: getMemberAvailableFrom() — 겹침 판단 수정 + 반환값을 다음 영업일로

**위치**: line 568~586

```java
// 변경 전 겹침 판단: period[1] exclusive
boolean overlaps = projStart.isBefore(period[1]) && !projEstimatedEnd.isBefore(period[0]);

// 변경 후 겹침 판단: period[1] inclusive
boolean overlaps = !projStart.isAfter(period[1]) && !projEstimatedEnd.isBefore(period[0]);

// 변경 전 즉시가용 판단: latestEnd <= projStart 이면 null 반환
if (latestEnd != null && !latestEnd.isAfter(projStart)) {
    return null;
}
// 변경 후: period[1] = 론치일(inclusive)이면 latestEnd == projStart인 경우(론치일 = 다음 프로젝트 시작일)에도
// 론치 당일은 바쁘므로 다음 영업일을 반환해야 한다. 조건을 latestEnd < projStart로 변경.
if (latestEnd != null && latestEnd.isBefore(projStart)) {
    return null;
}

// 변경 전 반환값
return latestEnd;  // period[1] 자체 = 론치일 (inclusive) → 이를 가용시작일로 쓰면 론치 당일 = 가용 (오류)

// 변경 후 반환값: 론치일의 다음 영업일
return bizDayCalc.getNextBusinessDay(latestEnd, holidays);
```

`getMemberAvailableFrom()`의 시그니처에 `Set<LocalDate> holidays`를 추가해야 함.

#### 수정 4: getMemberAvailableFrom() 호출부 시그니처 업데이트

`getMemberAvailableFrom()`를 호출하는 곳 2곳에 `holidays` 인수 추가:

- **자동 할당 경로** (line 227~231):
  ```java
  LocalDate availableFrom = getMemberAvailableFrom(m.getId(), projStartEstimate, filterEndDate, memberBusyPeriods, holidays);
  ```
- **명시적 할당 경로** (line 263):
  ```java
  LocalDate availableFrom = getMemberAvailableFrom(m.getId(), projStartForFilter, projEstimatedEnd, memberBusyPeriods, holidays);
  ```

### 4.3 수정 후 동작 검증 (시나리오 추적)

#### 시나리오 1: 앞 프로젝트 없는 송재호

- `memberBusyPeriods`에 항목 없음 → `getMemberAvailableFrom()` null 반환
- `lateJoinDates`에 기록 없음
- `Member.queueStartDate`가 설정된 날짜(또는 null이면 today)로 startDate 결정
- **결과**: 바로 시작 가능, +2일 지연 없음

#### 시나리오 2: 앞 프로젝트 론치 5/18(월) 권동희

- 수정 전: `period[1] = 5/19(화)`, `getMemberAvailableFrom()` → 5/19 반환, 가용일 = 5/19
  - 그런데 이것이 왜 5/20이 되었는가? → `projLaunchNextDay = getNextBusinessDay(5/18) = 5/19`이고 `getMemberAvailableFrom()`이 `period[1]=5/19`를 그대로 반환하므로 가용일 = 5/19이어야 함
  - 증상에서 5/20이라고 했으므로, 추가적인 `getNextBusinessDay()` 적용이 어딘가에 있을 수 있음 → **코드 재검토 필요**
- 수정 후: `period[1] = 5/18(월)`, `getMemberAvailableFrom()` → `getNextBusinessDay(5/18)` = 5/19(화) 반환
- **결과**: 권동희 가용일 = 5/19(화) ✓

#### 시나리오 3: 이재훈 (무진장 론치 5/8 이후 가용)

- 수정 전: `period[1] = getNextBusinessDay(5/8) = 5/9(금)`, `getMemberAvailableFrom()` → 5/9 반환
  - 유즈드 매입 프로젝트 시작일 추정이 5/9 혹은 그 이후라면, `isMemberBusy()`의 overlaps 판단에서 `!period[1].isBefore(projEstimatedEnd)` 조건 때문에 투입불가로 분류될 수 있음
  - 또는 `lateJoin > devEndDate`로 제외될 수 있음
- 수정 후: `period[1] = 5/8(목)`, `getMemberAvailableFrom()` → `getNextBusinessDay(5/8)` = 5/9(금) 반환
  - `isMemberBusy()` 겹침 판단에서 `period[1]=5/8`이 `projEstimatedEnd` 이전이면 지연합류 가용으로 분류
  - `lateJoinDates[이재훈] = 5/9`
- **결과**: 이재훈이 가용 멤버로 인식되어 투입 가능

### 4.4 추가 검토 필요 사항

증상에서 "송재호가 론치 +2일에 시작"된다고 했는데, 앞 프로젝트가 없는 경우라면 `memberBusyPeriods`에 항목이 없어야 한다. 그렇다면 다른 원인이 있을 수 있다:

**가설 A**: `Member.queueStartDate`가 어떤 이전 실행에서 잘못된 날짜로 설정되어 있는 경우

**가설 B**: `filterAvailableMembers()`의 `projStartEstimate` 계산이 잘못되어, 멤버가 available로 분류되지 않고, beMembers가 비어서 `earliestMemberStart == null` 경로로 빠지는 경우. 이 경우 `getSquadMemberPool()`의 멤버들의 `latestBusyEnd`에서 `getNextBusinessDay()`가 한 번 더 적용되어 +2일이 될 수 있다.

**→ 수정 전 로그 추가**가 필요함.

---

## 5. 구현 계획

### 5.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | 로그 추가 및 재현 확인 | 수정 전 각 멤버별 `period`, `getMemberAvailableFrom()` 반환값, `startDate` 결정 과정에 로그 추가하여 증상 재현 | 낮음 | - |
| T2 | calculateSchedule() busy period 저장 수정 | line 93의 `getNextBusinessDay(launchDate)` → `launchDate` 직접 사용으로 변경 | 낮음 | T1 |
| T3 | isMemberBusy() 겹침 판단 수정 | `period[1]` inclusive 기준으로 겹침 조건 수정 | 낮음 | T2 |
| T4 | getMemberAvailableFrom() 수정 | 겹침 판단 수정 + 즉시가용 판단을 `latestEnd < projStart`로 변경 + 반환값에 getNextBusinessDay() 적용, 시그니처에 holidays 추가 | 낮음 | T3 |
| T5 | 호출부 시그니처 업데이트 | getMemberAvailableFrom() 호출 2곳에 holidays 인수 추가 | 낮음 | T4 |
| T6 | 검증 | 유즈드 매입 시나리오 및 다른 프로젝트로 회귀 테스트 | 낮음 | T5 |

### 5.2 구현 순서

1. **T1**: 로그 추가하여 정확한 재현 확인 (선택사항, 증상이 명확하다면 건너뜀)
2. **T2**: `calculateSchedule()` busy period 종료일 수정
3. **T3 + T4 + T5**: `isMemberBusy()`, `getMemberAvailableFrom()` 동시 수정 (같은 메서드 내부)
4. **T6**: 검증

### 5.3 테스트 계획

**수동 테스트 시나리오**:

1. **송재호 (앞 프로젝트 없음)**: 유즈드 매입에서 startDate = 바로 시작 가능한 날짜 (queueStartDate 또는 today)
2. **권동희 (앞 프로젝트 론치 5/18 월)**: 유즈드 매입 startDate ≥ 5/19(화)
3. **이재훈 (무진장 론치 5/8 목)**: 유즈드 매입에 투입, availableFrom = 5/9(금)
4. **회귀**: 다른 프로젝트들의 startDate, launchDate, beMembers가 기존과 1일 이내로 변동하는지 확인

---

## 6. 리스크 및 고려사항

### 6.1 겹침 판단 변경의 부작용

`isMemberBusy()`의 겹침 판단을 `isBefore(period[1])` → `!isAfter(period[1])`로 변경하면, `projStart == period[1]`(론치 당일 = 다음 프로젝트 시작일)인 경우 "겹침"으로 판단하게 된다. 이는 론치 당일에 바로 다음 프로젝트를 시작하는 경우를 방지하므로 **올바른 동작**이다.

**filterAvailableMembers() 부수 효과**: `filterAvailableMembers()`는 `isMemberBusy()`를 내부적으로 호출한다. 겹침 판단 변경이 `isMemberBusy()`에 적용되면 `filterAvailableMembers()`에도 동일하게 적용되어 자동 할당 가용 멤버 필터링에도 영향이 간다. `period[1]`이 exclusive에서 inclusive로 바뀌고 겹침 판단이 `<`에서 `<=`로 바뀌므로, 기존에는 가용으로 분류되었던 경우(앞 프로젝트 론치일 == 다음 프로젝트 시작일)가 이제 busy(투입불가)로 분류될 수 있다. 이는 론치 당일 바로 다음 프로젝트 투입을 막는 의도적인 방향이므로 올바르다.

**명시적 할당 경로(autoAssigned=false) 영향**: 명시적 할당 경로(line 238~269)에서도 `isMemberBusy()`와 `getMemberAvailableFrom()`을 호출한다. 동일하게 수정이 적용되므로 명시적 할당 멤버도 off-by-one 버그가 수정된다. 단, 명시적 할당에서는 `getMemberAvailableFrom()`이 null을 반환하지 않으면 해당 멤버가 `filteredBe`(가용)에 포함되고 `lateJoinDates`에 기록된다. 기존 `latestEnd <= projStart` → `null` 반환 경계가 `latestEnd < projStart`로 바뀌면서, 앞 프로젝트 론치일이 다음 프로젝트 시작일과 동일한 경우 이전에는 즉시가용(null)으로 처리되었다가 이제 lateJoin으로 기록되는 차이가 생긴다. 이 또한 론치 당일 투입을 막는 올바른 동작이다.

### 6.2 기존 busy period 데이터 없음 (stateless)

`memberBusyPeriods`는 `calculateSchedule()` 호출 시마다 새로 구성되므로, 저장된 데이터 마이그레이션 불필요.

### 6.3 멀티 busy period 케이스

한 멤버가 여러 프로젝트에 연속 투입된 경우, `getMemberAvailableFrom()`은 겹치는 모든 period 중 최대 `latestEnd`를 사용한다. 이 로직은 변경되지 않으므로 문제없음.

### 6.4 송재호 +2일 증상의 추가 원인 가능성

분석에서 설명한 가설 B(beMembers가 비어서 `latestBusyEnd + getNextBusinessDay()` 경로)가 실제 원인일 수 있다. T1(로그 추가)에서 확인 후, 해당 경로도 함께 수정할 필요가 있을 수 있다:

```java
// line 387~388 (beMembers == [] 경로)
startDate = latestBusyEnd != null
        ? bizDayCalc.getNextBusinessDay(latestBusyEnd, holidays)  // latestBusyEnd = 론치일이면 +1은 올바름
        : LocalDate.now();
```

이 경로에서 `latestBusyEnd`는 `period[1]`이다. 현재 코드에서 `period[1] = 론치일+1`이므로 `getNextBusinessDay(론치일+1)` = 론치일+2가 된다. 수정 후 `period[1] = 론치일`이 되면 `getNextBusinessDay(론치일)` = 론치일+1이 되어 올바른 결과가 나온다. **즉, T2 수정만으로 이 경로도 자동으로 수정된다.**

---

## 7. 참고 사항

### 관련 코드 경로

- `src/main/java/com/timeline/service/ScheduleCalculationService.java`
  - `calculateSchedule()`: line 88~102 (busy period 저장)
  - `isMemberBusy()`: line 548~561 (겹침 판단)
  - `getMemberAvailableFrom()`: line 568~586 (가용 시작일 반환)
  - startDate 결정 (free schedule): line 366~394
- `src/main/java/com/timeline/service/BusinessDayCalculator.java`
  - `getNextBusinessDay()`: line 115~126

### period[] 배열 의미론 정리

| 필드 | 현재(버그) | 수정 후 |
|------|-----------|---------|
| `period[0]` | 프로젝트 startDate (inclusive) | 동일 |
| `period[1]` | 론치일+1 영업일 (exclusive) | 론치일 (inclusive) |
| `isMemberBusy()` 겹침 | `projStart < period[1]` | `projStart <= period[1]` |
| `getMemberAvailableFrom()` 즉시가용 판단 | `latestEnd <= projStart` → null | `latestEnd < projStart` → null |
| `getMemberAvailableFrom()` 반환 | `period[1]` 자체 | `getNextBusinessDay(period[1])` |
| 실제 가용 시작일 | 론치일+2 영업일 | 론치일+1 영업일 (올바름) |
