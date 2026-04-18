# 일정 계산 종합 정리

## 1. 일정 계산 개요

프로젝트 일정을 계산할 때 기본 정렬은 `sortOrder`를 사용하되, 멤버 가용성은 **멤버별 busy period**로 독립 추적한다. 따라서 정렬상 뒤 프로젝트라도 투입 멤버가 비어 있으면 앞 프로젝트 론치를 기다리지 않고 동시(또는 더 이른 시점) 시작할 수 있다.

### 1.1 핵심 구조

```
ScheduleCalculationService.calculateSchedule()
  ├── 1차: 프로젝트 목록을 sortOrder 순으로 계산
  ├── 2차: 1차 결과의 launchDate 시간순으로 재계산 (시간상 선행 론치 우선 반영)
  ├── KTLO / 미분류 프로젝트 → skipped 처리 (결과 화면에 미표시)
  ├── calculateSingleProject() 호출
  │   ├── Step 1: BE 멤버 결정 (명시적 할당 or 자동 투입)
  │   ├── Step 2: 일정 계산 (devDays, devEndDate, QA, launchDate)
  │   └── Step 3: 결과 조립 (응답 Map 반환)
  └── memberBusyPeriods 갱신 (다음 프로젝트 계산에 반영)
```

### 1.2 전제 조건

- Squad ↔ Member (N:M) 관계: `squad_member` 테이블
- Project ↔ Squad (N:M) 관계: `project_squad` 테이블
- Project ↔ Member (N:M) 관계: `project_member` 테이블 (명시적 할당)

---

## 2. BE 멤버 결정 로직

### 2.1 경로 분기

```
IF 프로젝트에 명시적 ProjectMember 중 활성(active) BE 멤버가 있으면
    → 명시적 할당 경로 (autoAssigned = false)
ELSE (활성 BE 없음 또는 ProjectMember 자체 없음)
    → 자동 투입 경로 (autoAssigned = true)
```

### 2.2 명시적 할당 경로 (autoAssigned = false)

1. 명시적 BE 멤버 중 "바쁜 멤버"를 분리 (`isMemberBusy` 판정)
2. 바쁜 기간이 `projEstimatedEnd`까지 이어지는 멤버 → `busyMembers`
3. 바쁜 기간이 도중에 끝나는 멤버 → `beMembers`에 포함 (지연 합류)
4. 지연 합류 멤버의 `availableFrom` (가용 시작일) 계산
5. **기간 미지정**(startDate == null AND endDate == null)이고 totalMd > 0인 경우:
   가용 인원이 목표 미달 시 경고 메시지 생성 (`"BE {N}명 추가 투입 필요 (현재 {M}명)"`)

### 2.3 자동 투입 경로 (autoAssigned = true)

1. 프로젝트에 연결된 **모든 스쿼드**의 소속 멤버를 합쳐 풀(pool) 구성
   - 조건: `role = BE`, `active = true`, 중복 제거
2. **풀이 비어있지 않고 totalMd > 0인 경우만** 자동 투입 실행 (0 MD는 건너뜀)
3. `filterAvailableMembers()`로 가용 멤버 필터링 (`isMemberBusy` 기반)
4. 기간 지정 여부에 따라 인원 결정:

#### 기간 지정 프로젝트 (startDate, endDate 모두 존재)

```
개발완료일 = endDate - QA일수 (영업일 역산)
개발영업일수 = businessDays(startDate, 개발완료일)
필요 capacity = ceil(totalMd / 개발영업일수)
→ capacity 높은 순 정렬, 누적 capacity ≥ 필요 capacity까지 선택
```

- `filterEndDate = project.getEndDate()` (실제 론치일 기준)
- 예외: `개발영업일수 <= 0`이면 필요 capacity 계산을 생략하고 가용 멤버 전원을 선택

#### 기간 미지정 프로젝트

| totalMd | 목표 인원 |
|---------|----------|
| 1~5     | 1명      |
| 6~15    | 2명      |
| 16~30   | 3명      |
| 31+     | 4명      |

- `filterEndDate = 1명 기준 최악 상한 종료일 (autoEstEnd)`
- 가용 멤버를 capacity 높은 순으로 정렬, 목표 인원만큼 선택

5. 자동 투입 멤버의 지연 합류일(`lateJoinDates`) 계산
6. **devEndDate 확정 후**: `lateJoinDate > devEndDate`인 멤버는 제외
   - 개발 기간이 이미 지난 후에야 투입 가능한 멤버는 개발/QA/론치 모두 불참

### 2.4 부족 시 처리 (경고)

#### 자동 투입 경로 (autoAssigned = true)

**기간 지정**: 필요 capacity까지 멤버 선택, 부족 시 가용 멤버 전원 투입 + 경고:
- `"BE {N}명 추가 투입 필요. 현재 인원({M}명) 기준 예상 론치일: YYYY-MM-DD"`

**기간 미지정**: 가용 멤버 중 목표 인원만큼 선택 (`min(targetCount, available)`), **경고 없음**

#### 명시적 할당 경로 (autoAssigned = false)

**기간 미지정**(startDate == null AND endDate == null): 가용 인원이 목표 인원 미달 시 경고:
- `"BE {N}명 추가 투입 필요 (현재 {M}명)"`

**기간 지정** (fixedSchedule): 별도 기간 부족/여유 경고 (4.5절 참고)

### 2.5 `projEstimatedEnd` 기준일 정의

- `isMemberBusy()`/`getMemberAvailableFrom()`의 종료 기준은 `projEstimatedEnd`
- 자동 투입 경로:
  - 기간 지정: `projEstimatedEnd = project.endDate` (실제 론치일)
  - 기간 미지정: `projEstimatedEnd = autoEstEnd` (1명 기준 최악 상한 종료일)
- 명시적 할당 경로:
  - 기간 지정: `projEstimatedEnd = project.endDate`
  - 기간 미지정: `projEstimatedEnd = 1명 기준 추정 종료일`

---

## 3. 가용 멤버 판정 로직

### 3.1 `isMemberBusy(memberId, projStart, projEstimatedEnd, memberBusyPeriods)`

멤버가 `projStart ~ projEstimatedEnd` 구간 동안 **투입 불가인지** 판단한다.

```java
// period[0] = 바쁜 기간 시작일, period[1] = 론치일 (inclusive end)
boolean overlaps = !projStart.isAfter(period[1]) && !projEstimatedEnd.isBefore(period[0]);
// projStart <= period[1] AND projEstimatedEnd >= period[0] → 겹침

if (overlaps && !period[1].isBefore(projEstimatedEnd)) {
    // 바쁜 기간이 프로젝트 예상 종료일 이후까지 이어지면 → 투입불가
    return true;
}
```

- **겹침이 있지만** 바쁜 기간이 프로젝트 중간에 끝나면 → **지연 합류 가능** (투입불가 아님)
- **겹침이 없으면** → 즉시 가용

### 3.2 `getMemberAvailableFrom(memberId, projStart, projEstimatedEnd, memberBusyPeriods, holidays)`

멤버의 **실제 가용 시작일**을 반환한다.

```java
// 겹치는 바쁜 기간 중 가장 늦은 종료일(period[1])을 찾음
LocalDate latestEnd = max(겹치는 period[1] 값들);

if (latestEnd == null) return null;                    // 겹치는 기간 없음 → 즉시 가용
return getNextBusinessDay(latestEnd, holidays);         // 론치일 다음 영업일이 가용 시작일
```

### 3.3 Busy Period 의미론 (inclusive end)

```
period[0] = 프로젝트 시작일 (개발 시작일)
period[1] = 프로젝트 론치일 (inclusive, 론치 당일까지 바쁨)
→ 가용 시작일 = getNextBusinessDay(론치일) = 론치 다음 영업일
```

**중요**: `period[1]`은 론치일 자체를 저장한다 (exclusive end가 아님). 이전에 `getNextBusinessDay(launchDate)`를 저장하여 off-by-one 에러가 발생했던 문제가 수정되었다.

---

## 4. 일정 계산 실행

### 4.1 개발 기간 계산

```
beCapacity = 선택 멤버 capacity 합산
devDays = ceil(totalMd / beCapacity)
→ 휴가 보정 (반복 수렴, 최대 5회):
    estEnd = calculateEndDate(devStart, devDays)
    lostMd = Σ(각 멤버의 개발기간 내 휴가일 × capacity)
    adjustedMd = totalMd + lostMd  (lost MD를 가산)
    devDays = ceil(adjustedMd / beCapacity)
    → 값이 수렴할 때까지 반복
→ devEndDate = calculateEndDate(devCalcStart, devDays)
    // devCalcStart = ensureBusinessDay(max(startDate, today))
```

### 4.2 시작일(startDate) 결정

#### 기간 지정 프로젝트
- `startDate = project.getStartDate()` (DB에 저장된 값, 그대로 반환)
- 실제 개발 계산 기준일(`devCalcStart`)만 과거일 경우 today로 보정 (startDate 자체는 변경하지 않음)

#### 기간 미지정 프로젝트
- `startDate = earliestMemberStart` (멤버의 queueStartDate 최솟값)
- `earliestMemberStart`가 null인 경우 (0 MD 등 beMembers가 비어있는 경우):
  - **우선** `memberBusyPeriods`에서 실제 투입 대상 `beMembers`별 가용 시작일을 계산
  - 그중 **가장 빠른 가용일(min)**을 startDate로 사용 (인력 활용 최적화)
  - 값이 없고 `beMembers`가 비어있으면(0 MD 등) 기존처럼 스쿼드 멤버 풀 기준 최대 종료일 다음 영업일 사용 (없으면 today)
- 결과적으로 정렬상 뒤 프로젝트라도 투입 멤버 중 유휴 인력이 있으면 앞 프로젝트 론치를 기다리지 않고 시작 가능
- 비가용일(주말/공휴일) 보정: `ensureBusinessDay(startDate, holidays)`

### 4.3 론치일(launchDate) 계산

```
IF fixedSchedule (startDate & endDate 모두 지정)
    launchDate = project.getEndDate()
ELSE IF totalMd == 0 && endDate == null
    launchDate = null  (계산 불가)
ELSE IF endDate 지정
    launchDate = endDate
ELSE
    launchDate = devEndDate + QA기간 이후 다음 영업일
```

### 4.4 QA 기간

- 마일스톤의 QA 일수(`qaDays`)를 사용
- QA 담당자(`qaAssignees`)는 멤버 ID → 이름으로 변환하여 표시
- QA 충돌 감지: 동일 QA 담당자가 다른 프로젝트의 QA 기간과 겹치면 경고

#### fixedSchedule (역산 방식)
```
qaEndDate = launchDate - 1영업일
qaStartDate = qaFixedStartDate ?? (qaEndDate - (qaDays-1)영업일)
```
- `qaDays <= 0` 또는 `qaDays == null`이면 QA 기간 계산 자체를 스킵 (`qaStartDate`, `qaEndDate` 모두 null)

#### non-fixedSchedule (순산 방식)
```
qaStartDate = ensureBusinessDay(qaFixedStartDate) ?? getNextBusinessDay(devEndDate)
qaEndDate = calculateEndDate(qaStartDate, qaDays)
```
- qaFixedStartDate가 있으면 `ensureBusinessDay()` 비가용일 보정 후 사용
- `qaDays <= 0` 또는 `qaDays == null`이면 QA 기간 계산 자체를 스킵 (`qaStartDate`, `qaEndDate` 모두 null)

### 4.5 기간 부족/여유 경고 (fixedSchedule 전용)

fixedSchedule에서 남은 영업일과 예상 소요일을 비교하여 경고를 생성한다.

```
remainingBizDays = businessDays(effectiveStart, launchDate)
totalNeededDays = devDays + qaDays
ratio = remainingBizDays / totalNeededDays

IF ratio < 0.7 → "남은 기간({N}일)이 예상 소요일({M}일)보다 {X}% 부족합니다. → 론치일을 {date}로 변경을 권장합니다."
IF ratio > 2.0 → "남은 기간({N}일)이 예상 소요일({M}일) 대비 {X}% 여유가 있습니다. → 론치일을 {date}로 앞당길 수 있습니다."
```
- `totalNeededDays <= 0`이면 ratio 계산/경고 생성을 생략

### 4.6 totalMd 계산

```
IF project.totalMdOverride ≠ null → totalMdOverride 사용 (수동 지정 우선)
ELSE → 활성 태스크(TODO, IN_PROGRESS)의 manDays 합산
```

---

## 5. 프로젝트 간 데이터 전달

### 5.1 memberBusyPeriods 갱신

`calculateSchedule()` 루프에서 각 프로젝트 계산 완료 후:

```java
// 자동 투입 + 명시적 할당 멤버 모두의 busy period를 갱신
for (각 beMembers + busyMembers의 멤버 ID) {
    memberBusyPeriods.get(memberId).add(new LocalDate[]{startDate, launchDate});
    // period[1] = 론치일 (inclusive)
}
```

- launchDate가 null인 경우 (0 MD) → busy period 추가하지 않음
- 다음 프로젝트 계산 시 해당 멤버는 "바쁜 멤버"로 추적됨

### 5.2 qaAssigneeBusyPeriods 갱신

QA 담당자별 바쁜 기간도 동일하게 프로젝트 간 전달되어 중복 감지에 사용된다.

---

## 6. 0 MD 프로젝트 처리

totalMd가 0인 프로젝트는 "공수 산정 미완료"를 의미한다.

| 항목 | 처리 |
|------|------|
| 자동 멤버 투입 | 0명 (자동 투입 블록 진입 안 함) |
| 수동 지정 멤버 | 있으면 그대로 표시 |
| 개발 종료일 | devCalcStart (= ensureBusinessDay(max(startDate, today))). devDays=0이므로 `devEndDate = devCalcStart` (startDate가 과거면 startDate와 다를 수 있음) |
| 론치일 | null (계산 불가) |
| BE 추가 투입 경고 | 미생성 |
| busy period 갱신 | 미수행 (launchDate = null) |
| UI 표시 | 개발 일자 "시작일~", 론치일 "-" |
| 시작일 | 앞 프로젝트 론치 다음 영업일 기반 보정 |

---

## 7. 스킵 대상 프로젝트

| 프로젝트 유형 | 스킵 조건 | 처리 |
|--------------|----------|------|
| KTLO | `project.ktlo == true` (Boolean 필드) | `skipped: true`, 결과 화면 미표시 |
| 미분류 | `"미분류".equals(project.getName())` | `skipped: true`, 결과 화면 미표시 |

---

## 8. 일정 계산 결과 응답

### 8.1 프로젝트별 응답 필드

```json
{
  "projectId": 1,
  "projectName": "유즈드 매입",
  "totalMd": 24,
  "fixedSchedule": false,
  "autoStartDate": true,
  "autoLaunchDate": true,
  "startDate": "2026-05-19",
  "devEndDate": "2026-06-05",
  "devDays": 14,
  "launchDate": "2026-06-09",
  "beMembers": [
    { "name": "송재호", "capacity": 0.7 },
    { "name": "이재훈", "capacity": 0.7 },
    { "name": "권동희", "capacity": 0.7, "availableFrom": "2026-05-26" }
  ],
  "autoAssignedMembers": [
    { "id": 10, "name": "송재호", "capacity": 0.7 }
  ],
  "qaMembers": [{ "name": "김철수" }],
  "qaStartDate": "2026-06-08",
  "qaEndDate": "2026-06-12",
  "qaCount": 1,
  "qaDays": 5,
  "beCount": 3,
  "beCapacity": 2.1,
  "taskCount": 5,
  "warning": "...",
  "_beMemberIds": [10, 15, 12]
}
```

> **참고**: `beMembers`에는 `id` 없음 (`name`, `capacity`, 선택적 `availableFrom`). `autoAssignedMembers`에만 `id` 포함.
> `_beMemberIds`는 내부용 필드로 beMembers + busyMembers의 ID 목록 (busy period 갱신에 사용).

### 8.2 주요 필드 설명

| 필드 | 설명 |
|------|------|
| `fixedSchedule` | startDate & endDate 모두 지정됨 |
| `autoStartDate` | !fixedSchedule && project.startDate == null (시작일 자동 계산) |
| `autoLaunchDate` | !fixedSchedule && project.endDate == null (론치일 자동 계산) |
| `availableFrom` | beMembers 내 지연 합류 멤버의 가용 시작일 (없으면 필드 자체 미포함 = 프로젝트 시작일부터 가용) |
| `autoAssignedMembers` | 자동 투입된 멤버 목록 (비어있으면 필드 미포함) |
| `busyMembers` | 명시적 할당 경로에서 바쁜 멤버 목록 (비어있으면 필드 미포함) |
| `qaStartDate` | QA 시작일 (qaDays 없으면 null) |
| `qaEndDate` | QA 종료일 (qaDays 없으면 null) |
| `beCount` | beMembers 수 |
| `beCapacity` | beMembers capacity 합산 |
| `_beMemberIds` | 내부용: beMembers + busyMembers의 ID 목록 (busy period 갱신에 사용) |
| `skipped` | KTLO/미분류 skipped 결과에만 존재 (일반 프로젝트에는 미포함) |

---

## 9. 일정 계산 결과 화면 (UI)

### 9.1 테이블 컬럼

| 컬럼 | 내용 |
|------|------|
| 프로젝트 | 프로젝트명 (레이블 없음) |
| MD | totalMd |
| 개발 | 시작일-종료일 Nd (자동 계산이면 시작일에 `자동` 배지) |
| QA | QA시작일-QA종료일 Nd |
| 론치일 | 론치일 (자동 계산이면 `자동` 배지) |
| BE | 멤버 목록 (capacity, 자동투입 표시, 지연합류일 표시) |
| QA | QA 담당자 수 |

### 9.2 특수 표시

- **`자동` 배지** (`bg-secondary`): 시작일/론치일이 자동 계산된 경우
- **자동 투입 멤버**: `자동` 배지 표시
- **지연 합류 멤버**: `(M/DD~)` 형태로 투입 가능일 표시 (주황색)
- **0 MD 프로젝트**: 개발 일자 "시작일~", 론치일 "-"
- **KTLO/미분류**: 결과에 미표시

### 9.3 경고 행

- 노란 배경(`#fff8e1`) + 갈색 텍스트(`#856404`)
- BE 추가 투입 경고에 마우스 hover 시 **Bootstrap tooltip**으로 근거 기준표 표시
  - tooltip: `data-bs-theme="dark"` (다크 테마)
  - 기준표: totalMd 구간별 목표 인원 테이블
- 경고 종류:
  - BE 추가 투입 필요 (+ 예상 론치일)
  - QA 중복 충돌
  - 기간 여유/부족 알림
- 표시 조건 메모:
  - 자동 투입 + 기간 미지정의 BE 인원 부족은 경고를 생성하지 않음
  - 명시적 할당 + 기간 미지정의 BE 인원 부족만 경고 생성

### 9.4 하단 요약

- `validItems` 기준 (skipped 제외, launchDate null 제외)
- 전체 일정 범위: 첫 시작일 ~ 마지막 론치일
- 총 MD 합산

---

## 10. 수정 이력 (버그 수정 및 개선)

### 10.1 #39 - 멤버 자동 투입 로직 버그 수정
- `isMemberBusy`가 "일부 겹침"을 "완전 바쁨"으로 오판 → 지연 합류 개념 도입
- `projEstimatedEnd` 파라미터 추가로 정확한 겹침 판단

### 10.2 #40 - 시작일 및 자동 투입 필터링 버그
- 기간 지정 프로젝트의 `filterEndDate`가 autoEstEnd(최악 상한)를 사용 → `project.getEndDate()` (실제 론치일)로 수정
- 기간 미지정 `startDate`에 `ensureBusinessDay()` 보정 추가

### 10.3 #41 - QA 담당자 ID→이름 표시
- `parseQaAssigneeNames()`에 `memberIdToName` 맵 전달, ID→이름 변환
- `MemberRepository` 주입 추가, `findAll()` 1회 조회 (비활성/삭제 멤버도 이름 표시 가능)

### 10.4 #42 - 일정 계산 결과 UI 개선
- KTLO 행 숨김 (기존 회색 배경 → 완전 제거)
- '고정' 레이블 삭제
- '자동' 배지 추가 (`autoStartDate`, `autoLaunchDate` boolean)

### 10.5 #43 - 자동 투입 busy period 및 지연 합류 표시
- 자동 투입 경로에도 `lateJoinDates` 계산 추가
- `estimateProjectStart()`에 today 하한 보정
- 명시적 할당 경로의 `projStartForFilter`에도 과거 날짜 보정

### 10.6 #44 - BE 투입 경고 툴팁
- BE 추가 투입 필요 경고에 Bootstrap tooltip으로 기준표 표시
- Bootstrap allowList 확장 (table 태그), `data-bs-theme="dark"`

### 10.7 #45 - 0 MD 프로젝트 처리 및 busy period 갱신
- `totalMd > 0` 조건으로 0 MD 자동 투입 차단
- 0 MD: launchDate = null, devEndDate = devCalcStart(시작일과 동일), 자동 투입 0명
- 프론트엔드: "시작일~" 표시, 론치일 "-"

### 10.8 #46 - 미분류 제외, 0 MD 시작일, 지연 멤버 제외, 색상
- '미분류' 프로젝트 skipped 처리
- 0 MD 시작일: memberBusyPeriods에서 스쿼드 멤버 바쁜 기간 최대 종료일 다음 영업일
- `lateJoinDate > devEndDate` 멤버 자동 투입 제외 (개발 불참 → QA/론치도 불참)
- 경고 색상 `#856404`, tooltip `data-bs-theme="dark"`

### 10.9 #47 - 시작일 off-by-one 수정
- **핵심**: `period[1]`을 `getNextBusinessDay(launchDate)` (exclusive) → `launchDate` (inclusive)로 변경
- `isMemberBusy()`: `projStart.isBefore(period[1])` → `!projStart.isAfter(period[1])`
- `getMemberAvailableFrom()`: 즉시가용 조건 `<=` → `<`, 반환값에 `getNextBusinessDay()` 적용
- NPE 방지: 겹치는 바쁜 기간이 없는 경우 null 체크

### 10.10 #48 - 동시 시작 규칙 반영 (투입 멤버 기준 시작일)
- 기간 미지정 시작일 fallback에서 스쿼드 전체가 아니라 실제 투입 `beMembers`의 바쁜 기간을 우선 반영
- 정렬상 뒤 프로젝트라도 투입 멤버가 가용하면 앞 프로젝트 론치를 기다리지 않고 시작 가능

### 10.11 #49 - 인력 활용 최적화 (최조기 가용 인력 우선 시작)
- 기간 미지정 시작일 fallback을 "투입 멤버 중 가장 늦은 종료일" 기준에서 "투입 멤버 중 가장 빠른 가용일(min)" 기준으로 변경
- 일부 멤버가 다른 프로젝트에 묶여 있어도 유휴 멤버가 있으면 프로젝트를 즉시 시작하도록 개선

---

## 11. 핵심 비즈니스 규칙 요약

1. **기본 정렬은 sortOrder, 가용성은 멤버별 독립 추적** — 정렬상 뒤 프로젝트도 투입 멤버가 가용하면 앞 프로젝트 론치 전 시작 가능
2. **시작일은 투입 멤버 중 최조기 가용일(min) 우선** — 일부 멤버가 바빠도 유휴 멤버가 있으면 즉시 시작
3. **멤버는 론치일까지 바쁨** (inclusive) — 다음 프로젝트는 론치 다음 영업일부터 참여 가능
4. **자동 투입은 totalMd > 0인 경우만** — 0 MD는 공수 미산정으로 자동 투입 안 함
5. **개발 기간 후 투입 가능 멤버는 제외** — lateJoinDate > devEndDate면 개발/QA/론치 모두 불참
6. **시작일은 비가용일 불가** — 주말/공휴일이면 다음 영업일로 보정
7. **KTLO/미분류는 계산 제외** — 결과 화면에 미표시
8. **수동 지정 멤버는 0 MD에서도 표시** — 자동 투입만 차단, 수동은 유지
9. **QA 담당자는 이름으로 표시** — ID→이름 변환, 레거시 데이터 fallback
