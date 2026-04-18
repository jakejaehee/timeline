# 개발 계획서: 일정 계산 자동 투입 버그 수정 (busyPeriod 반영 누락 + 지연 합류 표시 누락)

## 1. 개요

- **기능 설명**: 일정 계산 화면(Schedule Calculation)의 자동 투입(autoAssigned) 로직에서 발생하는 두 가지 버그 수정
- **개발 배경**: 여러 프로젝트를 연속으로 일정 계산할 때, 자동 투입된 멤버의 바쁜 기간이 다음 프로젝트 계산에 반영되지 않아 동일 멤버가 중복 투입되는 문제 및 지연 합류 멤버의 투입 가능일이 UI에 표시되지 않는 문제가 보고됨
- **작성일**: 2026-04-19

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 자동 투입 후 해당 멤버의 프로젝트 기간이 `memberBusyPeriods` 맵에 즉시 반영되어, 이후 프로젝트 계산 시 해당 멤버가 중복 투입되지 않아야 한다.
- FR-002: 자동 투입된 멤버 중 지연 합류(availableFrom이 projStart 이후)인 경우, UI BE 멤버 목록에 "(M/DD~)" 형태의 투입 가능일이 표시되어야 한다.
- FR-003: 자동 투입 경로에서도 지연 합류 정보(`lateJoinDates`)가 계산되어 응답에 `availableFrom`이 포함되어야 한다.

### 2.2 비기능 요구사항

- NFR-001: 기존 명시적 할당(explicitBeMembers) 경로의 동작은 변경하지 않는다.
- NFR-002: 성능 영향 없음 (이미 존재하는 맵에 항목 추가하는 수준).

### 2.3 가정 사항

- 자동 투입 경로에서도 지연 합류가 발생할 수 있다 (예: 해당 멤버가 프로젝트 시작 초반에는 다른 프로젝트에 투입 중이지만 중반부터 가용해지는 경우).
- `_beMemberIds`에 `busyMembers` ID가 포함되는 현재 방식은 유지한다. 단, 자동 투입 경로에서는 busyMembers가 발생하지 않으므로(filterAvailableMembers로 이미 걸러짐) 영향 없음.

### 2.4 제외 범위 (Out of Scope)

- 지연 합류 멤버의 capacity를 일정 계산에 반영하는 로직 변경 (별도 이슈)
- QA 담당자 busyPeriod 처리 방식 변경

---

## 3. 버그 분석

### 3.1 버그 1: 지연 합류 멤버의 투입 가능일 UI 미표시

**증상**: 자동 투입 경로(autoAssigned = true)에서 선택된 멤버 중 지연 합류에 해당하는 멤버가 있어도, UI에 "(5/26~)" 형태의 표시가 나타나지 않는다.

**근본 원인**: `lateJoinDates` 맵이 명시적 할당 경로(`autoAssigned == false`)에서만 계산된다.

코드 위치: `ScheduleCalculationService.java` line 216-256

```java
// 현재 코드: autoAssigned == false 블록 안에서만 lateJoinDates 계산
List<Member> busyMembers = new ArrayList<>();
Map<Long, LocalDate> lateJoinDates = new HashMap<>();
if (!autoAssigned) {
    LocalDate projStartForFilter = project.getStartDate() != null ? project.getStartDate() : LocalDate.now();
    // projEstimatedEnd 산출 (생략)...
    List<Member> filteredBe = new ArrayList<>();
    for (Member m : beMembers) {
        if (isMemberBusy(m.getId(), projStartForFilter, projEstimatedEnd, memberBusyPeriods)) {
            busyMembers.add(m);  // 투입불가 멤버
        } else {
            filteredBe.add(m);
            // lateJoinDates 계산: 바쁜 기간이 있으나 projEstimatedEnd 이전에 끝나는 경우만
            LocalDate availableFrom = getMemberAvailableFrom(m.getId(), projStartForFilter, projEstimatedEnd, memberBusyPeriods);
            if (availableFrom != null) {
                lateJoinDates.put(m.getId(), availableFrom);
            }
        }
    }
    beMembers = filteredBe;
    // ...
}
```

자동 투입 경로(`autoAssigned == true`)에서는 `lateJoinDates`가 빈 맵 상태로 남아, `beMembers` 응답 객체에 `availableFrom`이 포함되지 않는다.

**자동 투입 경로에서 지연 합류가 발생하는 조건**: `filterAvailableMembers()`는 `isMemberBusy()`가 `true`인 멤버만 제외한다. `isMemberBusy()`는 바쁜 기간이 `projEstimatedEnd` 이후까지 이어지는 경우에만 `true`를 반환한다. 즉, 바쁜 기간이 `projEstimatedEnd` 이전에 끝나면 `isMemberBusy()` = `false`이므로 `filterAvailableMembers()`를 통과하지만, 실제로는 프로젝트 시작일 이후에야 합류 가능하다.

### 3.2 버그 2: 자동 투입 후 busyPeriod 미반영

**증상**: 황의종이 프로젝트 A(5/4~5/20)에 자동 투입되었음에도, 프로젝트 B 계산 시 5/4부터 여전히 가용한 것으로 판단되어 동일 기간에 중복 투입된다.

**근본 원인**: `calculateSchedule()` 루프에서 `_beMemberIds`를 사용해 busyPeriod를 추가하는데, `_beMemberIds`는 `beMembers + busyMembers`의 ID를 포함한다. 자동 투입 경로에서는 `busyMembers`가 없으므로 `beMembers`(선택된 멤버)의 ID만 포함된다. 이 부분 자체는 맞다.

**그러나 실제 문제는 타이밍**: `calculateSingleProject()`가 `result`를 반환한 후, `calculateSchedule()` 루프에서 `result.get("startDate")`와 `result.get("launchDate")`를 읽어 busyPeriod를 추가한다 (line 77-91). 즉, 현재 프로젝트가 끝난 후 busyPeriod가 추가된다. 이 설계는 자체적으로는 올바르다.

**진짜 원인**: 코드를 다시 추적하면, `filterAvailableMembers()`는 `projStartEstimate`와 `filterEndDate`를 기준으로 가용 판단을 한다. 만약 프로젝트 A 계산 후 busyPeriod가 올바르게 추가되었다면, 프로젝트 B 계산 시 `filterAvailableMembers()`에서 해당 멤버가 걸러져야 한다.

추가 확인이 필요한 시나리오:

1. **`projLaunchNextDay` 경계 문제**: busyPeriod의 종료일로 `launchDate`의 다음 영업일을 사용하는데, `isMemberBusy()`에서 기간 겹침 판단 시 `period[1]`(exclusive)로 처리한다 (line 487: `projStart.isBefore(period[1])`). 즉, `period[1]` = launchDate 다음 날이면, 프로젝트 B의 시작일이 launchDate 다음 날과 동일한 경우 겹치지 않는 것으로 판단될 수 있다.

2. **자동 투입 경로의 `projStartEstimate`**: 자동 투입의 가용 필터 기준 시작일이 `estimateProjectStart()`로 계산된다. 이 함수는 `project.getStartDate() != null`이면 그 값을, 없으면 `LocalDate.now()`를 반환한다. 반면 busyPeriod 추가 시에는 `result.get("startDate")`를 사용한다. 만약 두 값이 다르면(예: 프로젝트 시작일이 과거) 가용 판단과 busyPeriod의 시작일이 불일치할 수 있다.

3. **`_beMemberIds` 구성 문제**: 자동 투입 경로에서 `lateJoinDates` 맵이 비어 있으므로, 지연 합류 멤버도 `beMembers`에 포함되어 `_beMemberIds`에 들어간다. 이 경우 busyPeriod 추가 시 프로젝트 전 기간(startDate~launchDate)이 추가되는데, 이 멤버는 실제로는 중반부터 합류하므로 과도하게 바쁜 것으로 처리된다. 이는 버그이지만 '더 안전한 방향'이므로 1차 수정에서는 허용.

**결론**: 버그 2의 핵심 원인은 다음 중 하나이거나 복합적일 가능성이 높음:
- **원인 A** (`estimateProjectStart()` 과거 날짜 반환): 프로젝트 B의 `startDate`가 과거 날짜(예: 4/1)로 설정된 경우, `estimateProjectStart()`가 4/1을 반환하여 가용 판단 기준 시작일이 과거가 된다. 이 상황에서 이전 프로젝트 A의 busyPeriod(예: 5/4~5/21)와 겹침 판단 시 `projStart(4/1).isBefore(period[1](5/21))` = true이고 `projEstimatedEnd >= period[0](5/4)` = true이면 겹치므로 busyPeriod가 있는 것으로 보인다. 그러나 동시에 `period[1](5/21) >= projEstimatedEnd(filterEndDate)`의 조건에 따라 투입불가/지연합류 판단이 달라진다.
- **원인 B** (`isMemberBusy()` 경계 조건): 다음 프로젝트 B의 `projStartEstimate`가 현재 프로젝트 A의 `projLaunchNextDay`(busyPeriod 종료일, exclusive)와 동일한 날짜인 경우, `projStart.isBefore(period[1])` = false가 되어 겹치지 않는 것으로 판단된다. 이는 의도된 동작이므로 버그가 아니다.

실제 재현 시나리오와 로그를 통해 정확한 원인을 확인한 후 수정해야 한다. T-01(버그 재현 데이터 확인) 없이는 T-03 수정 방향을 확정할 수 없다.

---

## 4. 시스템 설계

### 4.1 수정 대상 파일

| 파일 | 수정 유형 |
|------|-----------|
| `src/main/java/com/timeline/service/ScheduleCalculationService.java` | 버그 수정 (2곳) |
| `src/main/resources/static/js/app.js` | 표시 로직 확인 (수정 불필요할 가능성 높음) |

### 4.2 백엔드 수정 설계

#### 수정 1: 자동 투입 경로에서 lateJoinDates 계산 추가

**수정 위치**: `calculateSingleProject()` 내 `autoAssigned == true` 블록 (line 124~213)

`filterAvailableMembers()`로 걸러진 후 최종 선택된 `beMembers` 각각에 대해, `getMemberAvailableFrom()`을 호출하여 지연 합류 여부를 확인하고 `lateJoinDates`에 추가해야 한다.

**현재 구조** (`lateJoinDates` 선언 위치와 실제 put 발생 위치):

```java
// line 217: lateJoinDates 선언 — autoAssigned 블록 바깥(올바름)
Map<Long, LocalDate> lateJoinDates = new HashMap<>();
if (!autoAssigned) {   // ← put()은 이 블록 안에서만 발생 (autoAssigned == true 경로에서는 put() 없음)
    ...
}
```

`lateJoinDates` 맵 자체는 올바른 위치에 선언되어 있다. 수정은 자동 투입 블록(line 124~213) 내에서 `beMembers`가 확정된 시점(line 211: `autoAssignedMembers = new ArrayList<>(beMembers)`) 직후에 lateJoinDates 계산 코드를 추가하는 것이다.

**추가할 코드**:

```java
// autoAssigned == true 블록 내, line 211 (autoAssignedMembers 할당) 직후에 삽입
// 자동 투입된 멤버의 지연 합류 가능 시작일 계산
for (Member m : beMembers) {
    LocalDate availableFrom = getMemberAvailableFrom(
        m.getId(), projStartEstimate, filterEndDate, memberBusyPeriods);
    if (availableFrom != null) {
        lateJoinDates.put(m.getId(), availableFrom);
    }
}
```

`projStartEstimate`(line 132)와 `filterEndDate`(line 141)는 모두 `squadMemberPool.isEmpty()` 조건 블록 내에서 선언된 지역 변수이며, line 211에서도 해당 스코프 내에 있으므로 접근 가능하다.

`projStartEstimate`는 명시적 할당 경로의 `projStartForFilter`(`project.getStartDate() != null ? project.getStartDate() : LocalDate.now()`)와 동일한 로직인 `estimateProjectStart(project)` 반환값이므로, 두 경로 간 `getMemberAvailableFrom()` 호출 의미가 일치한다. `projStartEstimateAdj`(비가용일 보정된 값, line 139)가 아닌 보정 전 `projStartEstimate`를 사용하는 이유는 명시적 할당 경로의 `projStartForFilter`가 비가용일 보정 없이 사용되는 것과의 일관성을 유지하기 위해서이다.

#### 수정 2: busyPeriod 반영 로직 검증 및 경계 조건 수정

**수정 위치**: `calculateSchedule()` 루프 (line 77-91) 및 `isMemberBusy()` (line 480-493)

**검증 포인트 A: `projLaunchNextDay` 경계**

현재:
```java
LocalDate projLaunchNextDay = bizDayCalc.getNextBusinessDay(LocalDate.parse(launchStr), holidays);
```

`isMemberBusy()`의 겹침 판단:
```java
boolean overlaps = projStart.isBefore(period[1]) && !projEstimatedEnd.isBefore(period[0]);
```

여기서 `period[1]` = `projLaunchNextDay`(다음 영업일)이고, 다음 프로젝트의 `projStart`가 바로 그 날이라면 `projStart.isBefore(period[1])`가 `false`가 되어 겹치지 않는 것으로 판단된다. 이는 의도된 동작(론치일 다음 날부터 가용)이다.

문제가 발생하는 경우: 다음 프로젝트의 `projStartEstimate`가 과거 날짜인 경우. 예를 들어, 프로젝트 B의 `startDate`가 4/1로 설정되어 있고 기간 미지정인 경우, `estimateProjectStart()`는 4/1을 반환하고 `projStartEstimateAdj`도 4/1(또는 근처 영업일)이 된다. 이를 기준으로 `filterEndDate`를 계산하면(`projStartEstimateAdj + autoEstDevDays 영업일`) filterEndDate도 과거 날짜가 될 수 있다. 이 경우 이전 프로젝트 A의 busyPeriod(`period[1]` = 5/21)에 대해 `period[1](5/21) >= filterEndDate(과거)` = true가 되어 해당 멤버가 투입불가로 판단되는 문제가 발생할 수 있다. 반대로, filterEndDate가 더 먼 미래(예: 정상 기준일이 오늘인 경우)였다면 `period[1](5/21) >= filterEndDate`가 false여서 지연 합류 가용으로 올바르게 처리되었을 것이다.

**검증 포인트 B: `estimateProjectStart()` vs 실제 `startDate` 불일치**

`filterAvailableMembers()` 호출 시 `projStartEstimate`를 사용하고, busyPeriod 추가 시 `result.get("startDate")`를 사용한다. 과거 날짜가 startDate로 설정된 경우 `estimateProjectStart()`는 그 과거 날짜를 반환하지만, 실제 `startDate` 계산에서는 `today`로 보정된다. 이로 인해 가용 필터 기준과 busyPeriod 범위가 불일치할 수 있다.

**수정 방향**: `estimateProjectStart()`가 today보다 이전 날짜를 반환하지 않도록 수정한다. 구체적으로 `return startDate.isBefore(today) ? today : startDate` 로직을 추가하여 `projStartEstimate`가 항상 오늘 이후 날짜가 되도록 한다. 이렇게 하면 `projStartEstimateAdj`와 `filterEndDate`도 오늘 이후를 기준으로 계산되어 busyPeriod 겹침 판단이 실제 계산 기준과 일치하게 된다.

이 수정은 명시적 할당 경로(`projStartForFilter = project.getStartDate() != null ? project.getStartDate() : LocalDate.now()`)와 달리 과거 날짜를 그대로 사용하지 않는 것으로, 두 경로 간 일관성도 확보된다.

### 4.3 프론트엔드 확인

`app.js` line 7934의 기존 코드:

```javascript
var dateLabel = m.availableFrom
    ? '<span class="text-info" style="font-size:0.65rem;">(' + formatDateShort(m.availableFrom) + '~)</span>'
    : '';
```

이 코드는 이미 `availableFrom` 필드를 표시하도록 구현되어 있다. `beMembers` 배열의 각 항목에 `availableFrom`이 포함되기만 하면 자동으로 표시된다. 따라서 **프론트엔드 수정은 불필요**하다.

단, 자동 투입 경로의 멤버도 `beMembers` 배열에 포함되어 이 코드를 거치므로, 백엔드에서 `availableFrom`을 올바르게 내려주면 UI에 표시된다.

---

## 5. 구현 계획

### 5.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | 버그 재현 데이터 확인 | 황의종, 송재호, 이재훈 데이터로 실제 로그 또는 디버그 출력하여 정확한 원인 확정 | 낮음 | - |
| T-02 | 자동 투입 lateJoinDates 계산 추가 (버그 1) | `calculateSingleProject()` autoAssigned 블록에 `getMemberAvailableFrom()` 호출 추가 | 낮음 | T-01 |
| T-03 | busyPeriod 반영 경계 조건 수정 (버그 2) | `estimateProjectStart()` 또는 `filterAvailableMembers()` 호출 시 today 보정 적용 | 중간 | T-01 |
| T-04 | 컴파일 및 통합 테스트 | `./gradlew compileJava` + 실제 시나리오 수동 검증 | 낮음 | T-02, T-03 |

### 5.2 구현 순서

1. **Step 1 (T-01)**: 실제 프로젝트 순서로 일정 계산을 실행하고, 로그 또는 임시 디버그 출력으로 `memberBusyPeriods` 상태와 `projStartEstimate` 값을 확인하여 버그 2의 정확한 원인을 특정한다.

2. **Step 2 (T-02)**: `calculateSingleProject()`의 autoAssigned 블록 내, `autoAssignedMembers = new ArrayList<>(beMembers)` 직후에 lateJoinDates 계산 코드를 추가한다. `projStartEstimate`와 `filterEndDate`가 이미 해당 스코프에 존재하므로 추가 변수 선언 불필요.

3. **Step 3 (T-03)**: T-01에서 확인된 원인에 따라 `estimateProjectStart()` 또는 `filterAvailableMembers()` 호출부를 수정한다.

   - **원인이 A(estimateProjectStart 과거 날짜 반환)인 경우**: `estimateProjectStart()`가 `today`보다 이전 날짜를 반환하지 않도록 수정 (`return startDate.isBefore(today) ? today : startDate`). 이를 통해 가용 필터 기준 시작일이 항상 오늘 이후가 되어 busyPeriod와의 겹침 판단이 실제 계산 기준과 일치하게 된다.
   - **원인이 B(isMemberBusy 경계 조건)인 경우**: §3.2에서 분석한 바와 같이 경계 조건(projStart == period[1])은 의도된 동작이므로 수정 대상이 아니다. 만약 실제 증상이 경계 조건이 아닌 다른 이유로 발생하면 T-01 결과를 기반으로 원인을 재분류한다.
   - **원인이 C(다른 원인)인 경우**: T-01 결과에 따라 결정

4. **Step 4 (T-04)**: 수정 후 `./gradlew compileJava`로 컴파일 확인 후, 실제 다음 시나리오를 수동 검증:
   - '유즈드 매입' → '파트너 소비기한별 입고신청' 순서로 계산 시, 송재호에 "(5/26~)" 표시 확인
   - '파트너 소비기한별 입고신청' → 'MFS 이동/입고 취소 및 마감' 순서로 계산 시, 황의종이 5/4에 중복 투입되지 않음 확인

### 5.3 테스트 계획

**수동 검증 시나리오**:

1. 황의종이 포함된 스쿼드의 프로젝트 A, B 순서로 일정 계산 실행
   - 프로젝트 A 론치일이 5/20인 경우, 프로젝트 B에서 황의종이 5/20 이전에 투입되지 않아야 함
   - 또는 5/21(다음 영업일)부터 투입 가능한 것으로 표시되어야 함

2. 지연 합류 멤버 확인
   - 자동 투입 경로에서 선택된 멤버 중 이전 프로젝트 기간과 겹치는 멤버의 BE 목록에 "(M/DD~)" 표시 확인

---

## 6. 리스크 및 고려사항

### 6.1 기술적 리스크

- **lateJoinDates 추가의 부작용**: 자동 투입 경로에서 지연 합류 멤버가 `lateJoinDates`에 등록되면, `beMembers` 응답에 `availableFrom`이 포함된다. 이 멤버의 실제 가용 기간이 프로젝트 기간의 일부인데, devDays 계산 시 `beCapacity`에는 이 멤버의 전체 capacity가 반영된다. 즉, 실제보다 빠른 완료 날짜가 계산될 수 있다. 이는 이미 존재하는 문제이며 이번 수정 범위에서는 허용.

- **busyPeriod 수정의 연쇄 영향**: `estimateProjectStart()`에 today 보정을 추가하면, 기간 미지정 프로젝트의 가용 멤버 필터링 기준이 변경된다. 기존에 "오늘 이전 날짜의 startDate"를 가진 프로젝트에서 일부 멤버가 가용하지 않은 것으로 판단될 수 있다. 실제 영향은 T-01 재현 과정에서 확인.

### 6.2 의존성 리스크

- 해당 수정은 `ScheduleCalculationService.java` 내부에만 국한되며, DB 스키마 변경, BackupDto 변경, 다른 서비스에 대한 영향이 없다.

---

## 7. 참고 사항

### 7.1 관련 코드 경로

- `src/main/java/com/timeline/service/ScheduleCalculationService.java`
  - `calculateSchedule()`: line 38-95 (메인 루프, busyPeriod 추가)
  - `calculateSingleProject()`: line 97-444 (단일 프로젝트 계산, lateJoinDates 계산)
  - `isMemberBusy()`: line 480-493 (바쁜 기간 판단)
  - `getMemberAvailableFrom()`: line 500-518 (지연 합류 시작일 계산)
  - `filterAvailableMembers()`: line 523-532 (가용 멤버 필터링)
  - `estimateProjectStart()`: line 470-473 (프로젝트 시작일 추정)
- `src/main/resources/static/js/app.js`
  - `renderScheduleCalcResult()`: line 7905-7969 (결과 렌더링, availableFrom 표시: line 7934)

### 7.2 핵심 데이터 흐름 정리

```
calculateSchedule() [프로젝트 루프]
  ├── calculateSingleProject()
  │     ├── autoAssigned == true 경로
  │     │     ├── filterAvailableMembers(projStartEstimate, filterEndDate)  ← estimateProjectStart() 사용
  │     │     ├── beMembers 선택
  │     │     └── [현재 누락] lateJoinDates 계산 필요
  │     ├── autoAssigned == false 경로
  │     │     └── lateJoinDates 계산 (정상 동작)
  │     └── return result (beMembers에 availableFrom 포함)
  └── [프로젝트 완료 후] memberBusyPeriods에 _beMemberIds 기간 추가
        ├── 기준: result["startDate"] ~ result["launchDate"]의 다음 영업일
        └── [의심] estimateProjectStart() 반환값과 result["startDate"] 간 불일치 가능성
```

### 7.3 관련 계획서

- `docs/dev-plan/39-schedule-auto-assign-member-bug-fix.md`: 자동 투입 초기 구현
- `docs/dev-plan/40-schedule-start-date-and-auto-assign-bug-fix.md`: 자동 투입 버그 1차 수정
- `docs/dev-plan/42-schedule-calc-ui-improvements.md`: 일정 계산 UI 개선
