# 개발 계획서: 0 MD 프로젝트 처리 및 자동 투입 후 memberBusyPeriods 미갱신 수정

## 1. 개요

- **기능 설명**: 일정 계산(`calculateSchedule`) 로직의 두 가지 버그를 수정한다.
  1. totalMd가 0인 프로젝트에서 종료일·론치일이 잘못 계산되고, 자동 투입 멤버가 배정되는 문제
  2. 프로젝트 A에서 자동 투입된 멤버의 busy period가 프로젝트 B 계산 시 반영되지 않는 문제
- **개발 배경**: 실제 서비스 운영 중 0 MD 프로젝트(공수 산정 미완료)에서 의미없는 론치일이 표시되고, 자동 투입 멤버가 다음 프로젝트에 중복 배정되어 일정 충돌이 발생함
- **작성일**: 2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: totalMd = 0인 프로젝트는 자동 투입 멤버를 0명으로 배정하고, autoAssigned 경로에 진입하지 않는다.
- **FR-002**: totalMd = 0인 프로젝트의 론치일(`launchDate`)은 null로 반환한다. (계산 불가)
- **FR-003**: totalMd = 0인 프로젝트의 `devEndDate`는 시작일(`startDate`)과 동일하게 설정한다. (종료일 미표시)
- **FR-004**: totalMd = 0인 프로젝트에는 "BE N명 추가 투입 필요" 경고를 생성하지 않는다.
- **FR-005**: totalMd = 0이어도 수동 지정 멤버(`explicitBeMembers`)는 그대로 표시한다.
- **FR-006**: `calculateSchedule()` 루프에서 프로젝트 A의 자동 투입 결과를 `memberBusyPeriods`에 반영한 후 프로젝트 B를 계산한다.
- **FR-007**: busy period 갱신 시점은 `calculateSingleProject()` 반환 직후, 다음 프로젝트 계산 전이어야 한다.
- **FR-008**: UI에서 론치일이 null인 경우 해당 셀을 비워두거나 "-"로 표시한다.
- **FR-009**: UI에서 개발 기간 컬럼은 `시작일~` 형태만 표시한다(종료일 생략). devDays는 0으로 표시하거나 생략한다.

### 2.2 비기능 요구사항

- **NFR-001**: 기존 totalMd > 0 프로젝트의 계산 로직은 변경하지 않는다.
- **NFR-002**: 0 MD 판정은 `totalMd.compareTo(BigDecimal.ZERO) == 0` 조건으로 명확히 처리한다.
- **NFR-003**: busy period 갱신 로직은 기존 `calculateSchedule()` 루프 내 `_beMemberIds` 처리 코드를 수정 또는 보완한다.

### 2.3 가정 사항

- totalMd가 0이면 "공수 산정이 아직 안 된 상태"로 간주한다. 0 MD는 유효한 비즈니스 상태다.
- 자동 투입 경로(`autoAssigned = true`)에서 totalMd = 0이면 멤버 선택을 전혀 하지 않아도 된다.
- `launchDate`가 null이면 `calculateSchedule()` 루프에서 해당 프로젝트의 busy period를 추가할 수 없으므로, 0 MD 프로젝트는 다음 프로젝트의 가용 판단에 영향을 주지 않는다.
- 기존 버그(#43)에서 `estimateProjectStart()`에 today 보정이 추가되었으나, "자동 투입 결과를 memberBusyPeriods에 반영"하는 코드 자체가 없었다. 이번에 추가한다.

### 2.4 제외 범위 (Out of Scope)

- totalMd = 0 프로젝트의 QA 마일스톤 처리 변경 (QA는 별도 엔티티, 이번 수정 대상 아님)
- 0 MD 상태를 UI에서 별도 배지/색상으로 강조하는 시각화 개선
- `totalMd = 0`인 경우 전체 일정 요약 바("전체 일정: ... ~ ...") 처리 변경

---

## 3. 시스템 설계

### 3.1 버그 원인 상세 분석

#### 버그 1: 0 MD 프로젝트 처리

**현재 흐름 (문제 있는 코드)**:

```
calculateTotalMd() → totalMd = 0

[경로 A: 기간 미지정 + 자동 투입]
autoAssigned 경로 진입
  └─ getTargetMemberCount(0) → int md = 0, md <= 5 → return 1  ← 1명 반환!
  └─ filterAvailableMembers() → 가용 멤버가 있으면 최대 1명 선택
  └─ beMembers에 1명 배정됨
  └─ autoAssignedMembers에 해당 멤버 추가

beCapacity > 0이지만 totalMd = 0이므로:
  └─ line 300 조건: if (totalMd > 0 && beCapacity > 0) → 진입하지 않음 → devDays = 0
  └─ devEndDate = devCalcStart (오늘 또는 시작일)

launchDate 계산 (기간 미지정, QA 없음):
  └─ launchDate = getNextBusinessDay(devEndDate) → 다음 영업일 (의미없는 날짜!)

[경로 B: 기간 지정 + 자동 투입]
autoAssigned 경로 진입
  └─ hasDates = true 분기
  └─ devBizDays > 0이지만 totalMd = 0이므로:
     line 165 조건: if (devBizDays > 0 && totalMd > 0) → 진입하지 않음
  └─ else 분기: beMembers = availableMembers 전체 배정됨  ← 기간 지정 0 MD에서도 멤버 배정 버그!
  └─ launchDate = project.getEndDate() (기간 지정이므로 명시된 날짜 → 이 경우는 표시 유지)
```

**문제점 요약**:
- `getTargetMemberCount(0)`이 1을 반환 (md <= 5 → 1) → 기간 미지정 경로에서 멤버 1명 자동 배정됨
- 기간 지정(hasDates=true) 0 MD에서는 `selectByCapacity` 분기로 진입하지 않고 else 분기로 빠져 `beMembers = availableMembers` 전체가 배정됨
- devDays = 0이어도 기간 미지정 경로에서 launchDate가 devEndDate의 다음 영업일로 설정됨 → 의미없는 날짜 표시
- "BE N명 추가 투입 필요" 경고도 발생 가능 (기간 지정 프로젝트의 경우: line 179 조건 `totalMd > 0`이 이미 있어 자동 방어되나, 멤버 배정 자체가 잘못됨)

**수정 방향**:
- `calculateSingleProject()` 초입부 또는 autoAssigned 분기 진입 전에 `totalMd == 0` 조건으로 조기 처리
- 자동 투입 분기: totalMd = 0이면 멤버 선택 로직 전체를 건너뜀 (beMembers = 빈 리스트)
- launchDate: totalMd = 0이면 null 반환

#### 버그 2: 자동 투입 후 memberBusyPeriods 미갱신

**현재 흐름 (문제 있는 코드)**:

```java
// calculateSchedule() 루프
for (Long projectId : projectIds) {
    Map<String, Object> result = calculateSingleProject(..., memberBusyPeriods, ...);
    results.add(result);

    // 이 프로젝트의 기간을 참여 멤버의 바쁜 기간에 추가
    String startStr = (String) result.get("startDate");
    String launchStr = (String) result.get("launchDate");
    if (startStr != null && launchStr != null) {
        List<Long> allBeMemberIds = (List<Long>) result.get("_beMemberIds");
        if (allBeMemberIds != null) {
            for (Long mid : allBeMemberIds) {
                memberBusyPeriods.computeIfAbsent(mid, k -> new ArrayList<>())
                        .add(new LocalDate[]{projStart, projLaunchNextDay});
            }
        }
    }
}
```

**문제점 분석**:
- `_beMemberIds`는 현재 `beMembers + busyMembers` 전체 ID를 포함 (line 451~454)
- `busyMembers`는 명시적 할당(`!autoAssigned`) 경로에서만 채워짐
- 자동 투입(`autoAssigned = true`) 경로에서는 `busyMembers`가 항상 빈 리스트
- 따라서 `_beMemberIds = autoAssignedMembers의 ID만` 포함됨 → 이 부분은 정상

**실제 문제**:
- `autoAssignedMembers`는 `result.put("autoAssignedMembers", ...)` 로 별도 키에 저장되지만, `_beMemberIds`에는 포함됨 (line 452: `beMembers.forEach(m -> allIds.add(m.getId()))`)
- 즉 자동 투입된 멤버 ID는 `_beMemberIds`에 포함되어 있음
- 그런데 실제로 busy period가 추가되지 않는 이유를 추가 확인:

```java
// line 80-91
if (startStr != null && launchStr != null) {   // ← launchDate가 null이면 건너뜀!
    LocalDate projStart = LocalDate.parse(startStr);
    LocalDate projLaunchNextDay = bizDayCalc.getNextBusinessDay(LocalDate.parse(launchStr), holidays);
    ...
}
```

- 0 MD 프로젝트의 경우 현재는 launchDate가 null이 아니어서(버그 1로 인해 잘못된 날짜가 들어감) busy period는 추가됨
- 그러나 정상 케이스(totalMd > 0)에서도 자동 투입 멤버의 busy period가 제대로 반영되지 않는 실제 케이스가 보고됨

**추가 분석 필요 포인트**:

`calculateSingleProject()` 내 autoAssigned 경로에서 `beMembers`에 자동 투입 멤버를 담고, `_beMemberIds`에 포함시킨다. 이후 루프에서 `launchDate`가 null이 아니면 busy period가 추가된다. 그런데 보고된 증상("황의종이 5/4~5/26에 투입됐는데 다음 프로젝트에서 여전히 5/4부터 가용")은 아래 중 하나일 것이다:

1. **launchDate 파싱 오류**: `launchStr`이 있지만 `projLaunchNextDay`가 projStart보다 이전이거나 동일한 경우 → busy period range가 [A, A] 형태가 되어 `isMemberBusy()`에서 겹침 판정 실패
2. **`isMemberBusy()` 로직 결함**: `period[1]`이 다음 영업일(exclusive end)로 저장되어 있는데, 겹침 판단에서 경계값 처리 오류
3. **`filterAvailableMembers()` 호출 시점**: 다음 프로젝트의 `projStartEstimate`가 현재 프로젝트의 launchDate보다 이전이어서 겹침으로 판정되어야 하는데 안 됨

**정확한 원인 확인**:
- `memberBusyPeriods`에 저장되는 형식: `[projStart, projLaunchNextDay]` (line 88)
  - projStart = 5/4, projLaunchNextDay = getNextBusinessDay(5/26) = 5/27 (exclusive end)
- 다음 프로젝트 B의 `projStartEstimate` = 5/4 (project.getStartDate() 또는 today)
- `filterAvailableMembers()` → `isMemberBusy(황의종.id, 5/4, filterEndDate, memberBusyPeriods)`
- `isMemberBusy()` 내 겹침 판단: `projStart(5/4).isBefore(period[1](5/27)) && !projEstimatedEnd.isBefore(period[0](5/4))`
  - `5/4 < 5/27 = true` ✓
  - `!filterEndDate.isBefore(5/4)` → filterEndDate가 5/4 이후이면 true ✓
  - **따라서 겹침은 감지됨**
- 그런데 `isMemberBusy()`의 추가 조건: `!period[1].isBefore(projEstimatedEnd)` → "바쁜 기간이 프로젝트 예상 종료일 이후까지 이어지면 투입불가"
  - `!5/27.isBefore(filterEndDate)` → filterEndDate가 5/27 이후이면 5/27 >= filterEndDate → false → **투입가능으로 판정!**
  - filterEndDate가 5/4에서 며칠 뒤 (0 MD 기준 1일)인 경우, 5/27 > filterEndDate → `!5/27.isBefore(filterEndDate) = true` → 투입불가 ✓
  - 그런데 프로젝트 B도 기간 미지정이면: `autoEstDevDays = max(ceil(totalMd), 1)`, 만약 totalMd가 작으면 filterEndDate가 짧아 5/27 이후일 수 있음

**실제 결함 위치 특정**:

`calculateSchedule()` 루프에서 busy period 추가 코드는 존재한다(line 77-91). 그러나 사용자가 직접 디버깅한 결과 "핵심인 자동 투입 결과를 memberBusyPeriods에 반영하는 코드가 없음"이라고 명시했다. 코드를 보면 있는 것처럼 보이지만, 실제로 동작하지 않는 경우는 다음 시나리오다:

- **자동 투입 경로에서 `_beMemberIds`에 멤버 ID가 포함되지 않는 케이스**: `beMembers`가 비어있으면 `allIds`도 비어있고 busy period 추가 안 됨
- **0 MD 프로젝트에서**: 현재는 자동 투입 멤버 1명이 배정되므로 `_beMemberIds`에 포함됨 → busy period 추가됨 → 다음 프로젝트에서 반영됨 (이 경로는 정상)
- **0 MD가 아닌데 자동 투입이 0명인 경우**: `squadMemberPool`이 비어있거나 `availableMembers`가 0명 → `beMembers = []` → `_beMemberIds = []` → busy period 추가 없음 → **정상 동작** (추가할 멤버가 없으니까)

**결론**: 버그 2의 실제 원인은 `isMemberBusy()`의 조건 로직이 아닌, **0 MD 자동 투입으로 배정된 멤버의 busy period가 올바르지 않은 기간으로 저장**되는 것이다. 버그 1 수정(0 MD → launchDate = null)이 완료되면 busy period 추가 코드(`if (startStr != null && launchStr != null)`)의 `launchStr != null` 조건에 걸려 아무것도 추가되지 않으므로 버그 2도 자연스럽게 해결된다.

그러나 totalMd > 0인 정상 프로젝트에서도 자동 투입 결과가 다음 프로젝트에 반영되지 않는 경우가 있을 수 있다. 이는 `getTargetMemberCount()` 기반 선택에서 `selectCount = 0`이 되는 경우 (availableMembers가 0명)이며, 이때는 실제로 busy period에 추가할 멤버가 없으니 정상이다.

**최종 버그 2 원인**: 자동 투입 경로에서 `filterAvailableMembers()`가 이전 프로젝트의 busy period를 제대로 반영하지 못하는 케이스는, `estimateProjectStart()`가 today를 반환할 때 filterEndDate가 너무 짧게 계산되어 `isMemberBusy()`의 두 번째 조건(`!period[1].isBefore(projEstimatedEnd)`)이 false가 되는 상황이다. 즉 "바쁜 기간이 프로젝트 종료 예상일을 넘어서야 투입불가"로 판정하는 로직이 0 MD 또는 소규모 프로젝트에서는 실패한다.

**정리하면**, 버그 2의 직접 원인:
- filterEndDate가 이전 프로젝트의 busy period 종료일보다 이전인 경우, `isMemberBusy()`가 false를 반환하여 "지연 합류 가용"으로 판정함
- "지연 합류 가용"으로 판정된 멤버는 `filterAvailableMembers()`에서 가용 멤버로 포함됨
- 결과적으로 이미 다른 프로젝트에 투입된 멤버가 재투입됨

### 3.2 API 설계

API 인터페이스 변경 없음. `GET /api/v1/schedule/calculate` 응답 구조 변경사항:

| 필드 | 현재 | 변경 후 |
|------|------|---------|
| `launchDate` | 항상 날짜 문자열 | totalMd=0이면 `null` |
| `devEndDate` | 항상 날짜 문자열 | totalMd=0이면 startDate와 동일 |
| `devDays` | 0 또는 양수 | totalMd=0이면 `0` |
| `beCount` | 자동 투입 시 1 이상 | totalMd=0이면 `0` |
| `autoAssignedMembers` | 자동 투입 시 목록 | totalMd=0이면 빈 배열 |
| `warning` | BE 경고 포함 가능 | totalMd=0이면 BE 경고 없음 |

### 3.3 서비스 계층 변경

**파일**: `src/main/java/com/timeline/service/ScheduleCalculationService.java`

#### 변경 1: `calculateSingleProject()` — 0 MD 조기 처리

**위치**: Step 1 (BE 멤버 결정) 직후, totalMd 계산 직후

**현재 코드 (line 122-223)**:
```java
if (!explicitBeMembers.isEmpty()) {
    beMembers = new ArrayList<>(explicitBeMembers);
} else {
    autoAssigned = true;
    beMembers = new ArrayList<>();
    List<Member> squadMemberPool = getSquadMemberPool(projectId);
    if (!squadMemberPool.isEmpty()) {
        // ... 멤버 선택 로직 전체 ...
    }
}
```

**수정 방향**: autoAssigned 분기(`else` 블록) 내에서 `squadMemberPool.isEmpty()` 체크 조건에 `totalMd > 0`을 추가하여 0 MD일 때 멤버 선택 로직 전체를 건너뜀:

```java
// 현재:
if (!squadMemberPool.isEmpty()) {

// 수정 후:
if (!squadMemberPool.isEmpty() && totalMd.compareTo(BigDecimal.ZERO) > 0) {
```

이 한 줄 변경으로 기간 미지정(경로 A)과 기간 지정(경로 B) 모두에서 0 MD 시 멤버 선택 전체가 건너뛰어진다. 기간 지정 0 MD에서 `beMembers = availableMembers` 전체 배정 버그(경로 B)도 동일하게 해결된다.

#### 변경 2: `calculateSingleProject()` — 0 MD 시 launchDate = null

**위치**: Step 2 (일정 계산 실행) — 기간 미지정(`!fixedSchedule`) 경로의 launchDate 결정 분기

**현재 코드 (line 385-391, `fixedSchedule=false` 분기 내부)**:
```java
if (project.getEndDate() != null) {
    launchDate = project.getEndDate();
} else if (qaEndDate != null) {
    launchDate = bizDayCalc.getNextBusinessDay(qaEndDate, holidays);
} else {
    launchDate = bizDayCalc.getNextBusinessDay(devEndDate, holidays);  // ← 0 MD 시 문제
}
```

**적용 범위**: `fixedSchedule=true` 경로(line 317-354)의 launchDate는 `project.getEndDate()`로 항상 명시된 날짜가 설정되므로 변경 대상이 아니다. 0 MD + 기간 지정 프로젝트는 launchDate를 지정된 종료일로 그대로 표시한다.

**수정 방향**: `fixedSchedule=false` 분기에서, `project.getEndDate() != null` 조건 앞에 0 MD 조건을 추가:
```java
if (totalMd.compareTo(BigDecimal.ZERO) == 0 && project.getEndDate() == null) {
    launchDate = null;  // 기간 미지정 0 MD: 계산 불가
} else if (project.getEndDate() != null) {
    launchDate = project.getEndDate();
} else if (qaEndDate != null) {
    launchDate = bizDayCalc.getNextBusinessDay(qaEndDate, holidays);
} else {
    launchDate = bizDayCalc.getNextBusinessDay(devEndDate, holidays);
}
```

**결과 조립**: `launchDate`가 null일 수 있으므로 기존 line 422를 수정:
```java
// 현재:
result.put("launchDate", launchDate.toString());

// 수정 후:
result.put("launchDate", launchDate != null ? launchDate.toString() : null);
```

#### 변경 3: `calculateSingleProject()` — 0 MD 시 BE 경고 억제

**위치**: hasDates = true 경로의 경고 생성 부분 (line 179-204)

**수정 방향**: 변경 1(`!squadMemberPool.isEmpty() && totalMd > 0`)에서 멤버 선택 블록 자체를 건너뛰면, 경고 생성 코드(line 179-204)에 도달하지 않으므로 자동 해결된다. 추가 변경 불필요.

기간 미지정 + 명시적 할당 경로의 경고(line 261-268)는 `totalMd.compareTo(BigDecimal.ZERO) > 0` 조건이 이미 있어 0 MD 경우 경고가 생성되지 않는다. 추가 변경 불필요.

#### 변경 4: `calculateSchedule()` — busy period 갱신 로직 강화

**현재 코드 (line 77-91)**:
```java
String startStr = (String) result.get("startDate");
String launchStr = (String) result.get("launchDate");
if (startStr != null && launchStr != null) {
    LocalDate projStart = LocalDate.parse(startStr);
    LocalDate projLaunchNextDay = bizDayCalc.getNextBusinessDay(LocalDate.parse(launchStr), holidays);
    List<Long> allBeMemberIds = (List<Long>) result.get("_beMemberIds");
    if (allBeMemberIds != null) {
        for (Long mid : allBeMemberIds) {
            memberBusyPeriods.computeIfAbsent(mid, k -> new ArrayList<>())
                    .add(new LocalDate[]{projStart, projLaunchNextDay});
        }
    }
}
```

**참고**: `_beMemberIds`는 `beMembers + busyMembers`를 포함한다(line 451-454). 그러나 `busyMembers`는 명시적 할당(`autoAssigned=false`) 경로에서만 채워지고, 자동 투입(`autoAssigned=true`) 경로에서는 항상 빈 리스트다(line 226-269: `!autoAssigned` 조건으로 분기). 따라서 자동 투입 경로에서 `_beMemberIds`는 `beMembers`의 ID만 포함하며, 이는 의도한 동작이다.

**수정 방향**: `_beMemberIds` 대신 `_autoAssignedMemberIds`라는 별도 키를 추가하여 자동 투입 멤버만 추적. 단, 실제로는 `_beMemberIds`가 이미 `beMembers + busyMembers`를 포함하므로, 자동 투입 경로에서 `busyMembers`는 항상 빈 리스트임. 따라서 현재 `_beMemberIds`로도 자동 투입 멤버만 포함됨.

**핵심 수정**: `isMemberBusy()` 로직 개선. 현재 로직은 "바쁜 기간이 프로젝트 예상 종료일 이후까지 이어져야만 투입불가"로 판정하는데, 이는 지연 합류를 허용하는 의도이다. 그런데 0 MD 또는 소규모 프로젝트에서 filterEndDate가 짧아 멤버가 가용으로 잘못 판정되는 문제가 있다.

**수정 전략**: filterEndDate를 실제 예상 종료일이 아닌 "busy period 종료일 이후"를 넉넉하게 잡도록 변경. 구체적으로, 자동 투입 가용 판단 시 filterEndDate를 최소 busy period 종료일 이후 N일로 보정.

**또는 더 간단한 대안**: `filterAvailableMembers()` 대신 `getNextAvailableDate()` 방식으로 전환 — 멤버별 가장 빠른 가용 시작일을 계산하여, 해당 날짜가 프로젝트 시작일 이후이면 지연 합류 가용으로 처리.

**최선의 수정안**: 자동 투입 경로에서 filterEndDate 계산 시, 기존 busy period를 고려하여 넉넉하게 설정:

```java
// 현재:
int autoEstDevDays = Math.max((int) Math.ceil(totalMd.doubleValue()), 1);
filterEndDate = bizDayCalc.calculateEndDate(projStartEstimateAdj, new BigDecimal(autoEstDevDays), BigDecimal.ONE, holidays);

// 수정안: totalMd > 5이면 기존 로직 유지, totalMd <= 5 또는 = 0이면 더 넉넉한 기간 사용
// 또는: filterEndDate를 프로젝트 예상 종료일보다 최소 30 영업일 이후로 보정
```

그러나 이 방식은 지연 합류 로직 전체를 바꾸는 부작용이 있다. **가장 안전한 수정**:

`isMemberBusy()` 판단 시, 자동 투입 가용 여부는 "바쁜 기간이 프로젝트 시작일 이후까지 이어지는가"로 단순화:
- 기존: `overlaps && !period[1].isBefore(projEstimatedEnd)` → 전체 기간 커버 시 투입불가
- 수정: 자동 투입 시에는 `period[1].isAfter(projStart)` → 바쁜 기간이 프로젝트 시작일 이후에 끝나면 투입불가 (지연 합류 없음)

그러나 이는 지연 합류 기능 자체를 없애는 것이므로 부적절하다.

**최종 결론**: 버그 2의 근본 수정은 **filterEndDate를 충분히 크게 설정**하는 것이다. 기간 미지정 프로젝트에서 totalMd를 1명 기준으로 계산한 값이 너무 작을 수 있으므로, 최소 filterEndDate를 `max(1명 기준 devDays, 기존 멤버 busy period 종료일 중 최대값 + 1일)` 로 설정한다.

### 3.4 프론트엔드 변경

**파일**: `src/main/resources/static/js/app.js`

**함수**: `renderScheduleCalcResult()` (line 7918)

#### 변경 1: 개발 기간 컬럼 — totalMd=0 시 종료일 생략

**현재 코드 (line 7932-7934)**:
```javascript
var devStartStr = formatDateShort(r.startDate) + (r.autoStartDate ? autoLabel : '');
var devText = devStartStr + '-' + formatDateShort(r.devEndDate) + ' ' + (r.devDays || 0) + 'd';
```

**수정 후**:
```javascript
var devStartStr = formatDateShort(r.startDate) + (r.autoStartDate ? autoLabel : '');
var devText;
if (r.totalMd == null || parseFloat(r.totalMd) === 0) {
    devText = devStartStr + '~';  // 종료일 없음
} else {
    devText = devStartStr + '-' + formatDateShort(r.devEndDate) + ' ' + (r.devDays || 0) + 'd';
}
```

#### 변경 2: 론치일 컬럼 — null 처리

**현재 코드 (line 7941-7942)**:
```javascript
var launchAutoLabel = r.autoLaunchDate ? ' <span ...>자동</span>' : '';
html += '<td><strong>' + formatDateShort(r.launchDate) + '</strong>' + launchAutoLabel + '</td>';
```

**수정 후**:
```javascript
if (r.launchDate) {
    var launchAutoLabel = r.autoLaunchDate ? ' <span ...>자동</span>' : '';
    html += '<td><strong>' + formatDateShort(r.launchDate) + '</strong>' + launchAutoLabel + '</td>';
} else {
    html += '<td class="text-muted">-</td>';
}
```

#### 변경 3: 전체 일정 요약 — launchDate null 프로젝트 제외

**현재 코드 (line 7979-7987)**:
```javascript
var validItems = data.filter(function(r) { return !r.skipped; });
if (validItems.length > 0) {
    var firstStart = validItems[0].startDate;
    var lastLaunch = validItems[validItems.length - 1].launchDate;
    ...
}
```

**수정 후**:
```javascript
var validItems = data.filter(function(r) { return !r.skipped && r.launchDate; });
if (validItems.length > 0) {
    var firstStart = validItems[0].startDate;
    var lastLaunch = validItems[validItems.length - 1].launchDate;
    ...
}
```

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | [BE] 0 MD 자동 투입 억제 | `calculateSingleProject()` autoAssigned 분기에 `totalMd == 0` 조건 추가, 멤버 선택 건너뜀 | 낮음 | 없음 |
| T-02 | [BE] 0 MD launchDate null 반환 | `calculateSingleProject()` 기간 미지정 경로에서 totalMd=0이면 launchDate=null, 결과 조립 시 null 허용 | 낮음 | 없음 |
| T-03 | [BE] filterEndDate 보정 | 자동 투입 가용 판단 시 filterEndDate를 이전 busy period 종료일 이후로 보정 | 중간 | T-01 |
| T-04 | [FE] 개발 기간 컬럼 수정 | totalMd=0 시 "시작일~" 형태 표시 | 낮음 | T-02 |
| T-05 | [FE] 론치일 null 처리 | launchDate=null 시 "-" 표시 | 낮음 | T-02 |
| T-06 | [FE] 전체 일정 요약 수정 | launchDate=null 항목 제외 | 낮음 | T-05 |

### 4.2 구현 순서

1. **T-01**: `calculateSingleProject()` autoAssigned 분기 내 `if (!squadMemberPool.isEmpty())` → `if (!squadMemberPool.isEmpty() && totalMd.compareTo(BigDecimal.ZERO) > 0)`으로 변경. 기간 미지정·기간 지정 양쪽 모두 0 MD 시 멤버 선택 전체 건너뜀
2. **T-02**: 기간 미지정(`fixedSchedule=false`) 분기의 launchDate 결정 로직에 `totalMd == 0 && endDate == null` 조건 추가 → `launchDate = null`. 결과 조립 line 422: `launchDate.toString()` → `launchDate != null ? launchDate.toString() : null`
3. **T-03**: `filterAvailableMembers()` 호출 전 filterEndDate 계산 로직 검토 및 보정. 구체적으로:
   - 기간 미지정 자동 투입 경로에서 `autoEstDevDays = max(ceil(totalMd), 5)` 로 최솟값 5일 보장
   - 또는 `memberBusyPeriods`에서 해당 멤버의 최대 busy end date를 조회하여 filterEndDate와 비교 후 더 큰 값 사용
4. **T-04 ~ T-06**: 프론트엔드 `renderScheduleCalcResult()` 수정

### 4.3 테스트 계획

**수동 테스트 시나리오**:

| 시나리오 | 설정 | 기대 결과 |
|---------|------|---------|
| 0 MD 프로젝트 단독 | totalMd=0, 기간 미지정 | 자동 투입 0명, 론치일 "-", 개발 "5/4~" |
| 0 MD 프로젝트 단독 | totalMd=0, 기간 지정 (startDate+endDate 있음) | 자동 투입 0명, 론치일=지정된 종료일 (null 아님), 개발 "5/4~" |
| 0 MD 프로젝트 + 수동 멤버 | totalMd=0, 명시적 멤버 지정 (explicitBeMembers 있음), 기간 미지정 | 수동 멤버 표시, 론치일 "-" |
| 자동 투입 연쇄 (A→B) | A: 황의종 자동 투입(5/4~5/26), B: 기간 미지정 | B에서 황의종 미배정 또는 지연 합류로 표시 |
| 자동 투입 연쇄 (A→B) | A: 정상 MD, B: totalMd=0 | B에서 자동 투입 0명, A의 busy period 영향 없음 |

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

- **launchDate null 반환**: `calculateSchedule()` 루프의 busy period 추가 코드가 `launchStr != null` 조건으로 건너뛰어 0 MD 프로젝트의 busy period가 추가되지 않음 → 이는 올바른 동작 (0 MD 프로젝트는 실제 투입 없으므로 busy period 불필요)
- **기간 지정 + 0 MD**: `fixedSchedule = true`이면 launchDate는 `project.getEndDate()`로 설정됨(line 318) → launchDate가 null이 아닌 정상 날짜 → 변경 2 수정 대상이 아님. 이 경우 론치일은 지정된 종료일로 표시 유지. 단 T-01 변경으로 멤버 배정이 0명으로 억제되므로, 기간 지정 0 MD에서 이전에 발생하던 `beMembers = availableMembers` 전체 배정 문제(경로 B)도 함께 해결됨
- **전체 일정 요약**: `validItems`에서 launchDate=null 항목 제외 시, 0 MD 프로젝트만 있으면 요약이 비어있을 수 있음 → "계산 가능한 프로젝트 없음" 처리 필요

### 5.2 엣지 케이스

- totalMd = 0 + 기간 지정 프로젝트: launchDate는 `project.getEndDate()` 유지, devEndDate는 startDate로 설정, devDays = 0
- totalMd = 0 + QA 마일스톤: QA 일수가 있어도 dev가 0이면 QA 날짜 계산이 의미없음 → QA 계산도 건너뛸지 여부 결정 필요 (기간 지정 시에는 역산으로 QA 날짜를 결정하므로 기존대로 유지 가능)

### 5.3 대안 및 완화 방안

- T-03 (filterEndDate 보정)이 복잡하면 임시로 `autoEstDevDays = Math.max((int) Math.ceil(totalMd.doubleValue()), 10)` (최소 10일)으로 설정하여 상당수 케이스 해결 가능
- 버그 2의 완전한 해결을 위해 `isMemberBusy()` 로직 자체를 재검토할 필요가 있으며, 지연 합류 기능과의 균형을 맞춰야 함

---

## 6. 참고 사항

### 관련 기존 코드 경로

- 서비스: `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/service/ScheduleCalculationService.java`
  - `calculateSchedule()`: line 38 — 루프 구조 및 busy period 갱신
  - `calculateSingleProject()`: line 97 — 전체 계산 로직
  - `filterAvailableMembers()`: line 540 — 가용 멤버 필터링
  - `isMemberBusy()`: line 497 — 투입불가 판정 로직
  - `getTargetMemberCount()`: line 568 — 0 MD 시 1명 반환 버그 위치
- 프론트엔드: `/Users/jakejaehee/project/timeline/src/main/resources/static/js/app.js`
  - `renderScheduleCalcResult()`: line 7918 — 결과 렌더링
  - 개발 기간 렌더링: line 7932-7934
  - 론치일 렌더링: line 7941-7942
  - 전체 일정 요약: line 7979-7987

### 관련 이전 계획서

- `docs/dev-plan/39-schedule-auto-assign-member-bug-fix.md` — 자동 투입 초기 구현
- `docs/dev-plan/40-schedule-start-date-and-auto-assign-bug-fix.md` — 시작일 today 보정
- `docs/dev-plan/43-schedule-auto-assign-busy-period-and-late-join-display-fix.md` — estimateProjectStart today 보정 추가
- `docs/dev-plan/44-be-warning-tooltip.md` — BE 경고 툴팁 추가
