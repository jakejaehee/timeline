# 일정 계산 정책 (Schedule Calculation Policy)

## 1. 기본 원칙 (Principles)

### P1. 순차 계산 원칙
프로젝트 계산은 기본적으로 **sortOrder 순서**를 사용하되, 최종 반영은 **시간축(launchDate) 재계산**을 통해 보정한다.
- 1차 계산: sortOrder 순
- 2차 계산: 1차 결과의 launchDate 시간순
- 목적: 정렬상 뒤 프로젝트라도 시간상 먼저 끝나면 해당 멤버 가용성을 다음 계산에 먼저 반영

### P2. 영업일 원칙
모든 일정은 **영업일 기준**으로 계산한다.
- 영업일 = 평일 - 공휴일
- 시작일, 종료일, 론치일은 반드시 영업일이어야 한다
- 주말/공휴일에 해당하면 **다음 영업일**로 보정한다

### P3. 론치일 포함(Inclusive End) 원칙
멤버의 바쁜 기간 종료일은 **론치일 당일**이다 (exclusive가 아님).
- `period[1] = launchDate` (론치 당일까지 바쁨)
- 가용 시작일 = `getNextBusinessDay(launchDate)` (론치 다음 영업일)

### P4. 현재 시점 보정 원칙
과거 날짜는 계산에 사용하지 않는다.
- 시작일이 과거이면 **today**로 보정
- `estimateProjectStart()`에서도 today 하한 적용

### P5. 명시적 지정 우선 원칙
사용자가 명시적으로 지정한 값은 자동 계산값보다 우선한다.
- 명시적 멤버 할당 > 자동 투입
- 명시적 시작일/종료일 > 자동 계산 일자
- `totalMdOverride` > 태스크 MD 합산
- 특히 고정 일정(`startDate`, `endDate` 모두 지정)은 리소스 최적화보다 우선하며, 자동 계산으로 앞당기거나 늦추지 않는다

### P6. 유휴 리소스 즉시 투입 원칙
자동 계산 일정(시작일/론치일 미지정)에서는 **유효 리소스를 최대한 빠르게 투입**한다.
- 일부 멤버가 바빠도, 투입 후보 중 유휴 멤버가 있으면 프로젝트는 즉시 시작 가능
- 시작일 fallback은 "모든 멤버가 비는 시점(max)"이 아니라 **최조기 가용 시점(min)** 기준

---

## 2. 규칙 체계 (Rules)

### 2.1 프로젝트 분류 규칙

| 우선순위 | 규칙 | 조건 | 처리 |
|---------|------|------|------|
| **R1** | KTLO 제외 | `project.ktlo == true` | skipped, 계산/표시 안 함 |
| **R2** | 미분류 제외 | `project.name == "미분류"` | skipped, 계산/표시 안 함 |
| **R3** | 일반 프로젝트 | 위 조건 미해당 | 정상 계산 |

### 2.2 일정 유형 분류 규칙

| 유형 | 조건 | 특성 |
|------|------|------|
| **고정 일정** (fixedSchedule) | startDate ≠ null AND endDate ≠ null | 시작일/론치일 고정, 기간 부족/여유 경고 |
| **반고정 일정** | startDate ≠ null XOR endDate ≠ null | 지정된 값 사용, 나머지 자동 계산 |
| **자동 일정** | startDate == null AND endDate == null | 시작일/론치일 모두 자동 계산, 유휴 리소스 즉시 투입 |

### 2.3 멤버 할당 규칙

#### R4. 할당 경로 결정
```
IF 프로젝트에 명시적 BE 멤버(ProjectMember)가 있으면
    → 명시적 할당 경로 (autoAssigned = false)
ELSE
    → 자동 투입 경로 (autoAssigned = true)
```

#### R5. 자동 투입 전제 조건
자동 투입은 아래 조건을 **모두** 만족할 때만 실행:
1. 명시적 BE 멤버가 없을 것
2. 스쿼드 멤버 풀이 비어있지 않을 것
3. `totalMd > 0`일 것 (0 MD는 자동 투입 안 함)

#### R6. 스쿼드 멤버 풀 구성
- 프로젝트에 연결된 **모든 스쿼드**의 소속 멤버를 합산
- 필터: `role = BE`, `active = true`
- 여러 스쿼드에 중복 소속 → 1명으로 처리 (중복 제거)

#### R7. 목표 인원 수 결정 (기간 미지정 시)

| totalMd 구간 | 목표 인원 |
|-------------|----------|
| 1 ~ 5 MD | 1명 |
| 6 ~ 15 MD | 2명 |
| 16 ~ 30 MD | 3명 |
| 31+ MD | 4명 |

#### R8. 필요 인원 결정 (기간 지정 시)
```
개발완료일 = endDate - QA일수 (영업일 역산)
개발영업일수 = businessDays(startDate, 개발완료일)
필요 capacity = ceil(totalMd / 개발영업일수)
→ capacity 높은 순 정렬, 누적 capacity ≥ 필요 capacity까지 선택
```

### 2.4 가용성 판정 규칙

#### R9. 바쁜 멤버 판정 (`isMemberBusy`)
멤버가 프로젝트 기간 **전체**에 걸쳐 바쁜지 판단:
```
겹침 = projStart <= period[1](inclusive) AND projEstimatedEnd >= period[0](inclusive)
투입불가 = 겹침 AND period[1] >= projEstimatedEnd
```
- 겹침이 있지만 바쁜 기간이 프로젝트 중간에 끝남 → **지연 합류 가능** (투입불가 아님)
- 겹침이 없음 → 즉시 가용

#### R10. 가용 시작일 계산 (`getMemberAvailableFrom`)
```
겹치는 바쁜 기간 중 가장 늦은 종료일 = latestEnd
IF latestEnd == null → 즉시 가용 (null 반환)
ELSE → getNextBusinessDay(latestEnd) 반환
```

#### R11. 지연 합류 멤버 제외 규칙
자동 투입 경로에서 devEndDate 확정 후:
```
IF lateJoinDate > devEndDate → 해당 멤버 제외
```
개발 기간이 이미 지난 후에야 투입 가능한 멤버는 개발/QA/론치 모두 불참 처리한다.

#### R12. 가용 판단 기준 종료일 (`filterEndDate`)

| 조건 | filterEndDate |
|------|---------------|
| 기간 지정 (startDate & endDate 모두 존재) | `project.getEndDate()` (실제 론치일) |
| 기간 미지정 | `autoEstEnd` = 1명 capacity 기준 최악 상한 종료일 |

### 2.5 바쁜 기간 관리 규칙

#### R13. 바쁜 기간 저장
각 프로젝트 계산 완료 후, 참여 멤버(명시적 + 자동)의 바쁜 기간을 기록:
```
memberBusyPeriods[memberId].add([startDate, launchDate])
// period[1] = 론치일 (inclusive end)
```

#### R14. 바쁜 기간 저장 조건
- `startDate`와 `launchDate`가 **모두 non-null**인 경우에만 저장
- 0 MD 프로젝트 (launchDate = null) → 바쁜 기간 미저장

---

## 3. 계산 방법 (Calculation Methods)

### 3.1 totalMd 계산

```
IF totalMdOverride ≠ null → totalMdOverride 사용
ELSE → 활성 태스크(TODO, IN_PROGRESS)의 manDays 합산
```

### 3.2 개발 기간 계산

#### 기본 공식
```
devDays = ceil(totalMd / beCapacity)
beCapacity = Σ(멤버별 capacity)    // capacity 기본값: 1.0
```

#### 휴가 보정 (반복 수렴, 최대 5회)
```
REPEAT (최대 5회):
  estEnd = calculateEndDate(devStart, devDays)
  lostMd = Σ(각 멤버의 개발기간 내 휴가일 × capacity)
  adjustedMd = totalMd + lostMd
  newDevDays = ceil(adjustedMd / beCapacity)
  IF newDevDays == devDays → BREAK
  devDays = newDevDays
```

### 3.3 시작일(startDate) 결정

```
IF fixedSchedule → project.startDate
ELSE IF project.startDate ≠ null → project.startDate
ELSE IF beMembers 비어있지 않음
    → q = min(beMembers의 queueStartDate)
    → IF q != null THEN startDate = q
      ELSE startDate = min(beMembers별 busyPeriod 기반 가용일)
ELSE (0 MD 등, beMembers 비어있음)
    → memberBusyPeriods에서 스쿼드 멤버 풀의 max(period[1]) 다음 영업일
    → 없으면 today

모든 경우: ensureBusinessDay(startDate) 적용
과거 날짜: today로 보정
```

### 3.4 개발 종료일(devEndDate) 계산

```
devCalcStart = ensureBusinessDay(max(startDate, today))
IF devDays > 0 → devEndDate = calculateEndDate(devCalcStart, devDays)
ELSE → devEndDate = devCalcStart
```

### 3.5 론치일(launchDate) 계산

```
IF fixedSchedule → project.endDate
ELSE IF totalMd == 0 AND endDate == null → null (계산 불가)
ELSE IF endDate ≠ null → endDate
ELSE IF qaEndDate ≠ null → getNextBusinessDay(qaEndDate)
ELSE → getNextBusinessDay(devEndDate)
```

### 3.6 QA 기간 계산

```
qaDays = QA 마일스톤의 days 값

IF project.endDate != null (fixedSchedule 또는 endDate만 지정):
    qaEndDate = launchDate - 1영업일
    qaStartDate = qaFixedStartDate ?? (qaEndDate - (qaDays-1)영업일)
ELSE (endDate 미지정):
    qaStartDate = qaFixedStartDate ?? getNextBusinessDay(devEndDate)
    qaEndDate = calculateEndDate(qaStartDate, qaDays)
```

- endDate가 지정된 모든 경우(fixedSchedule 포함, endDate만 지정된 반고정 일정 포함), QA를 수행할 때
  개발완료 후 QA를 시작해 종료한 뒤 론치일까지 여유일(`N days`)이 남더라도
  **QA 종료일은 항상 `launchDate - 1영업일`**이 되도록 QA 시작일을 역산해 정한다.

### 3.7 기간 부족/여유 경고 (fixedSchedule 전용)

```
remainingBizDays = businessDays(effectiveStart, launchDate)
totalNeededDays = devDays + qaDays
ratio = remainingBizDays / totalNeededDays

IF ratio < 0.7 → "기간 부족" 경고 + 권장 론치일
IF ratio > 2.0 → "기간 여유" 경고 + 앞당길 수 있는 론치일
```

---

## 4. 특수 케이스 처리

### 4.1 0 MD 프로젝트

totalMd가 0인 프로젝트는 공수 미산정 상태를 의미한다.

| 항목 | 처리 |
|------|------|
| 자동 멤버 투입 | 0명 (자동 투입 블록 미진입) |
| 수동 지정 멤버 | 있으면 그대로 표시 |
| devEndDate | `devCalcStart` (=`ensureBusinessDay(max(startDate,today))`) |
| launchDate | null (계산 불가) |
| BE 추가 투입 경고 | 미생성 |
| busy period 갱신 | 미수행 (launchDate = null) |
| 시작일 | 앞 프로젝트 론치 다음 영업일 기반 보정 |
| UI 표시 | 개발 일자 "시작일~", 론치일 "-" |

### 4.2 QA 담당자 중복 감지

```
동일 QA 담당자가 이전 프로젝트 QA 기간과 겹치면:
→ "QA 중복: '{name}'이(가) '{projectName}'의 QA 기간({start}~{end})과 겹칩니다." 경고
```

### 4.3 QA 담당자 ID → 이름 변환

- qaAssignees 필드에 저장된 값이 숫자(멤버 ID)이면 → 이름으로 변환
- 숫자가 아니면(레거시: 이름 직접 저장) → 그대로 사용
- ID가 맵에 없으면(비활성/삭제 멤버) → ID 문자열 그대로 표시 (fallback)

---

## 5. 규칙 우선순위 (Rule Priority)

### 5.1 프로젝트 처리 우선순위
```
1. KTLO 프로젝트 제외 (R1) — 최우선 스킵
2. 미분류 프로젝트 제외 (R2) — 스킵
3. 일반 프로젝트 계산 (R3) — 정상 처리
```

### 5.2 멤버 할당 우선순위
```
1. 명시적 할당 멤버 (R4) — 최우선
2. 자동 투입 전제조건 확인 (R5) — totalMd > 0 필수
3. 스쿼드 멤버 풀 구성 (R6) — BE + active + 중복제거
4. 가용성 필터링 (R9, R10) — isMemberBusy, getMemberAvailableFrom
5. 인원 결정 (R7 or R8) — 기간 유무에 따라 분기
6. 지연 합류 멤버 제외 (R11) — devEndDate 확정 후 적용
```

### 5.3 시작일 결정 우선순위
```
1. project.startDate (명시적 지정) — 최우선
2. min(beMembers.queueStartDate) — 멤버 가용일 기반
3. min(beMembers.availableFromByBusyPeriods) — 유휴 리소스 즉시 투입
4. getNextBusinessDay(max(squadPoolBusyPeriods)) — beMembers 비어있을 때 fallback
5. today — 최후 fallback
→ 모든 경우: ensureBusinessDay() + 과거날짜 보정
```

### 5.4 론치일 결정 우선순위
```
1. fixedSchedule → project.endDate — 고정
2. 0 MD + endDate 없음 → null — 계산 불가
3. project.endDate (명시적 지정) — 우선
4. getNextBusinessDay(qaEndDate) — QA 기간 후
5. getNextBusinessDay(devEndDate) — 개발 완료 후
```

### 5.5 가용성 판단 우선순위
```
1. 바쁜 기간이 프로젝트 전체를 커버 → 투입불가 (busyMember)
2. 바쁜 기간이 프로젝트 중간에 끝남 → 지연 합류 (lateJoin)
3. 바쁜 기간 없음 또는 겹치지 않음 → 즉시 가용
```

---

## 6. 경고 메시지 체계

### 6.1 BE 인원 부족 경고

| 조건 | 메시지 형식 |
|------|------------|
| 기간 지정 + 인원 부족 | `"BE {N}명 추가 투입 필요. 현재 인원({M}명) 기준 예상 론치일: YYYY-MM-DD"` |
| 기간 미지정 + 인원 부족 | `"BE {N}명 추가 투입 필요 (현재 {M}명)"` |

### 6.2 기간 부족/여유 경고 (fixedSchedule 전용)

| 조건 | 메시지 |
|------|--------|
| ratio < 0.7 | `"남은 기간({N}일)이 예상 소요일({M}일)보다 {X}% 부족합니다. → 론치일을 {date}로 변경을 권장합니다."` |
| ratio > 2.0 | `"남은 기간({N}일)이 예상 소요일({M}일) 대비 {X}% 여유가 있습니다. → 론치일을 {date}로 앞당길 수 있습니다."` |

### 6.3 QA 중복 경고

| 조건 | 메시지 |
|------|--------|
| QA 담당자 기간 겹침 | `"QA 중복: '{name}'이(가) '{projectName}'의 QA 기간({start}~{end})과 겹칩니다."` |

---

## 7. UI 표시 규칙

### 7.1 레이블/배지

| 배지 | 조건 | 스타일 |
|------|------|--------|
| `자동` (시작일) | `autoStartDate == true` | `bg-secondary` |
| `자동` (론치일) | `autoLaunchDate == true` | `bg-secondary` |
| `자동` (멤버) | `autoAssigned == true` | `bg-secondary` |

### 7.2 지연 합류 표시
- 멤버명 옆 `(M/DD~)` 형태로 투입 가능일 표시
- 스타일: 주황색 (`text-warning`)

### 7.3 0 MD 프로젝트 표시
- 개발 일자: `"시작일~"` (종료일 미표시)
- 론치일: `"-"` (회색 텍스트)

### 7.4 경고 행
- 배경: `#fff8e1` (연한 노란색)
- 텍스트: `#856404` (갈색)
- BE 투입 경고: 마우스 hover 시 Bootstrap tooltip (MD 구간별 목표 인원 테이블)
- tooltip 테마: `data-bs-theme="dark"`

### 7.5 하단 요약
- 대상: `validItems` = skipped 제외 AND launchDate non-null
- 전체 일정 범위: 첫 시작일 ~ 마지막 론치일
- 총 MD 합산

---

## 8. 데이터 흐름도

```
calculateSchedule(projectIds)
│
├── 공휴일 캐시 로드 (2년치)
├── 멤버 ID→이름 맵 구성 (전체 멤버, 1회 조회)
│
├── 1차 패스: sortOrder 순 계산
│   └── 패스 내부에서 memberBusyPeriods / qaAssigneeBusyPeriods 누적
├── 1차 결과 기준 launchDate 시간순 재정렬
├── 2차 패스: 시간순 재계산 (선행 론치 멤버 가용성 우선 반영)
│   └── 패스 내부에서 동일 규칙으로 busy period 누적
└── 최종 반환: UI 정렬 일관성을 위해 sortOrder 순으로 결과 재배열
```
