# 개발 계획서: QA 인원수 집계 버그 수정 및 QA 중복 경고

## 1. 개요

- **기능 설명**: 일정 계산 결과의 QA 인원수가 항상 0명으로 표시되는 버그를 수정하고, 동일 QA 담당자가 기간이 겹치는 여러 프로젝트에 배정되었을 때 경고를 표시하는 기능을 추가한다.
- **개발 배경 및 목적**:
  - 현재 `ScheduleCalculationService`는 `ProjectMember` 테이블에서 `MemberRole.QA`인 멤버를 조회하여 `qaCount`를 산출하지만, 실제 QA 담당자 정보는 `ProjectMilestone.qaAssignees` (쉼표 구분 문자열) 필드에 별도 관리되고 있어 항상 0명이 집계된다.
  - QA 담당자가 동시에 여러 프로젝트 QA를 진행하면 일정 충돌이 발생할 수 있으나 현재 시스템에서 탐지하지 못하고 있다.
- **작성일**: 2026-04-18

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 일정 계산 결과의 `qaCount` 값은 QA 유형(`MilestoneType.QA`) 마일스톤의 `qaAssignees` 필드에 기록된 담당자 수를 기준으로 산출해야 한다.
- **FR-002**: `qaAssignees`가 null이거나 빈 문자열이면 `qaCount`는 0으로 표시한다.
- **FR-003**: 일정 계산 결과에서 QA 담당자 이름 목록도 기존 `qaMembers` 응답 필드에 반영한다.
- **FR-004**: 동일 QA 담당자(`qaAssignees` 기준 이름 일치)가 기간이 겹치는 다른 프로젝트의 QA 마일스톤에도 배정되어 있으면, 해당 프로젝트의 일정 계산 결과 `warning` 필드에 QA 중복 경고 문구를 추가한다.
- **FR-005**: QA 중복 경고 문구에는 충돌 대상 프로젝트명과 겹치는 QA 담당자 이름이 포함되어야 한다.

### 2.2 비기능 요구사항

- **NFR-001**: `ScheduleCalculationService`의 기존 로직(BE 멤버 계산, 고정/유동 일정 분기 등)을 최소한으로 변경하여 회귀 위험을 줄인다.
- **NFR-002**: QA 중복 검사는 입력된 `projectIds` 리스트 내에서만 수행한다 (전체 프로젝트 대상 전수 검사는 이번 범위 외).
- **NFR-003**: `qaAssignees` 파싱 로직은 별도 private 메서드로 분리하여 재사용성을 확보한다.

### 2.3 가정 사항

- `qaAssignees`는 `"홍길동, 이순신"` 형식의 쉼표 구분 문자열이다 (현재 `ProjectService` 저장 로직 확인).
- QA 담당자 중복 비교는 이름 문자열 기준으로 한다 (Member.id 기반 연결 구조 없음).
- 공백 트림 후 비교한다 (`" 홍길동 "` → `"홍길동"`).
- QA 마일스톤이 여러 개 존재하는 경우 첫 번째 QA 마일스톤(정렬 기준: `sortOrder ASC, startDate ASC`)을 사용한다. 이는 기존 `getQaDays()` 메서드와 동일한 방식이다.
- QA 기간 겹침 비교는 `qaStartDate` ~ `qaEndDate` 범위를 사용한다. 어느 한쪽이 null이면 겹침 없음으로 처리한다.

### 2.4 제외 범위 (Out of Scope)

- 전체 프로젝트 대상 QA 중복 전수 검사 (선택된 projectIds 범위 내에서만 수행).
- `WarningType` enum에 `QA_CONFLICT` 추가 및 `WarningService` 연동 (일정 계산 전용 warning 문자열로만 처리).
- `qaAssignees`를 Member 엔티티와 FK로 연결하는 데이터 모델 변경.
- UI 모달 레이아웃 변경 (기존 `warning` 행 표시 방식 그대로 활용).

---

## 3. 시스템 설계

### 3.1 데이터 모델

신규 엔티티 또는 스키마 변경 없음. 기존 `ProjectMilestone.qaAssignees (VARCHAR 500)` 필드를 파싱하여 사용한다.

**현재 구조 요약:**

| 엔티티 | 필드 | 설명 |
|--------|------|------|
| `ProjectMilestone` | `qaAssignees` | 쉼표 구분 QA 담당자 이름 문자열 (null 가능) |
| `ProjectMilestone` | `type` | `MilestoneType.QA`이면 QA 마일스톤 |
| `ProjectMilestone` | `startDate`, `endDate` | QA 마일스톤 기간 |

### 3.2 API 설계

기존 API를 변경하지 않고 응답 필드 값만 교정한다.

| Method | Endpoint | 설명 | 변경 사항 |
|--------|----------|------|-----------|
| `POST` | `/api/v1/projects/schedule-calculate` | 일정 계산 | `qaCount`, `qaMembers`, `warning` 값 수정 |

**응답 필드 변경 상세:**

현재:
```json
{
  "qaCount": 0,
  "qaMembers": [],
  "warning": null
}
```

수정 후 (예시):
```json
{
  "qaCount": 2,
  "qaMembers": [{"name": "홍길동"}, {"name": "이순신"}],
  "warning": "QA 중복: '홍길동'이(가) '프로젝트B'의 QA 기간(2026-05-01~2026-05-15)과 겹칩니다."
}
```

### 3.3 서비스 계층

#### 변경 대상: `ScheduleCalculationService`

**3.3.1 qaCount/qaMembers 버그 수정**

현재 문제 코드 (`calculateSingleProject` 메서드, 라인 101-104 및 244-247):
```java
// 버그: projectMembers에서 MemberRole.QA를 찾지만 실제 QA 담당자는 qaAssignees 문자열에 있음
List<Member> qaMembers = projectMembers.stream()
    .map(ProjectMember::getMember)
    .filter(m -> m.getRole() == MemberRole.QA && Boolean.TRUE.equals(m.getActive()))
    .collect(Collectors.toList());
```

수정 방향:
- `calculateSingleProject` 내에서 QA 마일스톤 조회 시 `qaAssignees` 문자열도 함께 파싱
- `qaAssignees`를 쉼표로 split하여 이름 목록 생성
- 결과 조립부의 `qaCount`(라인 353)와 `qaMembers`(라인 366)를 파싱된 이름 목록 기준으로 교체

**3.3.2 QA 중복 경고 추가**

`calculateSchedule` 메서드 내에서 멤버 바쁜 기간을 추적하는 기존 패턴과 동일하게:
- 각 프로젝트 결과 조립 후 해당 프로젝트의 QA 기간과 QA 담당자 목록을 별도 Map에 누적
- 후속 프로젝트 계산 시 동일 이름의 QA 담당자가 이미 등록된 QA 기간과 겹치는지 확인
- 겹치면 `warnings` 리스트에 경고 문구 추가

#### 신규 private 메서드

```
parseQaAssigneeNames(String qaAssignees): List<String>
  - qaAssignees 문자열을 쉼표로 split, 각 항목 trim, 빈 문자열 제거 후 반환
  - null 입력 시 빈 리스트 반환

detectQaConflict(
    List<String> qaNames,
    LocalDate thisQaStart,
    LocalDate thisQaEnd,
    Map<String, List<Object[]>> qaAssigneeBusyPeriods
): List<String> (충돌 경고 메시지 목록)
  - qaAssigneeBusyPeriods value 원소는 Object[]{LocalDate start, LocalDate end, String projectName} 형태
  - qaNames 각 이름에 대해 qaAssigneeBusyPeriods에서 기간 조회
  - 기간 겹침 판단: thisQaStart <= period[1] && thisQaEnd >= period[0]
  - 겹치면 "QA 중복: '{이름}'이(가) '{프로젝트명}'의 QA 기간({start}~{end})과 겹칩니다." 형식으로 경고 메시지 생성
```

#### 변경 흐름 (calculateSingleProject 내부)

```
[기존] qaMembers = projectMembers에서 MemberRole.QA 필터
  ↓ 수정
[신규] qaMilestone에서 qaAssignees 파싱 → qaAssigneeNames (List<String>)
       qaCount = qaAssigneeNames.size()
       qaMembers 응답 = qaAssigneeNames.stream().map(name -> Map.of("name", name))

[추가] calculateSchedule에서 QA 중복 추적 Map 관리:
       Map<String, List<Object[]>> qaAssigneeBusyPeriods
       (key: QA 담당자 이름, value: Object[]{qaStartDate, qaEndDate, projectName} 리스트)
       각 프로젝트 계산 후:
         - qaAssigneeNames + (qaStartDate~qaEndDate) + projectName을 Map에 누적
         - 다음 프로젝트 계산 시 detectQaConflict 호출하여 warning에 추가
```

### 3.4 프론트엔드

UI 변경 없음. 기존 `renderScheduleCalcResult` 함수에서 `r.qaCount`와 `r.qaMembers`를 그대로 렌더링하므로 백엔드 데이터가 수정되면 자동 반영된다.

`r.warning`도 기존 방식(경고 행 추가)으로 표시되므로 추가 수정 불필요.

**렌더링 코드 확인 (app.js 라인 7945-7948, 기존 그대로 동작):**
```javascript
html += '<td class="text-center">' + r.qaCount + '명';
if (r.qaMembers && r.qaMembers.length > 0) {
    html += '<br><small class="text-muted">' + r.qaMembers.map(function(m) { return m.name; }).join(', ') + '</small>';
}
```

**주의**: `r.warning`은 `escapeHtml()` 처리 후 HTML에 삽입되므로 `\n`이 줄바꿈으로 렌더링되지 않는다 (app.js 라인 7952-7953). 여러 경고가 누적될 경우 `String.join("\n", warnings)` 대신 `String.join(" / ", warnings)` 또는 단일 경고 문자열로 이어 붙이면 가독성이 유지된다. 기존 BE 인원 부족 경고도 동일 필드를 사용하므로 동일 규칙을 적용한다.

### 3.5 기존 시스템 연동

영향 받는 코드:

| 파일 | 변경 내용 |
|------|-----------|
| `ScheduleCalculationService.java` | `qaMembers` 조회 로직 교체, `parseQaAssigneeNames` 및 `detectQaConflict` 메서드 추가, `calculateSchedule`에 QA 중복 추적 Map 추가 |

영향 없는 코드:
- `WarningService.java` - 별도 Warning 시스템, 이번 범위 외
- `ProjectService.java` - `qaAssignees` 저장 로직 변경 없음
- `ProjectController.java` - 응답 구조 변경 없음 (필드 값만 교정)
- `app.js` / `index.html` - 렌더링 로직 변경 없음

**추가 사항**: `warning` 필드 생성 시 `String.join("\n", warnings)` 대신 `String.join(" / ", warnings)` 사용 필요. `renderScheduleCalcResult`(app.js 라인 7952)에서 `escapeHtml()`로 처리된 문자열을 `<td>` 안에 직접 삽입하므로 `\n`이 줄바꿈으로 렌더링되지 않음.

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `parseQaAssigneeNames` 메서드 추가 | `qaAssignees` 문자열 파싱 유틸 메서드 | 낮음 | - |
| T-02 | `qaMembers` 조회 로직 교체 | `calculateSingleProject` 내 라인 101-104 수정, `qaAssignees` 파싱 결과로 대체 | 낮음 | T-01 |
| T-03 | 결과 조립부 `qaCount`/`qaMembers` 수정 | 라인 353(`qaCount`) 및 라인 366(`qaMembers`) 수정, 파싱된 이름 목록 기반으로 변경 | 낮음 | T-02 |
| T-04 | QA 중복 추적 자료구조 추가 | `calculateSchedule` 내 `Map<String, List<Object[]>> qaAssigneeBusyPeriods` 추가. value 원소는 `Object[]{qaStartDate, qaEndDate, projectName}` | 낮음 | - |
| T-05 | `detectQaConflict` 메서드 추가 | 기간 겹침 판단 및 경고 메시지 생성. 프로젝트명 파라미터 포함 여부 불필요 — 프로젝트명은 value의 세 번째 원소에서 조회 | 중간 | T-01 |
| T-06 | QA 중복 경고 통합 | `calculateSchedule` 루프 내에서 T-04, T-05 연결 | 중간 | T-03, T-04, T-05 |
| T-07 | 수동 테스트 | QA 마일스톤 있는 프로젝트 2개 선택하여 결과 확인 | 낮음 | T-06 |

### 4.2 구현 순서

1. **Step 1 (T-01, T-02, T-03)**: `parseQaAssigneeNames` 추가 및 `calculateSingleProject` 내 `qaMembers` 조회 로직 교체
   - `qaUnavailable` 계산에 사용하는 `qaMembers` 변수(라인 244-247)도 함께 처리 필요
   - **주의**: 라인 244-247의 `qaUnavailable` 계산 로직은 `Member` 객체를 직접 사용하므로, 이름 파싱 방식으로 전환하면 `memberLeaveService` 호출이 불가능해진다. 이 부분은 다음 중 한 방식으로 처리한다:
     - **방안 A (권장)**: `qaAssignees` 이름으로 `MemberRepository`를 통해 `Member` 조회 후 leave 계산 유지
     - **방안 B**: `qaUnavailable`에서 QA 멤버 leave 계산을 제거하고 공휴일만 적용 (단순화)
   - 방안 A와 B의 trade-off를 감안하여 **방안 B(단순화)**를 1차 구현으로 채택. 이름으로 멤버를 조회하는 로직은 복잡성을 높이고 이름 중복 시 오류 가능성이 있음.

2. **Step 2 (T-04, T-05)**: `qaAssigneeBusyPeriods` Map과 `detectQaConflict` 메서드 구현

3. **Step 3 (T-06)**: `calculateSchedule` 루프에 QA 중복 감지 통합

4. **Step 4 (T-07)**: 수동 테스트 및 검증

### 4.3 테스트 계획

**단위 테스트 대상:**
- `parseQaAssigneeNames`: null, 빈 문자열, 단일 이름, 다중 이름, 공백 포함 케이스
- `detectQaConflict`: 겹침 없음, 완전 겹침, 부분 겹침, 일방 null 케이스

**수동 통합 테스트 시나리오:**

| 시나리오 | 조건 | 기대 결과 |
|---------|------|-----------|
| QA 담당자 있음 | QA 마일스톤의 `qaAssignees = "홍길동, 이순신"` | `qaCount=2`, `qaMembers=[{name:"홍길동"},{name:"이순신"}]` |
| QA 담당자 없음 | `qaAssignees = null` 또는 QA 마일스톤 없음 | `qaCount=0`, `qaMembers=[]` |
| QA 중복 없음 | 두 프로젝트 QA 기간 비겹침 | `warning` 없음 |
| QA 중복 있음 | 두 프로젝트 QA 기간 겹침, 동일 담당자 | `warning`에 경고 문구 포함 |
| QA 기간 null | `qaStartDate` 또는 `qaEndDate` null | 중복 검사 스킵, 경고 없음 |

---

## 5. 리스크 및 고려사항

### 기술적 리스크

- **R-01**: `qaUnavailable` leave 계산 단순화(방안 B)로 인해 QA 기간 산출 정확도가 소폭 감소할 수 있다. QA 멤버 개인 휴무가 많은 경우 `qaEndDate`가 실제보다 짧게 계산될 수 있다. 향후 `qaAssignees`를 Member FK로 연결하는 데이터 모델 개선 시 해소 가능하다.
- **R-02**: `qaAssignees` 이름 파싱은 문자열 기반이므로 이름 오타나 형식 불일치(`"홍 길동"` vs `"홍길동"`)가 있으면 QA 중복 감지 누락이 발생할 수 있다. 현재 저장 로직에서 trim만 하므로 내부 공백은 그대로 유지됨에 주의.

### 의존성 리스크

- **R-03**: `calculateSchedule` 메서드에 `qaAssigneeBusyPeriods` Map이 추가되면 프로젝트 처리 순서에 따라 경고 발생 여부가 달라진다. 즉, 먼저 처리된 프로젝트는 경고를 받지 않고 나중에 처리된 프로젝트만 경고를 받는다. 이는 현재 `memberBusyPeriods` Map의 동작 방식과 동일하며 허용 가능한 동작으로 판단.

### 대안 및 완화 방안

- **R-01 완화**: 계획서 범위 밖이지만, 추후 `qaAssignees`를 `ProjectMilestoneQaAssignee` 조인 테이블로 정규화하고 Member FK로 연결하면 leave 계산을 정확하게 할 수 있다.
- **R-03 완화**: 양방향 중복 감지(처리 완료된 프로젝트 결과에 소급 경고)는 구현 복잡도가 높아 이번 범위 외. 사용자에게 "선택 순서에 따라 경고 발생 프로젝트가 달라질 수 있음"을 문서화.

---

## 6. 참고 사항

### 관련 기존 코드 경로

- `ScheduleCalculationService.java`: `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/service/ScheduleCalculationService.java`
  - `calculateSchedule()` 메서드: 라인 37-88 (projectIds 루프, memberBusyPeriods 관리)
  - `calculateSingleProject()` 메서드: 라인 89-375
  - 현재 버그 위치: 라인 101-104 (`qaMembers` 조회), 라인 353 (`qaCount` 응답 조립), 라인 366 (`qaMembers` 응답 조립)
  - `qaUnavailable` 루프: 라인 244-247 (방안 B 채택 시 삭제 또는 빈 Set 유지)
  - `getQaDays()` 메서드: 라인 486-492 (QA 마일스톤 조회 패턴 참고)
- `ProjectMilestone.java`: `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/domain/entity/ProjectMilestone.java`
  - `qaAssignees` 필드: 라인 48-49
- `MilestoneType.java`: `/Users/jakejaehee/project/timeline/src/main/java/com/timeline/domain/enums/MilestoneType.java`
  - `QA` 값: 라인 11
- `app.js`: `/Users/jakejaehee/project/timeline/src/main/resources/static/js/app.js`
  - `renderScheduleCalcResult()` 함수: 라인 7905-7969
  - `qaCount` 렌더링: 라인 7945
  - `qaMembers` 렌더링: 라인 7946-7948

### 핵심 버그 재현 조건

1. QA 마일스톤(`type = QA`)에 `qaAssignees = "홍길동"` 설정
2. 해당 프로젝트를 일정 계산 → `qaCount: 0` 으로 표시됨
3. 원인: `ProjectMember` 테이블에 `MemberRole.QA` 멤버가 없어서
