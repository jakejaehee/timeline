# 개발 계획서: 전체 DB 데이터 Export/Import

## 1. 개요

### 기능 설명
Timeline 애플리케이션의 전체 DB 데이터를 JSON 파일로 Export하고, 동일 형식의 파일을 Import하여 데이터를 복원하는 기능이다. 기존 Settings 페이지에 "데이터 관리" 탭을 추가하는 방식으로 구현한다.

### 개발 배경 및 목적
- 개발/운영 환경 간 데이터 이관 시 간편한 백업/복원 수단 제공
- DB 직접 접근 없이 앱 UI에서 전체 데이터 스냅샷 추출 가능
- Docker 재배포 등 환경 교체 시 데이터 손실 방지

### 작성일
2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: Export 버튼 클릭 시 전체 DB 데이터를 하나의 JSON 파일로 다운로드한다.
- **FR-002**: 파일명 형식은 `timeline-backup-{YYYY-MM-DD}.json`이다.
- **FR-003**: Export JSON에는 모든 테이블 데이터와 FK 참조 ID가 포함되어야 한다.
- **FR-004**: Import 버튼 클릭 시 JSON 파일을 업로드하고 유효성 검증 후 데이터를 복원한다.
- **FR-005**: Import 전 "기존 데이터가 모두 삭제됩니다" 확인 다이얼로그를 표시한다.
- **FR-006**: Import는 기존 데이터 전체 삭제 후 JSON 데이터를 새로 삽입하는 방식으로 동작한다.
- **FR-007**: FK 제약조건을 고려하여 정해진 순서에 따라 삽입한다.
- **FR-008**: Import JSON의 기본 구조(버전, 테이블 키 존재 여부) 유효성 검증을 수행한다.
- **FR-009**: Settings 페이지에 "데이터 관리" 탭을 추가하여 Export/Import UI를 배치한다.

### 2.2 비기능 요구사항

- **NFR-001**: Export/Import는 단일 HTTP 요청-응답으로 처리한다 (스트리밍 불필요, 현재 데이터 규모 기준).
- **NFR-002**: Import 실패 시 전체 트랜잭션 롤백으로 데이터 정합성을 보장한다.
- **NFR-003**: Export 파일은 `schemaVersion` 필드를 포함하여 향후 버전 관리가 가능한 구조로 설계한다.
- **NFR-004**: Import 중 오류 발생 시 사용자에게 구체적인 에러 메시지를 제공한다.

### 2.3 가정 사항

- 현재 DB 데이터 규모는 수백~수천 건 수준으로, 전체 데이터를 메모리에 로드하여 처리해도 무방하다.
- Import는 "완전 교체" 방식이며, 기존 데이터와의 머지(diff)는 이번 범위에 포함하지 않는다.
- 인증/권한 시스템이 없으므로 Import API에 별도 접근 제어를 추가하지 않는다.
- `createdAt`, `updatedAt` 등 auditing 필드는 Export 시 원본 값을 포함하고, Import 시 해당 값을 그대로 삽입한다 (JPA auditing 우회).

### 2.4 제외 범위 (Out of Scope)

- 부분 Export (테이블 선택, 날짜 범위 필터)
- Export/Import 이력 관리
- 암호화 또는 압축 (.zip, .gz)
- Import 결과의 세부 diff 리포트
- 원격 저장소 연동 (S3 등)
- `schemaVersion` 간 마이그레이션 로직 (현재 버전만 지원)

---

## 3. 시스템 설계

### 3.1 데이터 모델

신규 엔티티 없음. 기존 10개 테이블의 전체 데이터를 그대로 직렬화/역직렬화한다.

#### Export/Import 대상 테이블 및 삽입 순서

FK 의존관계 기준 계층별 삽입 순서:

| 순서 | 테이블 | JSON 키 | FK 의존 대상 |
|------|--------|---------|-------------|
| 1 | `member` | `members` | 없음 |
| 2 | `domain_system` | `domainSystems` | 없음 |
| 3 | `project` | `projects` | 없음 |
| 4 | `holiday` | `holidays` | 없음 |
| 5 | `project_member` | `projectMembers` | project, member |
| 6 | `project_domain_system` | `projectDomainSystems` | project, domain_system |
| 7 | `task` | `tasks` | project, domain_system, member |
| 8 | `member_leave` | `memberLeaves` | member |
| 9 | `task_link` | `taskLinks` | task |
| 10 | `task_dependency` | `taskDependencies` | task (x2) |

#### Export JSON 구조

```json
{
  "schemaVersion": "1.0",
  "exportedAt": "2026-04-12T10:30:00",
  "members": [
    {
      "id": 1,
      "name": "홍길동",
      "role": "DEVELOPER",
      "email": "hong@example.com",
      "capacity": 1.0,
      "active": true,
      "queueStartDate": "2026-04-01",
      "createdAt": "2026-01-01T09:00:00",
      "updatedAt": "2026-03-15T14:00:00"
    }
  ],
  "domainSystems": [
    { "id": 1, "name": "백엔드", "description": "...", "color": "#3B82F6", "createdAt": "...", "updatedAt": "..." }
  ],
  "projects": [
    {
      "id": 10,
      "name": "프로젝트명",
      "projectType": "신규개발",
      "description": "...",
      "startDate": "2026-01-01",
      "endDate": "2026-06-30",
      "status": "IN_PROGRESS",
      "createdAt": "2026-01-01T09:00:00",
      "updatedAt": "2026-03-01T10:00:00"
    }
  ],
  "holidays": [
    { "id": 1, "date": "2026-01-01", "name": "신정", "type": "NATIONAL", "createdAt": "...", "updatedAt": "..." }
  ],
  "projectMembers": [
    { "id": 1, "projectId": 10, "memberId": 1, "createdAt": "..." }
  ],
  "projectDomainSystems": [
    { "id": 1, "projectId": 10, "domainSystemId": 2, "createdAt": "..." }
  ],
  "tasks": [
    {
      "id": 100,
      "projectId": 10,
      "domainSystemId": 2,
      "assigneeId": 1,
      "name": "태스크명",
      "description": "...",
      "startDate": "2026-04-01",
      "endDate": "2026-04-10",
      "manDays": 5.0,
      "status": "TODO",
      "executionMode": "SEQUENTIAL",
      "priority": "P1",
      "type": "FEATURE",
      "actualEndDate": null,
      "assigneeOrder": 1,
      "sortOrder": 1,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "memberLeaves": [
    { "id": 1, "memberId": 1, "date": "2026-05-01", "reason": "연차", "createdAt": "...", "updatedAt": "..." }
  ],
  "taskLinks": [
    { "id": 1, "taskId": 100, "url": "https://...", "label": "Jira", "createdAt": "..." }
  ],
  "taskDependencies": [
    { "id": 1, "taskId": 101, "dependsOnTaskId": 100, "createdAt": "..." }
  ]
}
```

### 3.2 API 설계

| Method | Endpoint | 설명 | Request | Response |
|--------|----------|------|---------|----------|
| GET | `/api/v1/data/export` | 전체 DB 데이터 Export | 없음 | `application/json` 파일 다운로드 (Content-Disposition: attachment) |
| POST | `/api/v1/data/import` | JSON 파일 Import (전체 교체) | `multipart/form-data` (file 파트) | `{"success": true, "message": "..."}` |

#### Export 응답 헤더

```
Content-Type: application/json; charset=UTF-8
Content-Disposition: attachment; filename="timeline-backup-2026-04-12.json"
```

#### Import 요청

```
POST /api/v1/data/import
Content-Type: multipart/form-data

file: [업로드된 JSON 파일]
```

#### Import 응답 (성공)

```json
{
  "success": true,
  "message": "Import 완료. members: 5, projects: 3, tasks: 47, ..."
}
```

#### Import 응답 (실패)

```json
{
  "success": false,
  "error": "INVALID_INPUT",
  "message": "유효하지 않은 백업 파일입니다: schemaVersion 필드가 없습니다."
}
```

### 3.3 서비스 계층

#### 신규 클래스

**`DataBackupService`** (`com.timeline.service`)

```java
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DataBackupService {

    // 의존 repository (전체 10개)
    private final MemberRepository memberRepository;
    private final DomainSystemRepository domainSystemRepository;
    private final ProjectRepository projectRepository;
    private final HolidayRepository holidayRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectDomainSystemRepository projectDomainSystemRepository;
    private final TaskRepository taskRepository;
    private final MemberLeaveRepository memberLeaveRepository;
    private final TaskLinkRepository taskLinkRepository;
    private final TaskDependencyRepository taskDependencyRepository;

    /** 전체 데이터를 BackupDto.Snapshot으로 반환 */
    public BackupDto.Snapshot exportAll() { ... }

    /** JSON 파싱 → 유효성 검증 → 전체 삭제 후 재삽입 */
    @Transactional
    public BackupDto.ImportResult importAll(BackupDto.Snapshot snapshot) { ... }

    /** ID 재매핑 없이 원본 ID 그대로 삽입 (IDENTITY 전략 우회 필요) */
    private void insertWithOriginalId(...) { ... }
}
```

**주요 비즈니스 로직 흐름:**

**Export:**
1. 각 repository에서 `findAll()` 호출
2. 엔티티를 Flat DTO로 변환 (FK는 ID 값으로만 표현)
3. `BackupDto.Snapshot` 조립 후 반환

**Import:**
1. `snapshot.schemaVersion` 존재 여부 검증
2. 필수 키(`members`, `projects` 등) 존재 여부 검증
3. 삭제 순서 역순으로 전체 데이터 삭제 (task_dependency → task_link → task → project_domain_system → project_member → member_leave → holiday → project → domain_system → member 순)
4. 삽입 순서대로 Native INSERT 실행 (원본 ID 사용)
5. PostgreSQL sequence 리셋: 각 테이블 `SELECT MAX(id)` 후 `setval('{table}_id_seq', max_id + 1, false)` 실행 (INSERT 완료 후 시퀀스를 max_id + 1로 조정하여 이후 JPA INSERT와의 충돌 방지)
6. 삽입 건수 집계 후 `ImportResult` 반환

**ID 원본 삽입 전략:**
- JPA `@GeneratedValue(strategy = GenerationType.IDENTITY)` 사용 중이므로, Import 시 `EntityManager.persist()` 대신 Native Query 또는 `JDBC Template`으로 직접 INSERT 수행하거나, PostgreSQL의 `setval()`로 sequence를 임시 조정하는 방법을 사용한다.
- 구현 단순성을 위해 **JdbcTemplate `batchUpdate()`** 방식을 사용하지 않고, 다음 전략을 채택한다 (JPQL은 INSERT를 지원하지 않으므로 Native SQL만 가능):
  - `EntityManager`의 `@PersistenceContext` 주입 후 `em.createNativeQuery()`로 각 테이블에 직접 INSERT
  - Native INSERT 완료 후 `setval('{table}_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM {table}), false)` 실행으로 sequence 정합성 확보 (`ALTER SEQUENCE ... RESTART WITH`는 사용하지 않음 — §6 SQL 예시 참고)

**삭제 순서 (FK 역순):**
1. `task_dependency` 전체 삭제
2. `task_link` 전체 삭제
3. `task` 전체 삭제 (`project_id`, `domain_system_id`, `assignee_id` FK)
4. `project_member` 전체 삭제
5. `project_domain_system` 전체 삭제
6. `member_leave` 전체 삭제
7. `project` 전체 삭제
8. `domain_system` 전체 삭제
9. `holiday` 전체 삭제
10. `member` 전체 삭제

**신규 컨트롤러:**

**`DataBackupController`** (`com.timeline.controller`)

```java
@RestController
@RequestMapping("/api/v1/data")
@RequiredArgsConstructor
public class DataBackupController {

    @GetMapping("/export")
    public ResponseEntity<byte[]> export() { ... }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> importData(@RequestParam("file") MultipartFile file) { ... }
}
```

**신규 DTO:**

**`BackupDto`** (`com.timeline.dto`)

```java
public class BackupDto {

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class Snapshot {
        private String schemaVersion;          // "1.0"
        private LocalDateTime exportedAt;
        private List<MemberRow> members;
        private List<DomainSystemRow> domainSystems;
        private List<ProjectRow> projects;
        private List<HolidayRow> holidays;
        private List<ProjectMemberRow> projectMembers;
        private List<ProjectDomainSystemRow> projectDomainSystems;
        private List<TaskRow> tasks;
        private List<MemberLeaveRow> memberLeaves;
        private List<TaskLinkRow> taskLinks;
        private List<TaskDependencyRow> taskDependencies;
    }

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class MemberRow { ... }       // 엔티티의 모든 필드 (flat)

    @Data @Builder @NoArgsConstructor @AllArgsConstructor
    public static class TaskRow {               // FK는 Long ID로만 표현
        private Long id;
        private Long projectId;
        private Long domainSystemId;
        private Long assigneeId;                // nullable
        // ... 나머지 필드
    }

    // ProjectMemberRow, TaskDependencyRow 등 나머지 Row 클래스들...

    @Data @Builder
    public static class ImportResult {
        private int members;
        private int domainSystems;
        private int projects;
        private int holidays;
        private int projectMembers;
        private int projectDomainSystems;
        private int tasks;
        private int memberLeaves;
        private int taskLinks;
        private int taskDependencies;
    }
}
```

### 3.4 프론트엔드

#### UI 변경 사항

**`index.html`** — Settings 탭 추가

기존 탭 목록에 "데이터 관리" 탭 항목 추가:

```html
<!-- 기존 탭들(settings-domains) 다음에 추가 -->
<li class="nav-item">
    <a class="nav-link" data-bs-toggle="tab" href="#settings-data">데이터 관리</a>
</li>
```

탭 콘텐츠 패널 추가:

```html
<div id="settings-data" class="tab-pane fade">
    <div class="row g-4">
        <!-- Export 카드 -->
        <div class="col-md-6">
            <div class="card h-100">
                <div class="card-header fw-bold">
                    <i class="bi bi-download"></i> 데이터 내보내기 (Export)
                </div>
                <div class="card-body">
                    <p class="text-muted small">
                        전체 DB 데이터를 JSON 파일로 다운로드합니다.<br>
                        멤버, 프로젝트, 태스크 등 모든 데이터가 포함됩니다.
                    </p>
                    <button class="btn btn-outline-primary" onclick="exportData()">
                        <i class="bi bi-download"></i> JSON으로 내보내기
                    </button>
                </div>
            </div>
        </div>
        <!-- Import 카드 -->
        <div class="col-md-6">
            <div class="card h-100">
                <div class="card-header fw-bold">
                    <i class="bi bi-upload"></i> 데이터 가져오기 (Import)
                </div>
                <div class="card-body">
                    <p class="text-muted small">
                        JSON 백업 파일을 업로드하여 데이터를 복원합니다.<br>
                        <strong class="text-danger">기존 데이터가 모두 삭제됩니다.</strong>
                    </p>
                    <div class="mb-2">
                        <input type="file" id="import-file-input" accept=".json"
                               class="form-control form-control-sm" style="display:none"
                               onchange="onImportFileSelected(event)">
                        <button class="btn btn-outline-danger" onclick="document.getElementById('import-file-input').click()">
                            <i class="bi bi-upload"></i> JSON 파일 선택
                        </button>
                    </div>
                    <div id="import-file-name" class="text-muted small"></div>
                </div>
            </div>
        </div>
    </div>
</div>
```

Import 확인 모달 추가:

```html
<div class="modal fade" id="importConfirmModal" tabindex="-1">
    <div class="modal-dialog">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title text-danger">
                    <i class="bi bi-exclamation-triangle"></i> 데이터 가져오기 확인
                </h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <p><strong>기존 데이터가 모두 삭제되고 업로드한 파일의 데이터로 교체됩니다.</strong></p>
                <p class="text-muted">이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?</p>
                <div id="import-preview-info" class="alert alert-info small"></div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">취소</button>
                <button type="button" class="btn btn-danger" onclick="confirmImport()">
                    <i class="bi bi-upload"></i> 가져오기 실행
                </button>
            </div>
        </div>
    </div>
</div>
```

#### app.js 신규 함수

```javascript
// Export: GET /api/v1/data/export → Blob 다운로드
async function exportData() { ... }

// Import 파일 선택 후 미리보기 (파일명 표시, 모달 오픈)
function onImportFileSelected(event) { ... }

// Import 확인 모달에서 "실행" 클릭
async function confirmImport() { ... }
```

**`exportData()` 구현 패턴:**
```javascript
async function exportData() {
    try {
        var response = await fetch('/api/v1/data/export');
        if (!response.ok) throw new Error('Export 실패');
        var blob = await response.blob();
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        // 클라이언트 현재 날짜로 파일명 결정 (a.download 속성이 Content-Disposition 헤더보다 우선)
        a.download = 'timeline-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        window.URL.revokeObjectURL(url);
        showToast('데이터 내보내기가 완료되었습니다.', 'success');
    } catch (e) {
        showToast('내보내기에 실패했습니다.', 'error');
    }
}
```

**`onImportFileSelected()` 구현 패턴:**
```javascript
var pendingImportFile = null;

function onImportFileSelected(event) {
    var file = event.target.files[0];
    if (!file) return;
    pendingImportFile = file;
    document.getElementById('import-file-name').textContent = '선택된 파일: ' + file.name;
    document.getElementById('import-preview-info').textContent =
        '파일: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
    var modal = new bootstrap.Modal(document.getElementById('importConfirmModal'));
    modal.show();
    // 파일 input 초기화 (같은 파일 재선택 허용)
    event.target.value = '';
}
```

**`confirmImport()` 구현 패턴:**
```javascript
async function confirmImport() {
    if (!pendingImportFile) return;
    var formData = new FormData();
    formData.append('file', pendingImportFile);
    bootstrap.Modal.getInstance(document.getElementById('importConfirmModal')).hide();
    showToast('데이터를 가져오는 중입니다...', 'info');
    try {
        var response = await fetch('/api/v1/data/import', { method: 'POST', body: formData });
        var res = await response.json();
        if (res.success) {
            showToast('Import 완료: ' + res.message, 'success');
            // 전체 SPA 상태 초기화: 부분 갱신(loadDashboard)으로는 Settings 탭 멤버/도메인 목록 등이
            // 갱신되지 않으므로, 데이터 전체 교체 후 location.reload()로 완전히 초기화한다.
            setTimeout(function() { location.reload(); }, 800);
        } else {
            showToast('Import 실패: ' + res.message, 'error');
        }
    } catch (e) {
        showToast('Import 중 오류가 발생했습니다.', 'error');
    }
    pendingImportFile = null;
    document.getElementById('import-file-name').textContent = '';
}
```

### 3.5 기존 시스템 연동

| 기존 코드 | 변경 여부 | 내용 |
|-----------|----------|------|
| `index.html` (settings 탭 영역) | 수정 | 탭 항목 + 패널 추가, 모달 추가 |
| `app.js` | 수정 | `exportData()`, `onImportFileSelected()`, `confirmImport()` 함수 추가 |
| `GlobalExceptionHandler` | 수정 없음 | 기존 `IllegalArgumentException` 핸들러로 유효성 오류 처리 |
| 기존 Repository 10개 | 수정 없음 | `findAll()` 메서드만 활용 |
| `app.js?v=` 쿼리 파라미터 | 수정 | 현재 `20260412a` → 신규 버전 문자열로 갱신 (캐시 무효화, `index.html` line 988) |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | `BackupDto` 클래스 작성 | Snapshot, Row 클래스 10종, ImportResult 정의 | 낮음 | 없음 |
| T2 | `DataBackupService.exportAll()` 구현 | 전체 데이터 조회 및 Flat DTO 변환 | 중간 | T1 |
| T3 | `DataBackupService.importAll()` 구현 | 삭제→Native INSERT→Sequence 리셋 | 높음 | T1, T2 |
| T4 | `DataBackupController` 작성 | Export(GET), Import(POST multipart) 엔드포인트 | 낮음 | T2, T3 |
| T5 | `index.html` 탭 및 모달 추가 | "데이터 관리" 탭 패널 + Import 확인 모달 | 낮음 | T4 |
| T6 | `app.js` JS 함수 추가 | exportData, onImportFileSelected, confirmImport | 중간 | T5 |
| T7 | 통합 테스트 | Export 후 Import 라운드트립 검증 | 중간 | T6 |

### 4.2 구현 순서

1. **Step 1 — DTO 정의 (T1)**: `BackupDto.java` 파일 생성. 각 테이블에 대응하는 Row inner class 작성. enum 필드는 `String`으로 직렬화되도록 Jackson 기본 동작 활용.

2. **Step 2 — Export 서비스 (T2)**: `DataBackupService`에 `exportAll()` 구현. 각 repository의 `findAll()` 결과를 Row DTO로 변환. FK는 연관 엔티티의 `.getId()` 호출.

3. **Step 3 — Import 서비스 (T3)**:
   - 유효성 검증 메서드 (`validateSnapshot()`)
   - 삭제 메서드 (`deleteAllInOrder()`) — `deleteAllInBatch()` 활용
   - Native INSERT 메서드 — `EntityManager` + `createNativeQuery()` 사용
   - Sequence 리셋 메서드 — 테이블별 `SELECT MAX(id)` 후 `setval('{table}_id_seq', max_id + 1, false)` (§6 SQL 예시 참고)

4. **Step 4 — 컨트롤러 (T4)**: Export는 `ResponseEntity<byte[]>` 반환. Import는 `@RequestParam("file") MultipartFile` 수신 후 Jackson `ObjectMapper`로 파싱.

5. **Step 5 — HTML/JS (T5, T6)**: 탭, 패널, 모달 추가. JS 함수 작성. `app.js?v=` 버전 문자열 갱신.

6. **Step 6 — 검증 (T7)**: Export → 파일 저장 → Import → 데이터 확인.

### 4.3 테스트 계획

**단위 테스트 대상:**
- `DataBackupService.exportAll()`: 전체 테이블 Row 수 검증
- `DataBackupService.importAll()`: 삭제 후 재삽입 건수 검증, 유효성 실패 케이스

**통합 테스트 시나리오:**
1. 데이터 생성 → Export → DB 초기화 → Import → 동일 데이터 확인 (라운드트립 테스트)
2. 잘못된 JSON 형식 파일 Import → 400 오류 + 적절한 메시지 반환
3. `schemaVersion` 미포함 파일 Import → 오류 반환
4. 빈 테이블(데이터 없음) Export → Import 정상 처리

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 리스크 | 설명 | 대응 방안 |
|--------|------|----------|
| ID Sequence 불일치 | Import 후 JPA가 기존 ID와 충돌하는 ID로 새 레코드 생성 시도 | Native INSERT 완료 후 `setval('{table}_id_seq', MAX(id) + 1, false)` 실행으로 해결 |
| JPA 1차 캐시와 Native Query 충돌 | `em.createNativeQuery()`로 직접 INSERT 후 JPA 캐시 미반영 | Native INSERT 후 `em.flush()` + `em.clear()` 호출 |
| 대용량 JSON 파싱 | 수만 건 이상 데이터 시 Jackson ObjectMapper 메모리 부담 | 현재 규모에서는 무방; 추후 필요 시 `JsonParser` 스트리밍으로 전환 |
| PostgreSQL FK 제약 위반 | 삭제 순서 오류 시 FK 제약 오류 | FK 역순 삭제 + `deleteAllInBatch()` 활용 |
| Transactional 범위 내 flush | Native INSERT와 JPA saveAll 혼용 시 flush 타이밍 문제 | 삭제와 삽입을 같은 `@Transactional` 안에서 수행, flush 명시적 호출 |

### 5.2 의존성 리스크

- 향후 엔티티 추가 시 `BackupDto` 및 `DataBackupService`에 수동 추가 필요 (자동화되지 않음)
- `schemaVersion` "1.0" 이후 구조가 변경되면 구버전 파일 Import 불가 (현재 범위 외)

### 5.3 UX 고려사항

- Import 완료 후 전체 SPA 상태를 리셋해야 함 → `loadDashboard()` 호출 + 가능하면 `location.reload()` 검토
- 대용량 파일 업로드 중 UI 피드백(로딩 스피너 또는 토스트 메시지) 제공 필요

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 |
|------|------|
| 전체 엔티티 | `src/main/java/com/timeline/domain/entity/*.java` |
| 전체 Repository | `src/main/java/com/timeline/domain/repository/*.java` |
| 기존 컨트롤러 패턴 | `src/main/java/com/timeline/controller/ProjectController.java` |
| 기존 서비스 패턴 | `src/main/java/com/timeline/service/ProjectService.java` |
| GlobalExceptionHandler | `src/main/java/com/timeline/exception/GlobalExceptionHandler.java` |
| Settings 탭 HTML | `src/main/resources/static/index.html` (line 397~538) |
| Settings JS 함수 | `src/main/resources/static/js/app.js` (`loadSettingsSection()` line 4379) |

### 신규 파일 목록 (예상)

| 파일 | 위치 |
|------|------|
| `BackupDto.java` | `src/main/java/com/timeline/dto/BackupDto.java` |
| `DataBackupService.java` | `src/main/java/com/timeline/service/DataBackupService.java` |
| `DataBackupController.java` | `src/main/java/com/timeline/controller/DataBackupController.java` |

### Jackson 직렬화 설정 참고

- `LocalDate` / `LocalDateTime` 직렬화: Spring Boot는 `jackson-datatype-jsr310`을 자동으로 포함하지만, ISO-8601 문자열 형태로 출력하려면 `application.yml`에 아래 설정이 필요하다. **현재 `application.yml`에 해당 설정이 없으므로 구현 시 반드시 추가해야 한다.**
  ```yaml
  spring:
    jackson:
      serialization:
        write-dates-as-timestamps: false
  ```
  이 설정이 없으면 `LocalDateTime`이 `[2026, 4, 12, 10, 30, 0]` 형태의 배열로 직렬화되어 Import 역직렬화가 실패한다.
- enum 직렬화: Jackson 기본값으로 `.name()` 문자열 사용 (DB 저장 방식과 동일)
- `BigDecimal` 직렬화: Jackson 기본값으로 숫자 그대로 직렬화

### PostgreSQL Sequence 리셋 SQL 예시

```sql
-- 삽입 완료 후 각 테이블의 시퀀스를 max_id + 1로 설정
-- setval(seq, val, false): 다음 nextval() 호출 시 val을 반환 (is_called=false)
SELECT setval('member_id_seq',               (SELECT COALESCE(MAX(id), 0) FROM member) + 1,               false);
SELECT setval('domain_system_id_seq',        (SELECT COALESCE(MAX(id), 0) FROM domain_system) + 1,        false);
SELECT setval('project_id_seq',              (SELECT COALESCE(MAX(id), 0) FROM project) + 1,              false);
SELECT setval('holiday_id_seq',              (SELECT COALESCE(MAX(id), 0) FROM holiday) + 1,              false);
SELECT setval('project_member_id_seq',       (SELECT COALESCE(MAX(id), 0) FROM project_member) + 1,       false);
SELECT setval('project_domain_system_id_seq',(SELECT COALESCE(MAX(id), 0) FROM project_domain_system) + 1,false);
SELECT setval('task_id_seq',                 (SELECT COALESCE(MAX(id), 0) FROM task) + 1,                 false);
SELECT setval('member_leave_id_seq',         (SELECT COALESCE(MAX(id), 0) FROM member_leave) + 1,         false);
SELECT setval('task_link_id_seq',            (SELECT COALESCE(MAX(id), 0) FROM task_link) + 1,            false);
SELECT setval('task_dependency_id_seq',      (SELECT COALESCE(MAX(id), 0) FROM task_dependency) + 1,      false);
-- 주의: PostgreSQL IDENTITY 컬럼의 시퀀스명은 Hibernate ddl-auto: update로 생성 시
--       '{table}_{column}_seq' 패턴(예: member_id_seq)을 따른다. 실제 시퀀스명은
--       SELECT sequencename FROM pg_sequences WHERE schemaname='public'; 로 확인한다.
```
