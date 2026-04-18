# 일정 계산 고도화 설계

## 개요

프로젝트의 일정을 자동 계산할 때, 명시적으로 할당된 ProjectMember가 없는 경우
프로젝트에 연결된 스쿼드의 멤버 풀에서 가용한 BE 멤버를 자동으로 선택하여 투입하는 로직.

## 전제 조건

- Squad ↔ Member (N:M) 관계가 `squad_member` 테이블로 존재
- Project ↔ Squad (N:M) 관계가 `project_squad` 테이블로 존재
- Project ↔ Member (N:M) 관계가 `project_member` 테이블로 존재 (명시적 할당)

## 계산 흐름

일정 계산은 **프로젝트 sortOrder 순**으로 순차 처리한다.

### Step 1: 프로젝트의 BE 멤버 결정

```
IF 프로젝트에 명시적 ProjectMember 중 BE 멤버가 있으면
    → 기존 로직대로 해당 멤버 사용
ELSE (자동 할당)
    → Step 1-1 ~ 1-4 실행
```

#### Step 1-1: 멤버 풀 구성

프로젝트에 연결된 **모든 스쿼드**의 소속 멤버를 합쳐 하나의 풀로 구성한다.
- 조건: `role = BE`, `active = true`
- 여러 스쿼드에 중복 소속된 멤버는 1명으로 처리 (중복 제거)

#### Step 1-2: 가용 멤버 필터링

풀에서 "바쁜 멤버"를 제외한다.
- 바쁜 조건: 해당 멤버가 참여 중인 **다른 프로젝트의 기간**(startDate ~ launchDate 다음날)과
  현재 프로젝트의 기간이 중첩되는 경우
- 이전 프로젝트 계산에서 **자동 할당**된 멤버도 `memberBusyUntil` 맵에 기록하여 추적
- 판단 기준: **날짜 기반** (프로젝트 status가 아닌 실제 날짜)
- 종료일 = launchDate 다음 영업일

#### Step 1-3: 필요 인원 수 결정

**기간이 지정된 경우** (startDate, endDate 모두 존재):
```
개발완료일 = endDate - QA일수 (영업일 역산)
개발영업일수 = businessDays(startDate, 개발완료일)
필요 capacity = ceil(totalMd / 개발영업일수)
```
→ 가용 멤버를 capacity 높은 순으로 정렬, 누적 capacity가 필요 capacity 이상이 될 때까지 선택

**기간이 미지정인 경우**:

| totalMd | 목표 인원 |
|---------|----------|
| 1~5     | 1명      |
| 6~15    | 2명      |
| 16~30   | 3명      |
| 31+     | 4명      |

→ 가용 멤버를 capacity 높은 순으로 정렬, 목표 인원만큼 선택

#### Step 1-4: 부족 시 처리

**기간 지정됨**: 가용 멤버 전원 투입 + 경고 메시지:
- "BE {N}명 추가 투입 필요"
- "현재 인원({M}명) 기준 예상 론치일: YYYY-MM-DD"

**기간 미지정**: 가용 멤버 전원 투입, 해당 인원으로 론치일 계산 (경고 없음)

### Step 2: 일정 계산 실행

선택된 멤버(명시적 또는 자동)로 기존 계산 로직 실행:
```
beCapacity = 선택 멤버 capacity 합산
devDays = ceil(totalMd / beCapacity)
→ 휴가 보정 (반복 수렴)
→ QA 기간 추가
→ 론치일 계산
```

### Step 3: memberBusyUntil 업데이트

자동 할당된 멤버의 바쁜 기간을 기록한다:
- key: memberId
- value: 프로젝트 론치일 다음 영업일
→ 다음 프로젝트 계산 시 해당 멤버는 "바쁜 멤버"로 처리

## 계산 결과 응답

기존 응답 필드에 추가:
```json
{
  "projectId": 1,
  "projectName": "...",
  "startDate": "...",
  "devEndDate": "...",
  "launchDate": "...",
  "beMembers": [...],
  "autoAssignedMembers": [
    { "id": 10, "name": "홍길동", "capacity": 1.0 }
  ],
  "warnings": [
    "BE 2명 추가 투입 필요. 현재 인원(1명) 기준 예상 론치일: 2026-06-15"
  ]
}
```

## 자동 할당 멤버의 특성

- **임시**: DB에 저장하지 않음 (ProjectMember에 INSERT 하지 않음)
- 계산 결과 화면에서 자동 할당 멤버는 별도 표시 (예: "(자동)" 태그)
- 다음 프로젝트 계산 시 "바쁜 멤버"로 추적됨

## 변경 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `ScheduleCalculationService.java` | 자동 할당 로직 추가, memberBusyUntil 확장 |
| `SquadMemberRepository.java` | 스쿼드별 멤버 조회 쿼리 (이미 존재) |
| `ProjectSquadRepository.java` | 프로젝트별 스쿼드 조회 (이미 존재) |
| `app.js` | 일정 계산 결과에 autoAssignedMembers, warnings 표시 |
