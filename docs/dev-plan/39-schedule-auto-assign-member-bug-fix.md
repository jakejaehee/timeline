# 개발 계획서: 일정 계산 멤버 자동 투입 로직 버그 수정

## 1. 개요

- **기능 설명**: 일정 계산 시 명시적으로 할당된 BE 멤버의 가용 여부 판단 로직과, 기간 미지정 프로젝트에서 totalMd 구간별 자동 투입 인원 산정 로직의 버그를 수정한다.
- **개발 배경**: 유즈드 매입 프로젝트(24 MD, 기간 미지정) 일정 계산 결과에서 규칙상 3명이 투입되어야 함에도 1명(송재호)만 투입되고, 이재훈/권동희는 개발기간 중간에 가용해짐에도 "투입불가"로 표시되는 버그가 보고됨.
- **작성일**: 2026-04-18

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 명시적 BE 멤버 중 "개발기간 전체에 걸쳐 바쁜 멤버"는 `busyMembers`로 분류하고, "개발기간 도중에 가용해지는 멤버(즉, 바쁜 기간이 끝난 후 프로젝트 개발기간이 남아 있는 멤버)"는 `beMembers`에 포함한다.
- **FR-002**: `isMemberBusy` 판단 기준을 "프로젝트 시작일 시점에 이미 가용한가"에서 "프로젝트 개발기간 전체 동안 단 하루도 기여할 수 없는가"로 변경한다.
- **FR-003**: 기간 미지정 + 명시적 BE 멤버가 있는 프로젝트에서, 가용 멤버 수가 `getTargetMemberCount(totalMd)` 기준에 미달하더라도, 가용한 인원 전원을 투입하고 별도 경고를 출력한다.
- **FR-004**: 기간 미지정 + 명시적 BE 멤버가 있는 프로젝트에서, 가용 멤버 수가 목표 인원을 초과하더라도 전원 투입하는 것이 아니라 목표 인원까지만 투입한다. (현재 `busyMembers` 분리 후 남은 `beMembers` 전원 투입이 되고 있으므로 이 부분도 검토 필요)

### 2.2 비기능 요구사항

- **NFR-001**: 기존 "고정 일정" 프로젝트(startDate + endDate 모두 존재) 계산 결과에 영향을 주지 않는다.
- **NFR-002**: 자동 할당(autoAssigned=true) 경로에서 `filterAvailableMembers`의 **결과**(가용/불가 분류) 및 `busyMembers` 목록을 응답에 포함하지 않는 기존 동작은 유지한다. 다만 `isMemberBusy` 시그니처 변경에 따라 `filterAvailableMembers`도 `projEstimatedEnd`를 전달하도록 호출부를 수정한다 (동작 결과는 동일하게 유지).
- **NFR-003**: UI 응답 형식(`busyMembers`, `beMembers` 필드명)을 변경하지 않는다.

### 2.3 가정 사항

- 유즈드 매입 프로젝트는 `startDate=null`, `endDate=null` (기간 미지정) 상태이다.
- 유즈드 매입 프로젝트에 `ProjectMember` 로 송재호, 이재훈, 권동희가 명시적으로 등록되어 있다.
- `memberBusyPeriods`의 바쁜 기간은 앞선 프로젝트(무진장, MFS 재고이동)의 `[startDate, launchDate 다음 영업일)` 구간이다.
  - 이재훈: `[4/14, 5/9)` (무진장 론치 5/8 → 다음 영업일 5/9)
  - 권동희: `[4/18, 4/25)` (MFS 재고이동 론치 4/24 → 다음 영업일 4/25)
- 유즈드 매입의 계산 시점 기준 시작일은 `오늘(4/18)` 또는 그 이후 영업일로 추정된다.
- "개발기간 도중 가용"의 기준은 멤버의 바쁜 기간 종료일이 프로젝트 예상 개발 종료일(devEndDate)보다 이전인 경우이다.

### 2.4 제외 범위 (Out of Scope)

- 자동 할당(autoAssigned=true, 스쿼드 기반) 경로의 변경
- `qaAssigneeBusyPeriods` 중복 감지 로직 변경
- `memberBusyPeriods` 누적 방식 변경 (프로젝트 처리 순서, startDate ~ launchNextDay 구간 기록 방식)
- UI 응답 필드명(`busyMembers`, `beMembers`) 변경 (기존 필드명 유지)
- `availableFrom` 외 새 필드 추가

---

## 3. 버그 분석

### 3.1 버그 A: `isMemberBusy` 가 "일부 기간 겹침"을 "완전 바쁨"으로 오판

**위치**: `ScheduleCalculationService.java` 197~209번째 줄 (명시적 할당 분리 블록)

**현재 코드 흐름**:

```java
// 가용/바쁜 멤버 분리 (명시적 할당인 경우)
List<Member> busyMembers = new ArrayList<>();
if (!autoAssigned) {
    LocalDate projStartForFilter = project.getStartDate() != null
            ? project.getStartDate() : LocalDate.now();
    List<Member> filteredBe = new ArrayList<>();
    for (Member m : beMembers) {
        if (isMemberBusy(m.getId(), projStartForFilter, project, memberBusyPeriods)) {
            busyMembers.add(m);  // "바쁨" 분류
        } else {
            filteredBe.add(m);   // "가용" 분류
        }
    }
    beMembers = filteredBe;
}
```

**`isMemberBusy` 로직**:

```java
private boolean isMemberBusy(Long memberId, LocalDate projStart, Project project,
                               Map<Long, List<LocalDate[]>> memberBusyPeriods) {
    for (LocalDate[] period : periods) {
        if (projStart.isBefore(period[1])
            && (project.getEndDate() == null || !project.getEndDate().isBefore(period[0]))) {
            return true;  // 하나라도 겹치면 "바쁨"으로 판정
        }
    }
    return false;
}
```

**버그 원인 (논리 오류)**:

| 멤버 | 바쁜 기간 (period) | 프로젝트 기간 (projStart ~ endDate) | 겹침 여부 | 현재 판정 | 올바른 판정 |
|------|-------------------|-------------------------------------|-----------|-----------|------------|
| 이재훈 | `[4/14, 5/9)` | `4/18 ~ null(미지정)` | 일부 겹침 (4/18~5/8) | 바쁨 | 가용 (5/9 이후 기여 가능) |
| 권동희 | `[4/18, 4/25)` | `4/18 ~ null(미지정)` | 일부 겹침 (4/18~4/24) | 바쁨 | 가용 (4/25 이후 기여 가능) |
| 송재호 | 바쁜 기간 없음 | `4/18 ~ null(미지정)` | 없음 | 가용 | 가용 |

유즈드 매입의 `endDate=null`이기 때문에 `isMemberBusy` 조건 `project.getEndDate() == null` → 두 번째 조건이 항상 `true`가 된다. 따라서 `projStart.isBefore(period[1])` 만 참이면 무조건 "바쁨"으로 판정된다.

결과적으로:
- **이재훈**: `4/18 < 5/9(period[1])` → `true` → 바쁨으로 오판
- **권동희**: `4/18 < 4/25(period[1])` → `true` → 바쁨으로 오판

**올바른 판단 기준**: 멤버의 바쁜 기간이 프로젝트 예상 개발 종료일보다 늦게까지 이어지는 경우에만 "투입불가"로 판정해야 한다. 바쁜 기간이 개발기간 도중에 끝나면, 그 이후부터 참여하는 "지연 합류" 멤버로 취급해야 한다.

---

### 3.2 버그 B: 기간 미지정 + 명시적 할당에서 `getTargetMemberCount` 미적용

**현재 명시적 할당 경로의 처리**:

```
if (!explicitBeMembers.isEmpty()) {
    beMembers = explicitBeMembers;   // 전원을 그냥 사용
}
// ... (autoAssigned=false 처리)
// isMemberBusy 판별 후 busyMembers 분리
// → beMembers = "바쁘지 않은 명시 멤버 전원"
```

기간 미지정 프로젝트에서 명시적 할당 멤버가 있을 때 `getTargetMemberCount(totalMd)`를 호출하지 않는다.

**결과**:
- 자동 할당이었다면 24 MD → `getTargetMemberCount(24)` = 3명 선택
- 명시적 할당은 가용 멤버 전원 사용 → 현재 버그 A에 의해 1명만 가용 처리됨

그러나 버그 A가 수정되어 3명 모두 가용으로 처리된다면, 이 경우에는 3명 전원 투입이 올바른 결과가 된다. 즉 버그 B는 **버그 A 수정 후에도 여전히 인원이 부족한 별도 케이스**(가용 인원 < 목표 인원)에서 경고를 생성하지 않는 문제로 잔존한다.

**결론**: 버그 B(경고 미생성)는 버그 A 수정과 함께 처리한다.

---

### 3.3 버그 C: `devEndDate` 없이 "지연 합류" 멤버의 실제 기여 기간 미반영

버그 A를 단순 수정(period[1] < devEndDate이면 가용)하더라도, 지연 합류 멤버가 포함된 경우 `devDays` 계산이 부정확해진다.

- 이재훈은 5/9 이후부터만 기여 가능 (capacity 0.7)
- 권동희는 4/25 이후부터만 기여 가능 (capacity 0.7)
- 송재호는 4/18부터 기여 가능 (capacity 0.7)

이를 단순히 `beCapacity = 0.7 + 0.7 + 0.7 = 2.1`로 계산하면 devEndDate가 과도하게 앞당겨진다. 지연 합류 멤버의 가용 개시일 이전 기간은 더 적은 capacity로 작업이 진행되기 때문이다.

**단계적 접근**: 이 계산 복잡도(piecewise capacity 계산)는 이번 버그픽스 범위에서 제외하고, 지연 합류 멤버는 "가용 멤버"로 분류하되 UI에 "가용 개시일"을 함께 표시하는 방식으로 1차 수정한다. devDays 정밀 계산은 후속 개선 과제로 남긴다.

---

## 4. 시스템 설계

### 4.1 수정 대상 메서드

**파일**: `src/main/java/com/timeline/service/ScheduleCalculationService.java`

#### 4.1.1 `isMemberBusy` 수정

**현재 시그니처**:
```java
private boolean isMemberBusy(Long memberId, LocalDate projStart, Project project,
                               Map<Long, List<LocalDate[]>> memberBusyPeriods)
```

**문제**: `project.getEndDate()`가 null인 경우 "기간 미지정" 프로젝트의 예상 종료일을 알 수 없어, 바쁜 기간이 조금이라도 겹치면 무조건 "바쁨"으로 판정함.

**수정 방향**: `projStart`와 함께 `projEstimatedEnd(예상 devEndDate)`를 파라미터로 받아, 멤버의 바쁜 기간 전체가 `projEstimatedEnd` 이후까지 이어질 때만 "완전히 바쁨(투입불가)"으로 판정한다.

**새 시그니처 (안)**:
```java
private boolean isMemberBusy(Long memberId, LocalDate projStart, LocalDate projEstimatedEnd,
                               Map<Long, List<LocalDate[]>> memberBusyPeriods)
```

**새 판정 로직**:

`isMemberBusy`는 멤버의 모든 바쁜 기간(period 리스트) 중 현재 프로젝트와 겹치는 기간을 순회하여 아래 기준으로 판정한다.

```
for (LocalDate[] period : periods) {
    boolean overlaps = projStart.isBefore(period[1]) && projEstimatedEnd.isAfter(period[0]);
    if (overlaps && !period[1].isBefore(projEstimatedEnd)) {
        return true;  // 이 바쁜 기간이 프로젝트 전 기간을 커버 → 투입불가
    }
}
return false;  // 모든 바쁜 기간이 개발 중간에 끝남 → 지연 합류 가용
```

- **겹침 조건**: `projStart < period[1]` AND `projEstimatedEnd > period[0]`
  (기존 `endDate==null` 분기를 `projEstimatedEnd`로 통합. `endDate==null`인 경우 기존 코드는 두 번째 조건을 `true`로 강제하여 `projStart < period[1]`만으로 판정했으나, 수정 후에는 `projEstimatedEnd`를 명시적으로 사용한다.)
- **완전 바쁨 조건**: 겹치는 기간 중 `period[1] >= projEstimatedEnd`인 것이 하나라도 있으면 "투입불가"
- **다수 바쁜 기간 케이스**: 바쁜 기간이 여러 개일 때, 하나는 projEstimatedEnd 이전에 끝나고 다른 하나가 projEstimatedEnd 이후까지 이어지면 → "투입불가"로 판정 (가장 엄격한 기간 우선). 모든 겹치는 기간이 projEstimatedEnd 이전에 끝나면 "지연 합류 가용"으로 판정.
- "지연 합류 가용"으로 판정된 멤버의 `availableFrom`은 **겹치는 모든 바쁜 기간 종료일의 최대값**으로 결정한다.

#### 4.1.2 명시적 할당 분리 블록 수정

**위치**: 197~209번째 줄

**현재 코드에서 필요한 변경**:
1. `projStartForFilter` 외에 `projEstimatedEnd`를 산출하는 로직 추가
2. `isMemberBusy` 호출 시 `projEstimatedEnd` 전달
3. 지연 합류 멤버의 `availableFrom` (가용 개시일) 계산 및 별도 목록(`lateJoinMembers`) 구성
4. 기간 미지정 + 명시적 할당에서 가용 인원이 `getTargetMemberCount(totalMd)` 미달 시 경고 메시지 추가

#### 4.1.3 `projEstimatedEnd` 계산 방법

기간 미지정 프로젝트에서 "이번 계산에서의 예상 devEndDate"를 미리 추정해야 한다. 정확한 값은 `beCapacity` 확정 후에 계산되므로, 닭과 달걀 문제가 생긴다. 다음과 같이 2단계로 처리한다.

**1단계 추정 (1명 기준)**:
```
totalMd = calculateTotalMd(project, projectId)
estimatedDevDays = ceil(totalMd / 1.0)   // 최악의 경우 (1명)
projEstimatedEnd = addBusinessDays(today, estimatedDevDays)
```

이는 "프로젝트가 아무리 길어도 이 날짜 이전에는 끝난다"는 상한선이다. 멤버의 바쁜 기간이 이 상한선보다 늦게까지 이어지면 진짜 투입불가이다.

**대안**: `getTargetMemberCount(totalMd)` 기준 인원의 평균 capacity(0.7~1.0 가정)로 추정하면 더 정확하나, 복잡도가 증가한다. 상한선 방식이 간단하고 안전하다.

#### 4.1.4 결과 응답 확장

지연 합류 멤버를 UI에서 구분하여 표시할 수 있도록 응답 필드를 추가한다.

**기존 응답 필드**:
```json
{
  "beMembers": [{"name": "송재호", "capacity": 0.7}],
  "busyMembers": [{"name": "이재훈", "capacity": 0.7}, {"name": "권동희", "capacity": 0.7}]
}
```

**수정 후 응답 필드**:
```json
{
  "beMembers": [
    {"name": "송재호", "capacity": 0.7},
    {"name": "이재훈", "capacity": 0.7, "availableFrom": "2026-05-09"},
    {"name": "권동희", "capacity": 0.7, "availableFrom": "2026-04-25"}
  ],
  "busyMembers": []
}
```

- `availableFrom`이 없으면 즉시 가용, 있으면 해당 날짜부터 가용
- `busyMembers`는 개발기간 전체를 커버하는 경우에만 포함됨

### 4.2 API 설계

변경 없음. 기존 `POST /api/v1/schedule/calculate` 엔드포인트 그대로 사용.

응답 `beMembers` 배열 내 각 객체에 `availableFrom` 필드가 선택적으로 추가됨.

| Method | Endpoint | 설명 | 변경 사항 |
|--------|----------|------|----------|
| POST | /api/v1/schedule/calculate | 일정 계산 | beMembers 내 availableFrom 필드 추가 (선택적) |

### 4.3 서비스 계층 변경

**`ScheduleCalculationService.java`**

| 메서드 | 변경 유형 | 내용 |
|--------|-----------|------|
| `isMemberBusy` | 수정 | 시그니처 변경 + 판정 로직 수정 |
| `filterAvailableMembers` | 수정 | 시그니처에 `projEstimatedEnd` 추가 후 `isMemberBusy` 새 시그니처로 내부 호출 |
| 명시적 할당 분리 블록 (line 197~209) | 수정 | `projEstimatedEnd` 계산, `lateJoinMembers` 구성, 경고 생성 |
| `calculateSingleProject` | 수정 | `lateJoinMembers`의 `availableFrom`을 응답에 포함 |

### 4.4 프론트엔드 (app.js)

**표시 변경 (선택 사항)**:

현재 `busyMembers` 분류된 멤버는 "투입불가:" 접두사로 표시된다. `availableFrom`이 있는 멤버는 "(N월N일~)" 형식으로 가용 개시일을 함께 표시한다.

예시 변경:
- 기존: `1명 송재호(0.7), 투입불가: 권동희, 이재훈`
- 수정: `3명 송재호(0.7), 권동희(0.7, 4/25~), 이재훈(0.7, 5/9~)`

---

## 5. 구현 계획

### 5.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `isMemberBusy` 시그니처 및 판정 로직 수정 | `projEstimatedEnd` 파라미터 추가, 판정 조건 변경 | 낮음 | - |
| T-02 | `filterAvailableMembers` 시그니처 및 호출부 수정 | `projEstimatedEnd` 파라미터 추가, 자동 할당 경로 호출부에 `projEstimatedEnd` 전달 (가용/불가 분류 결과 동작은 유지) | 낮음 | T-01 |
| T-03 | 명시적 할당 분리 블록 수정 | `projEstimatedEnd` 계산, 지연 합류 멤버(`availableFrom`) 구성, 투입불가 경고 추가 | 중간 | T-01 |
| T-04 | 응답 조립 수정 | `beMembers` 내 `availableFrom` 필드 포함 | 낮음 | T-03 |
| T-05 | `app.js` 표시 수정 | `availableFrom` 있는 멤버는 날짜 표시 추가, busyMembers 표시 유지 | 낮음 | T-04 |

### 5.2 구현 순서

1. **T-01**: `isMemberBusy` 메서드 수정
   - 기존: `(Long memberId, LocalDate projStart, Project project, Map<...> memberBusyPeriods)`
   - 신규: `(Long memberId, LocalDate projStart, LocalDate projEstimatedEnd, Map<...> memberBusyPeriods)`
   - 판정 조건: (`projStart < period[1]` AND `projEstimatedEnd > period[0]`) (기간 겹침) AND `period[1] >= projEstimatedEnd` (개발 종료 이후까지 바쁨). §4.1.1의 pseudocode 참조.

2. **T-02**: `filterAvailableMembers` 수정
   - 시그니처 변경: `(List<Member> pool, LocalDate projStart, Project project, Map<...> memberBusyPeriods)` → `(List<Member> pool, LocalDate projStart, LocalDate projEstimatedEnd, Map<...> memberBusyPeriods)`
   - 내부에서 `isMemberBusy` 호출 시 `projEstimatedEnd` 전달
   - 자동 할당 경로(line 130) 호출부: `projEstimatedEnd = addBusinessDays(projStartEstimate, (int) Math.ceil(totalMd.doubleValue()))` 로 산출. `totalMd`는 이미 line 124에서 계산되어 있어 재계산 불필요.
   - 자동 할당 경로에서 `filterAvailableMembers` 결과(가용/불가 이진 분류) 동작은 변경하지 않는다. 지연 합류 멤버를 beMembers로 구분하는 추가 처리(T-03)는 명시적 할당 분기에서만 수행한다.

3. **T-03**: 명시적 할당 분리 블록 수정 (핵심)
   - `projEstimatedEnd` 산출: `addBusinessDays(today, (int) Math.ceil(totalMd.doubleValue()))` (1명 기준 최악 상한)
   - `isMemberBusy` 새 시그니처로 호출
   - "지연 합류" 멤버 처리: `isMemberBusy = false`이지만 멤버의 바쁜 기간 중 `projStart`와 겹치는 period가 있는 경우,
     - `availableFrom`: 겹치는 기간들(`projStart < period[1] && projEstimatedEnd > period[0]`) 중 `period[1]`의 **최대값**으로 결정
     - 바쁜 기간이 전혀 없거나 모두 `projStart` 이전에 끝난 경우: `availableFrom = null` (즉시 가용)
   - 기간 미지정에서 가용 멤버 수 < `getTargetMemberCount(totalMd)`이면 경고 추가: `"BE N명 추가 투입 필요 (현재 M명)"`
   - `lateJoinDates` 맵(`Map<Long, LocalDate>`) 구성: memberId → availableFrom
   - 참고: 수정 후 지연 합류 멤버는 `beMembers`에 포함되므로, `_beMemberIds`(`beMembers + busyMembers` 합산, line 383~386)에 정상 포함되어 다음 프로젝트의 `memberBusyPeriods` 누적이 올바르게 동작한다.

4. **T-04**: 응답 조립 수정
   - `beMembers` 리스트 구성 시 `availableFrom` 포함 (line 371 수정):
     ```java
     beMembers.stream().map(m -> {
         Map<String, Object> item = new LinkedHashMap<>();
         item.put("name", m.getName());
         item.put("capacity", m.getCapacity());
         if (lateJoinDates.containsKey(m.getId())) {
             item.put("availableFrom", lateJoinDates.get(m.getId()).toString());
         }
         return item;
     }).collect(Collectors.toList())
     ```
   - `beCount`(line 364): `beMembers.size()`를 그대로 사용하므로, 지연 합류 멤버가 `beMembers`에 포함된 수정 후 자동으로 올바른 값(3)이 반영된다. 별도 수정 불필요.

5. **T-05**: `app.js` 수정 (`renderScheduleCalcResult` 함수, line 7935)
   - `beMembers` 렌더링 시 `availableFrom` 있으면 멤버명 뒤에 `(M/D~)` 형식 추가:
     ```javascript
     var beMemberLabels = r.beMembers.map(function(m) {
         var isAuto = r.autoAssignedMembers && r.autoAssignedMembers.some(function(am) { return am.name === m.name; });
         var dateLabel = m.availableFrom ? '(' + formatDateShort(m.availableFrom) + '~)' : '';
         return m.name + '(' + m.capacity + ')' + dateLabel
             + (isAuto ? '<span class="badge bg-warning text-dark" style="font-size:0.55rem; margin-left:2px;">자동</span>' : '');
     });
     ```
   - `busyMembers` 렌더링 로직(line 7941~7943)은 변경 없이 유지
   - `beCount`(`r.beCount`)는 서버에서 올바른 값이 반환되므로 클라이언트 수정 불필요

### 5.3 테스트 계획

#### 단위 테스트 시나리오

| 케이스 | 조건 | 기대 결과 |
|--------|------|-----------|
| TC-01: 완전 바쁜 멤버 | 바쁜 기간이 projEstimatedEnd 이후까지 이어짐 | busyMembers에 분류 |
| TC-02: 지연 합류 멤버 | 바쁜 기간이 projEstimatedEnd 이전에 끝남 | beMembers에 포함, availableFrom 설정 |
| TC-03: 즉시 가용 멤버 | 바쁜 기간 없음 | beMembers에 포함, availableFrom 없음 |
| TC-04: 유즈드 매입 시나리오 재현 | 24MD, 3명(이재훈5/9, 권동희4/25, 송재호 즉시) | beMembers 3명, busyMembers 0명 |
| TC-05: 고정 일정 프로젝트 | startDate + endDate 모두 존재 | 기존 동작 변화 없음 |
| TC-06: 가용 인원 부족 경고 | 24MD, 가용 1명 | warning: "BE 2명 추가 투입 필요" |

---

## 6. 리스크 및 고려사항

### 6.1 기술적 리스크

| 리스크 | 설명 | 대안 |
|--------|------|------|
| `projEstimatedEnd` 과도 추정 | totalMd/1.0 기준이면 실제 종료일보다 훨씬 뒤가 됨 → "완전 바쁨" 판정이 너무 관대해짐 | 목표 인원(getTargetMemberCount) × 평균 0.7 capacity 기준으로 추정 |
| devDays 부정확 | 지연 합류 멤버가 beMembers에 포함되면 beCapacity 합산이 너무 커져 devEndDate가 과도하게 앞당겨짐 | 1차 수정에서는 지연 합류 멤버를 beMembers에 포함하되 경고로 안내. 정밀 계산은 후속 과제 |
| 고정 일정 + 명시적 할당 경로 영향 | `isMemberBusy` 시그니처 변경 시 호출부(`filterAvailableMembers`)도 수정 필요 | 호출부 수정 시 자동 할당 경로와 명시적 할당 경로 모두 커버 |

### 6.2 의존성 리스크

- `isMemberBusy`, `filterAvailableMembers`는 현재 `ScheduleCalculationService` 내부 private 메서드이므로 외부 영향 없음
- `_beMemberIds`는 `busyMembers + beMembers` 합산으로 구성되므로, 분류가 바뀌어도 다음 프로젝트 계산의 `memberBusyPeriods` 누적에는 영향 없음 (busyMembers도 포함됨)

### 6.3 수정 후 예상 결과 (유즈드 매입 시나리오)

- **수정 전**: beMembers = [송재호], busyMembers = [이재훈, 권동희]
- **수정 후**: beMembers = [송재호(즉시), 권동희(4/25~), 이재훈(5/9~)], busyMembers = []
- beCapacity 합산 시 주의: 즉시 합산 시 2.1이 되어 devEndDate가 4/18~6/9 → 더 짧아질 수 있음
  - 이 경우에도 이재훈의 바쁜 기간 종료(5/9)가 projEstimatedEnd 이전이면 가용으로 분류됨

---

## 7. 참고 사항

### 관련 파일 경로

| 파일 | 경로 |
|------|------|
| 핵심 수정 대상 | `src/main/java/com/timeline/service/ScheduleCalculationService.java` |
| 프론트엔드 | `src/main/resources/static/js/app.js` |
| 일정 계산 규칙 문서 | `docs/schedule-calculation-v2.md` |
| 이전 자동 할당 계획서 | `docs/dev-plan/09-auto-date-calculation.md` |

### 핵심 버그 코드 위치 요약

| 위치 | 라인 번호 | 버그 내용 |
|------|-----------|-----------|
| `isMemberBusy` | 423~434 | `endDate=null` 시 기간 일부 겹침을 "완전 바쁨"으로 판정 |
| 명시적 할당 분리 블록 | 197~209 | 지연 합류 가용 여부 미고려 |
| `getTargetMemberCount` 미호출 | 111~113 | 명시적 할당에서 인원 기준 미적용 → 경고 미생성 |
