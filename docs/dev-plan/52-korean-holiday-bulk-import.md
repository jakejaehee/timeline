# 개발 계획서: 한국 공휴일 자동 일괄 입력 기능

## 1. 개요

- **기능 설명**: 설정 > 공휴일 탭에서 연도를 선택하면 해당 연도의 한국 공휴일 전체를 자동으로 일괄 등록하는 기능
- **개발 배경 및 목적**: 매년 공휴일을 수동으로 한 건씩 입력하는 번거로움 해소. 외부 API 의존 없이 안정적으로 공휴일 데이터를 제공하기 위해 하드코딩 방식 채택
- **작성일**: 2026-04-20

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: 공휴일 탭 상단에 "한국 공휴일 추가" 버튼을 추가한다
- FR-002: 버튼 클릭 시 연도를 선택할 수 있는 모달을 표시한다 (현재 연도 기본 선택)
- FR-003: 연도 확인 시 해당 연도의 한국 공휴일 목록(고정 + 음력 환산)을 일괄 등록한다
- FR-004: 이미 동일 날짜로 등록된 공휴일이 있으면 건너뛴다 (중복 방지)
- FR-005: 일괄 등록 완료 후 "N건 추가, M건 건너뜀" 형태의 결과 메시지를 표시한다
- FR-006: 등록되는 모든 항목의 type은 `NATIONAL`로 고정한다
- FR-007: UI에서 선택 가능한 연도 범위: 2025 ~ 2030년 (음력 공휴일 하드코딩 범위). API 직접 호출 시 범위 밖 연도는 고정 양력 공휴일만 등록된다 (§2.3 참조).

### 2.2 비기능 요구사항

- NFR-001: 외부 API 없이 동작해야 한다 (서버 내 하드코딩 데이터)
- NFR-002: 일괄 등록은 단일 트랜잭션으로 처리하여 원자성을 보장한다
- NFR-003: 중복 체크는 서버 사이드에서 수행한다 (날짜 기준)

### 2.3 가정 사항

- 중복 판정은 날짜(date) 컬럼만 기준으로 한다 (동일 날짜에 이름이 다른 항목이 있어도 건너뜀)
- 음력 공휴일 데이터는 2025~2030년 범위를 하드코딩하며, 범위 밖 연도 요청 시 고정 공휴일(양력)만 등록된다
- 대체공휴일(일요일 겹침 시 월요일 추가)은 이번 범위에서 제외한다

### 2.4 제외 범위 (Out of Scope)

- 대체공휴일 자동 계산
- 2030년 이후 음력 공휴일 자동 계산
- 기존 등록 항목의 이름 업데이트 (중복 시 건너뜀만 수행)
- 일괄 삭제 기능

---

## 3. 시스템 설계

### 3.1 데이터 모델

신규 엔티티 없음. 기존 `Holiday` 엔티티를 그대로 사용한다.

```
Holiday
  id          BIGINT (PK, auto)
  date        DATE (NOT NULL)          -- 등록 기준 키
  name        VARCHAR(100) (NOT NULL)  -- 공휴일명
  type        VARCHAR(20) (NOT NULL)   -- NATIONAL 고정
  created_at  TIMESTAMP
  updated_at  TIMESTAMP
```

중복 체크를 위해 `HolidayRepository`에 날짜 존재 여부 확인 메서드를 추가한다.

### 3.2 API 설계

| Method | Endpoint | 설명 | Request Body | Response |
|--------|----------|------|-------------|----------|
| POST | `/api/v1/holidays/bulk-korean` | 한국 공휴일 일괄 등록 | `{ "year": 2026 }` | `{ "success": true, "data": { "added": N, "skipped": M } }` |

**Request 예시**:
```json
{ "year": 2026 }
```

**Response 예시** (2026년 최초 등록 시):
```json
{
  "success": true,
  "data": {
    "added": 15,
    "skipped": 0
  }
}
```

**에러 케이스**:
- year 미전달 또는 유효하지 않은 값 → `400 Bad Request`, `{ "success": false, "message": "연도를 입력해주세요." }`

### 3.3 서비스 계층

#### KoreanHolidayData (신규 — 하드코딩 데이터 클래스)

`com.timeline.service` 패키지에 `KoreanHolidayData` 클래스를 추가한다. Spring 빈이 아닌 순수 유틸리티 클래스(`final class` + `private constructor`)로 작성한다.

```java
// com/timeline/service/KoreanHolidayData.java
// 정적 메서드: getHolidays(int year) → List<HolidayEntry>
// HolidayEntry: record(LocalDate date, String name)
```

내장 데이터 구조:

```
[고정 양력 공휴일] — 연도 파라미터로 LocalDate 생성
  01-01  신정
  03-01  삼일절
  05-05  어린이날
  06-06  현충일
  08-15  광복절
  10-03  개천절
  10-09  한글날
  12-25  크리스마스

[음력 공휴일 하드코딩 테이블] — Map<Integer, List<HolidayEntry>>
  2025:
    설날 연휴: 01-28, 01-29, 01-30
    석가탄신일: 05-05
    추석 연휴: 10-05, 10-06, 10-07
  2026:
    설날 연휴: 02-16, 02-17, 02-18
    석가탄신일: 05-24
    추석 연휴: 09-24, 09-25, 09-26
  2027:
    설날 연휴: 02-06, 02-07, 02-08 (음력 12/31~1/2)
    석가탄신일: 05-13
    추석 연휴: 10-14, 10-15, 10-16 (음력 8/14~8/16)
  2028:
    설날 연휴: 01-26, 01-27, 01-28
    석가탄신일: 05-02
    추석 연휴: 10-02, 10-03, 10-04
  2029:
    설날 연휴: 02-12, 02-13, 02-14
    석가탄신일: 05-20
    추석 연휴: 09-22, 09-23, 09-24
  2030:
    설날 연휴: 02-02, 02-03, 02-04
    석가탄신일: 05-09
    추석 연휴: 10-11, 10-12, 10-13
```

> 주의: 위 음력 환산 날짜는 계획서 작성 시점의 예측값이다. 구현 전 공식 자료(행정안전부 고시)와 대조하여 확정할 것.

#### HolidayService (기존 수정)

`bulkAddKoreanHolidays(int year)` 메서드 추가:

> 주의: `HolidayService`는 클래스 레벨에 `@Transactional(readOnly = true)`가 선언되어 있다. 이 메서드에는 반드시 `@Transactional` (쓰기 트랜잭션)을 명시해야 한다.

```
@Transactional
public BulkResult bulkAddKoreanHolidays(int year) {
  1. KoreanHolidayData.getHolidays(year) 호출 → 후보 목록 획득
  2. 해당 연도에 이미 등록된 날짜 Set 조회 (existingDates = findDatesByYear(year))
  3. 후보 목록을 순회하며:
     - existingDates에 포함되면 → skipped++
     - 미포함이면 → Holiday 엔티티 생성, type=NATIONAL → holidayRepository.save() → added++
  4. return new BulkResult(added, skipped)
}
```

`BulkResult`는 `HolidayDto` 내 public static class(또는 record)로 정의한다:

```java
// HolidayDto.java 내부 추가
@Data
@AllArgsConstructor
public static class BulkResult {
    private int added;
    private int skipped;
}
```

#### HolidayController (기존 수정)

```java
@PostMapping("/bulk-korean")
public ResponseEntity<?> bulkAddKoreanHolidays(@RequestBody Map<String, Integer> body) {
    Integer year = body.get("year");
    if (year == null || year < 1900 || year > 9999) {
        return ResponseEntity.badRequest().body(Map.of(
            "success", false,
            "message", "연도를 입력해주세요."
        ));
    }
    HolidayDto.BulkResult result = holidayService.bulkAddKoreanHolidays(year);
    return ResponseEntity.ok(Map.of("success", true, "data", result));
}
```

> 반환 타입은 `HolidayDto.BulkResult`로 명시한다. `BulkResult`를 단독 클래스명으로 사용하면 컴파일러가 인식하지 못한다.

#### HolidayRepository (기존 수정)

날짜 존재 여부 확인을 위한 쿼리 추가:

```java
@Query("SELECT h.date FROM Holiday h WHERE YEAR(h.date) = :year")
Set<LocalDate> findDatesByYear(@Param("year") int year);
```

### 3.4 프론트엔드

#### index.html 변경

1. **공휴일 탭 헤더 버튼 영역** (line 567 근처): 기존 "공휴일/회사휴무 추가" 버튼 옆에 "한국 공휴일 추가" 버튼 추가

```html
<!-- 변경 전 -->
<button class="btn btn-primary btn-sm" onclick="showHolidayModal()">
    <i class="bi bi-plus-lg"></i> 공휴일/회사휴무 추가
</button>

<!-- 변경 후: 버튼 2개를 gap-2로 나열 -->
<div class="d-flex gap-2">
    <button class="btn btn-outline-success btn-sm" onclick="showKoreanHolidayModal()">
        <i class="bi bi-calendar2-check"></i> 한국 공휴일 추가
    </button>
    <button class="btn btn-primary btn-sm" onclick="showHolidayModal()">
        <i class="bi bi-plus-lg"></i> 공휴일/회사휴무 추가
    </button>
</div>
```

2. **한국 공휴일 연도 선택 모달 추가** (기존 `holidayModal` 아래):

```html
<!-- 한국 공휴일 일괄 추가 모달 -->
<div class="modal fade" id="koreanHolidayModal" tabindex="-1">
    <div class="modal-dialog modal-sm">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">한국 공휴일 추가</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <div class="mb-3">
                    <label for="korean-holiday-year" class="form-label">연도</label>
                    <select class="form-select" id="korean-holiday-year">
                        <!-- JS에서 2025~2030 옵션 생성 -->
                    </select>
                </div>
                <div class="text-muted small">
                    선택한 연도의 한국 법정 공휴일을 일괄 등록합니다. 이미 등록된 날짜는 건너뜁니다.
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">취소</button>
                <button type="button" class="btn btn-success" onclick="bulkAddKoreanHolidays()">추가</button>
            </div>
        </div>
    </div>
</div>
```

#### app.js 변경

`deleteHoliday()` 함수의 닫힘 괄호(line 7873) 바로 뒤, `// Member Leave (멤버 비가용일) 관리` 섹션 주석(line 7875~7877) 앞에 다음 함수 2개를 추가한다.

```javascript
/**
 * 한국 공휴일 일괄 추가 모달 표시
 */
function showKoreanHolidayModal() {
    var sel = document.getElementById('korean-holiday-year');
    sel.innerHTML = '';
    var currentYear = new Date().getFullYear();
    for (var y = 2025; y <= 2030; y++) {
        var opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y + '년';
        if (y === currentYear) opt.selected = true;
        sel.appendChild(opt);
    }
    new bootstrap.Modal(document.getElementById('koreanHolidayModal')).show();
}

/**
 * 한국 공휴일 일괄 추가 실행
 */
async function bulkAddKoreanHolidays() {
    var year = parseInt(document.getElementById('korean-holiday-year').value);
    try {
        var res = await apiCall('/api/v1/holidays/bulk-korean', 'POST', { year: year });
        if (res.success) {
            var added = res.data.added;
            var skipped = res.data.skipped;
            showToast(year + '년 공휴일: ' + added + '건 추가, ' + skipped + '건 건너뜀', 'success');
            cachedHolidayDates = null;
            bootstrap.Modal.getInstance(document.getElementById('koreanHolidayModal')).hide();
            // 현재 필터 연도를 추가한 연도로 맞춘다
            document.getElementById('holiday-filter-year').value = year;
            loadHolidays();
        } else {
            showToast(res.message || '공휴일 추가에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('한국 공휴일 일괄 추가 실패:', e);
        showToast('공휴일 추가에 실패했습니다.', 'error');
    }
}
```

`loadSettingsSection()` 함수의 연도 필터 range도 2030까지 커버되도록 수정한다. 현재 코드(line 6742)는 `currentYear - 1` ~ `currentYear + 2`까지 생성하므로 2026년 기준 2025~2028년만 커버된다.

권장 수정 방법: 최솟값은 그대로 `currentYear - 1`, 최댓값을 `Math.max(currentYear + 2, 2030)`으로 변경한다. 이렇게 하면 연도가 2029 이후로 넘어가도 `currentYear + 2`가 2031을 초과하면 자연스럽게 커버되어 `Math.max` 조건이 의미를 유지한다.

```javascript
// 변경 전 (line 6742)
for (var y = currentYear - 1; y <= currentYear + 2; y++) {

// 변경 후
var maxYear = Math.max(currentYear + 2, 2030);
for (var y = currentYear - 1; y <= maxYear; y++) {
```

### 3.5 기존 시스템 연동

- `BusinessDayCalculator`: 변경 없음. 기존 `HolidayService.getHolidayDatesBetween()` 인터페이스를 그대로 사용
- `BackupDto` / `DataBackupService`: 신규 테이블이 없으므로 변경 없음
- `docs/schema.sql`: 신규 컬럼/테이블 없으므로 변경 없음

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | `KoreanHolidayData` 클래스 작성 | 고정 + 음력 하드코딩 데이터, `getHolidays(year)` 메서드 | 중 | 없음 |
| T2 | `HolidayRepository` 메서드 추가 | `findDatesByYear(int year)` 쿼리 추가 | 소 | 없음 |
| T3 | `HolidayService.bulkAddKoreanHolidays()` 구현 + `HolidayDto.BulkResult` 정의 | 중복 체크 + 일괄 저장 + 결과 반환, `@Transactional` 명시 필수 | 소 | T1, T2 |
| T4 | `HolidayController` 엔드포인트 추가 | `POST /api/v1/holidays/bulk-korean`, 연도 유효성 검증 포함 | 소 | T3 |
| T5 | `index.html` UI 추가 | 버튼 + 모달 HTML | 소 | 없음 |
| T6 | `app.js` 함수 추가 | `showKoreanHolidayModal()`, `bulkAddKoreanHolidays()` | 소 | T4, T5 |
| T7 | 연도 필터 select range 조정 | `loadSettingsSection()` 수정 | 소 | 없음 |

### 4.2 구현 순서

1. **Step 1 — 데이터 클래스**: `KoreanHolidayData.java` 작성 (음력 날짜 확정 포함)
2. **Step 2 — Repository**: `HolidayRepository`에 `findDatesByYear` 추가
3. **Step 3 — Service + DTO**: `HolidayDto.BulkResult` static class 정의 후 `bulkAddKoreanHolidays()` 메서드 구현 (`@Transactional` 명시)
4. **Step 4 — Controller**: `POST /bulk-korean` 엔드포인트 추가
5. **Step 5 — HTML**: 버튼 + 모달 추가
6. **Step 6 — JS**: 함수 추가 + 연도 select range 조정
7. **Step 7 — 버전 갱신**: `index.html`의 `app.js?v=` 값 갱신 (예: `20260420a`)

### 4.3 테스트 계획

- **수동 테스트**:
  1. 2026년 선택 → "추가" → 15건 추가, 0건 건너뜀 확인 (고정 8건 + 설날연휴 3건 + 석가탄신일 1건 + 추석연휴 3건)
  2. 같은 연도 재시도 → 0건 추가, 15건 건너뜀 확인
  3. 공휴일 탭의 연도 필터가 추가한 연도로 자동 이동하는지 확인
  4. 2025년 (음력 공휴일 있음) + 2031년 (음력 공휴일 없음, 고정 8건만) 동작 확인
  5. 추가 후 `BusinessDayCalculator` 동작 영향 없음 확인 (기존 태스크 날짜 불변)

---

## 5. 리스크 및 고려사항

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| 음력 변환 오류 | 하드코딩된 날짜가 실제 공식 고시와 다를 수 있음 | 구현 전 행정안전부 공고 및 한국천문연구원 자료와 대조 필수 |
| 연도 필터 select 범위 | `holiday-filter-year` 옵션이 2030년을 포함하지 않을 수 있음 | `loadSettingsSection()` 수정 시 함께 처리 |
| 대체공휴일 누락 | 일요일과 겹치는 공휴일의 대체공휴일이 미포함됨 | Out of Scope 명시; 추후 별도 기능으로 추가 가능 |

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 |
|------|------|
| Holiday 엔티티 | `src/main/java/com/timeline/domain/entity/Holiday.java` |
| HolidayType enum | `src/main/java/com/timeline/domain/enums/HolidayType.java` |
| HolidayRepository | `src/main/java/com/timeline/domain/repository/HolidayRepository.java` |
| HolidayService | `src/main/java/com/timeline/service/HolidayService.java` |
| HolidayController | `src/main/java/com/timeline/controller/HolidayController.java` |
| HolidayDto | `src/main/java/com/timeline/dto/HolidayDto.java` |
| 공휴일 탭 HTML | `src/main/resources/static/index.html` (line 559~590) |
| 기존 holidayModal HTML | `src/main/resources/static/index.html` (line 847~878) |
| 공휴일 관련 JS 함수 | `src/main/resources/static/js/app.js` (line 7778~7873) |
| 연도 필터 초기화 | `src/main/resources/static/js/app.js` — `loadSettingsSection()` (line 6737~) |

### 음력 공휴일 날짜 검증 참고

- 한국천문연구원 역서: https://astro.kasi.re.kr/
- 행정안전부 공휴일 고시: https://www.mois.go.kr/

### 현재 app.js 버전

`app.js?v=20260419k` → 구현 완료 후 `app.js?v=20260420a` (또는 당일 날짜 기준)로 갱신
