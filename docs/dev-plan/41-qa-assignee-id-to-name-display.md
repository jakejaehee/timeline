# 개발 계획서: QA 담당자 ID→이름 표시 변경

## 1. 개요

- **기능 설명**: 일정 계산 결과 모달의 QA 컬럼과 경고 메시지(warnings)에서 QA 담당자가 멤버 ID 숫자값으로 표시되는 문제를 이름으로 변경
- **개발 배경**: `project_milestone.qa_assignees` 컬럼에 멤버 ID 콤마 구분 문자열(`"3,7,12"`)로 저장되어 있으나, 백엔드 `ScheduleCalculationService`가 이 값을 이름으로 변환하지 않고 그대로 파싱하여 응답에 포함시키는 구조적 문제
- **작성일**: 2026-04-18

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 일정 계산 결과 모달의 QA 컬럼에 QA 담당자를 ID가 아닌 이름으로 표시한다
- FR-002: 일정 계산 결과 경고 메시지(`QA 중복: 'X'이(가) ...`) 안의 QA 담당자도 이름으로 표시한다
- FR-003: QA 담당자가 없는 경우(빈 문자열, null) 기존 동작("-" 또는 0명)을 유지한다
- FR-004: 멤버 ID가 DB에서 조회되지 않는 경우(고아 데이터) graceful fallback 처리한다

### 2.2 비기능 요구사항

- NFR-001: 기존 일정 계산 응답 구조(`qaMembers`, `qaCount`, `warning` 필드)를 유지한다
- NFR-002: 추가 N+1 쿼리 없이 한 번의 멤버 조회로 처리한다

### 2.3 가정 사항

- `qa_assignees` 컬럼에는 멤버 ID가 저장되어 있다 (마일스톤 편집 화면에서 `addQaAssignee(msId, memberId)` 호출 시 ID를 저장)
- 단, 과거에 이름으로 저장된 레코드가 혼재할 수 있다 (숫자 파싱 실패 시 원본 값 유지로 대응)
- `ScheduleCalculationService`에 `MemberRepository` 의존성이 없으므로 추가해야 한다

### 2.4 제외 범위 (Out of Scope)

- DB 마이그레이션: 기존에 이름으로 저장된 레코드를 ID로 변환하는 작업 (백엔드 fallback 로직으로 대응)
- 프론트엔드 마일스톤 편집 화면: 이미 `_msAllMembers` 캐시를 통해 이름으로 올바르게 표시되고 있음 (수정 불필요)

---

## 3. 원인 분석

### 3.1 데이터 흐름

```
[마일스톤 편집 화면]
  addQaAssignee(msId, memberId)
    → PUT /api/v1/projects/{id}/milestones/{msId}
    → body: { qaAssignees: "3,7,12" }  ← 멤버 ID 저장

[project_milestone 테이블]
  qa_assignees 컬럼: "3,7,12"  ← ID 문자열

[일정 계산 실행]
  POST /api/v1/projects/schedule-calculate
    → ScheduleCalculationService.calculateSchedule()
    → (루프 내) calculateSingleProject()
    → parseQaAssigneeNames(qaMilestone.getQaAssignees())
      = "3,7,12".split(",") → ["3", "7", "12"]  ← ID 그대로 반환
    → qaAssigneeNames = ["3", "7", "12"]

[응답 조립]
  result.put("qaMembers",
    qaAssigneeNames.stream()
      .map(name -> Map.of("name", name))  ← "name": "3" (ID)
      .collect(...)
  )
  detectQaConflict(["3","7","12"], ...)
    → "QA 중복: '3'이(가) ..."  ← 경고도 ID

[프론트엔드 renderScheduleCalcResult()]
  r.qaMembers.map(m => m.name)  → ["3", "7", "12"]  (ID 표시됨)
  r.warning → "QA 중복: '3'이(가) ..."  (경고도 ID)
```

### 3.2 문제 발생 지점

| 위치 | 파일 | 라인 | 현상 |
|------|------|------|------|
| 백엔드 파싱 | `ScheduleCalculationService.java` | 648-656 | `parseQaAssigneeNames()`가 ID 문자열을 이름으로 변환하지 않음 |
| 백엔드 경고 | `ScheduleCalculationService.java` | 683-684 | `detectQaConflict()`가 이름 대신 ID를 경고 문자열에 사용 |
| 응답 조립 | `ScheduleCalculationService.java` | 426 | `qaMembers`에 ID가 name 필드로 들어감 |

### 3.3 프론트엔드 마일스톤 편집 화면 (정상 동작 확인)

`loadProjectMilestones()` 함수(app.js:3996, QA 담당자 파싱은 라인 4036~4039)에서는 `_msAllMembers` 캐시를 사용하여 ID→이름 변환을 올바르게 처리하고 있음. 이 부분은 수정 불필요.

```javascript
// app.js:4036-4039 (정상 동작)
var qaIds = ms.qaAssignees ? ms.qaAssignees.split(',').filter(function(s) { return s.trim(); }) : [];
var qaNames = qaIds.map(function(id) {
    var m = (_msAllMembers || []).find(function(mm) { return String(mm.id) === id.trim(); });
    return m ? m.name : id;  // ID로 멤버 찾아 이름 반환
});
```

### 3.4 경고 메시지 warningText 렌더링 현황

`renderScheduleCalcResult` (app.js:7954-7955)에서는 다음 순서로 경고 문자열을 처리함:

```javascript
// app.js:7954-7955
var warningText = escapeHtml(r.warning).replace(/(\d{4}-\d{2}-\d{2})/g, function(m) { return formatDateShort(m); });
html += '...' + escapeHtml(r.projectName) + ': ' + warningText + '...';
```

- `warningText`는 `escapeHtml(r.warning)` 후 날짜 포맷 변환만 적용한 문자열
- 최종 삽입 시 `warningText`는 이미 escape된 상태이므로 추가 escape 없이 그대로 연결
- XSS 위험 없이 동작하며 현재 코드는 올바르게 작성되어 있음 (warningText 자체는 한 번만 escape)
- 단, `parseQaAssigneeNames()`가 ID를 이름으로 변환하면 경고 문자열 내 이름도 자동으로 반영됨 (`detectQaConflict()`는 이미 변환된 이름 리스트를 받으므로 별도 수정 불필요)

---

## 4. 시스템 설계

### 4.1 수정 방향: 백엔드에서 ID→이름 변환

프론트엔드가 아닌 백엔드에서 변환하는 것이 올바른 방향. 이유:
- `renderScheduleCalcResult()`는 이미 서버 응답의 `m.name`을 그대로 표시하고 있음
- 프론트엔드 수정 시 일정 계산 모달에 별도의 멤버 캐시 로딩이 필요해짐 (복잡도 증가)
- 백엔드에서 `MemberRepository`를 통해 ID→이름 매핑하는 것이 간결

### 4.2 백엔드 수정 설계

#### 4.2.1 MemberRepository 의존성 추가

`ScheduleCalculationService`에 `MemberRepository`를 주입.

#### 4.2.2 parseQaAssigneeNames() 개선

현재 메서드 시그니처:
```java
private List<String> parseQaAssigneeNames(String qaAssignees)
```

변경 후 시그니처:
```java
private List<String> parseQaAssigneeNames(String qaAssignees, Map<Long, String> memberIdToName)
```

변경 로직:
1. `qaAssignees`를 콤마로 분리
2. 각 토큰에 대해 숫자 파싱 시도 (`Long.parseLong()`)
3. 파싱 성공 → `memberIdToName.get(id)`로 이름 조회, 없으면 ID 문자열 유지 (fallback)
4. 파싱 실패 (숫자가 아님) → 이미 이름이므로 그대로 반환 (레거시 데이터 호환)

#### 4.2.3 멤버 이름 맵 구성 위치

`calculateSchedule()` 상단 또는 `calculateSingleProject()` 내부에서 조회할 수 있으며, 두 옵션은 다음과 같음:

**옵션 A: calculateSchedule() 상단에서 전체 멤버 한 번 조회** (권장)
- 장점: 다중 프로젝트 계산 시 단 1회 쿼리 (N+1 방지)
- `Map<Long, String> memberIdToName` 생성 후 `calculateSingleProject()`에 전달
- `calculateSingleProject()` 시그니처에 파라미터 추가 필요

**옵션 B: calculateSingleProject() 내부에서 조회**
- 단점: 프로젝트마다 쿼리 발생

권장: **옵션 A** (N+1 방지)

#### 4.2.4 detectQaConflict() 영향 없음

`detectQaConflict()`는 `qaAssigneeNames`(이미 변환된 이름 리스트)를 받아 경고 문자열을 생성하므로, `parseQaAssigneeNames()`가 이름을 올바르게 반환하면 경고 메시지도 자동으로 이름으로 표시됨. 별도 수정 불필요.

### 4.3 API 설계 변경 없음

응답 구조 변경 없음. `qaMembers[].name` 필드의 값이 ID에서 이름으로 바뀔 뿐.

### 4.4 프론트엔드 수정 없음

`renderScheduleCalcResult()`는 이미 `r.qaMembers.map(m => m.name)`으로 표시하고 있으므로 수정 불필요.

---

## 5. 구현 계획

### 5.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `ScheduleCalculationService`에 `MemberRepository` 주입 | `@RequiredArgsConstructor`에 자동 포함 | 낮음 | - |
| T-02 | `calculateSchedule()`에 멤버 이름 맵 구성 | `memberRepository.findByActiveTrue()`로 활성 멤버 조회 후 `Map<Long, String>` 생성 | 낮음 | T-01 |
| T-03 | `calculateSingleProject()` 시그니처 변경 | `memberIdToName` 파라미터 추가 | 낮음 | T-02 |
| T-04 | `parseQaAssigneeNames()` 로직 개선 | ID→이름 변환 + fallback 처리 | 중간 | T-03 |
| T-05 | 컴파일 확인 및 동작 검증 | `./gradlew compileJava` | 낮음 | T-04 |

### 5.2 구현 순서

1. **Step 1**: `ScheduleCalculationService.java` 상단 필드에 `MemberRepository memberRepository` 추가 (Lombok `@RequiredArgsConstructor` 자동 처리)

2. **Step 2**: `calculateSchedule()` 메서드 상단에 멤버 이름 맵 구성 코드 추가
   ```
   Map<Long, String> memberIdToName = memberRepository.findByActiveTrue().stream()
       .collect(Collectors.toMap(Member::getId, Member::getName));
   ```
   - `findAll()` 대신 `findByActiveTrue()` 사용: 비활성 멤버는 마일스톤 QA 담당자로 지정될 수 없으므로 조회 범위 최소화. 레거시 데이터(비활성 멤버 ID가 저장된 경우)는 fallback(ID 문자열 그대로 반환)으로 처리됨.

3. **Step 3**: `calculateSingleProject()` 메서드 시그니처에 `Map<Long, String> memberIdToName` 파라미터 추가 및 호출부 수정

4. **Step 4**: `parseQaAssigneeNames(String qaAssignees, Map<Long, String> memberIdToName)` 로직 변경
   - 각 토큰에 대해:
     ```
     try {
         Long id = Long.parseLong(token);
         return memberIdToName.getOrDefault(id, token); // 이름 없으면 ID 문자열 유지
     } catch (NumberFormatException e) {
         return token; // 이미 이름이면 그대로 반환
     }
     ```

5. **Step 5**: 컴파일 검증

### 5.3 테스트 계획

- **동작 확인 시나리오**:
  1. QA 담당자가 있는 마일스톤을 가진 프로젝트로 일정 계산 실행 → QA 컬럼에 이름 표시 확인
  2. 2개 이상의 프로젝트를 동시에 계산하고 QA 담당자가 겹치는 경우 → 경고 메시지에 이름 표시 확인
  3. QA 담당자가 없는 프로젝트 → "0명" / "-" 정상 표시 확인
  4. DB에 존재하지 않는 ID가 `qa_assignees`에 저장된 경우 → fallback으로 ID 문자열 표시 확인 (graceful degradation)

---

## 6. 리스크 및 고려사항

### 6.1 레거시 데이터 (이름으로 저장된 경우)

과거 버전에서 이름 문자열로 저장된 레코드가 있을 수 있음. `parseQaAssigneeNames()`의 `NumberFormatException` catch 로직으로 이름 문자열을 그대로 반환하므로 안전하게 처리됨.

### 6.2 `memberRepository.findByActiveTrue()` 성능

활성 멤버만 조회하므로 `findAll()` 대비 응답 범위가 최소화됨. 멤버 수가 수십~수백 명 규모이므로 성능 영향 없음. 또한 `calculateSchedule()` 상단에서 1회만 호출하므로 다중 프로젝트 계산 시에도 쿼리 1회.

### 6.3 QA 중복 경고 추적 맵 키 변경

`qaAssigneeBusyPeriods`의 키가 현재 `String`(이름 또는 ID)이므로, 이름으로 통일되면 키 일관성이 보장됨. 기존 코드에서 이름으로 저장되던 경우와 ID로 저장되던 경우가 섞이면 중복 감지가 누락될 수 있었으나, 이번 수정으로 항상 이름으로 통일되어 정확도 향상.

---

## 7. 참고 사항

### 관련 파일

- `src/main/java/com/timeline/service/ScheduleCalculationService.java` — 수정 대상 (1개 파일)
- `src/main/java/com/timeline/domain/repository/MemberRepository.java` — 기존 `findByActiveTrue()` 사용 (수정 없음)
- `src/main/resources/static/js/app.js` — 수정 없음 (렌더링 코드 정상)
- `src/main/resources/static/index.html` — 수정 없음

### 수정 범위 요약

| 파일 | 수정 여부 | 수정 내용 |
|------|-----------|-----------|
| `ScheduleCalculationService.java` | 수정 | `MemberRepository` 주입, 멤버 이름 맵 구성, `parseQaAssigneeNames()` 로직 개선, `calculateSingleProject()` 시그니처 변경 |
| `MemberRepository.java` | 없음 | `findByActiveTrue()` 기존 메서드 활용 |
| `app.js` | 없음 | 렌더링 코드 이미 정상 |
| `index.html` | 없음 | HTML 구조 변경 없음 |
