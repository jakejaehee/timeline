# 개발 계획서: 프로젝트 유형(projectType) 자유 문자열 필드 추가

## 1. 개요

- **기능 설명**: 프로젝트에 사용자가 자유롭게 입력하는 문자열 유형(projectType) 속성을 추가한다. 기존 `ProjectType` enum(`SKU_SYSTEM`, `BUSINESS`, `MUKIE`) 대신 자유 텍스트를 허용하며, 이미 사용된 값은 datalist 자동완성으로 재사용할 수 있다.
- **개발 배경**: 기존 enum 기반 유형은 조직 내 실제 프로젝트 분류와 맞지 않을 수 있고, 새 유형 추가 시 코드 배포가 필요하다. 자유 문자열 필드로 전환하면 운영 유연성이 크게 향상된다.
- **작성일**: 2026-04-11

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- FR-001: `Project` 엔티티에 `projectType` (String, nullable, 최대 100자) 필드를 추가한다.
- FR-002: 기존 `ProjectType` enum 기반 `type` 필드를 `projectType` 문자열 필드로 교체한다.
- FR-003: `ProjectDto.Request` / `Response`에 `projectType` 필드를 추가하고, 기존 enum `type` 필드를 제거한다.
- FR-004: `ProjectService.createProject` / `updateProject`에서 `projectType`을 저장/수정한다.
- FR-005: 프로젝트 생성·수정 모달의 유형 `<select>` 입력을 `<input list="...">` + `<datalist>` 방식으로 교체한다.
- FR-006: datalist는 서버에서 기존 프로젝트들의 `projectType` 값을 중복 제거하여 제공한다 (신규 API).
- FR-007: 프로젝트 목록, 프로젝트 상세, 대시보드의 유형 표시를 `projectType` 값으로 변경한다.
- FR-008: `typeBadge()` 함수를 자유 문자열에서도 동작하도록 수정한다 (고정 CSS 클래스 → 범용 badge 스타일).

### 2.2 비기능 요구사항

- NFR-001: 기존 DB의 `type` 컬럼 데이터를 `project_type` 컬럼으로 마이그레이션한다 (Hibernate ddl-auto: update 환경이므로 새 컬럼 자동 추가 후, 기존 데이터를 수동 SQL로 복사).
- NFR-002: `projectType`은 nullable이며, null/빈 문자열 입력 시 저장 전에 null로 정규화한다.
- NFR-003: 기존에 `ProjectType` enum을 참조하는 `ProjectRepository.findByType(ProjectType)` 메서드를 수정 또는 제거한다.

### 2.3 가정 사항

- 기존 `ProjectType` enum(`SKU_SYSTEM`, `BUSINESS`, `MUKIE`)은 더 이상 사용하지 않으며, 해당 enum 클래스 및 관련 import는 삭제한다.
- Hibernate ddl-auto: update 환경이므로 `project_type VARCHAR(100)` 컬럼은 애플리케이션 기동 시 자동 추가된다. 기존 `type` 컬럼의 데이터 마이그레이션은 별도 SQL 한 줄로 처리한다.
- `type` 컬럼은 기존 데이터 복사 후 직접 drop하지 않고 남겨 두어도 무방하다 (혹은 ddl-auto 환경 특성상 수동 drop 가능).
- datalist 자동완성용 API는 별도 엔드포인트(`GET /api/v1/projects/types`)로 제공한다.
- 유형 값에 대한 길이 제한(100자)과 null 허용을 적용한다. 별도 유효성 검증 UI는 필요 없다.

### 2.4 제외 범위 (Out of Scope)

- 유형값 관리 전용 화면(CRUD): 이번 개발에서 제외. datalist로 재사용 가능한 수준이면 충분하다.
- 유형별 색상 커스터마이징: 이번에는 단일 회색 badge 스타일로 통일한다.
- 유형 필터링(프로젝트 목록 필터): 이번 범위에서 제외한다.
- 기존 `type` 컬럼 물리 삭제: 선택 사항으로 두고, 계획서에서는 가이드만 제시한다.

---

## 3. 시스템 설계

### 3.1 데이터 모델

#### 변경 엔티티: `Project`

| 항목 | 기존 | 변경 후 |
|------|------|---------|
| 필드명 | `type` (`ProjectType` enum) | `projectType` (`String`) |
| 컬럼명 | `type VARCHAR(30)` | `project_type VARCHAR(100)` |
| nullable | true | true |
| 어노테이션 | `@Enumerated(EnumType.STRING)` | 없음 (`@Column`만) |

```java
// 변경 전
@Enumerated(EnumType.STRING)
@Column(length = 30)
private ProjectType type;

// 변경 후
@Column(name = "project_type", length = 100)
private String projectType;
```

#### 데이터 마이그레이션 SQL (Hibernate 기동 후 1회 실행)

```sql
-- 기존 type 값을 새 project_type 컬럼으로 복사
UPDATE project SET project_type = type WHERE project_type IS NULL AND type IS NOT NULL;
```

### 3.2 API 설계

| Method | Endpoint | 설명 | Request | Response |
|--------|----------|------|---------|----------|
| GET | `/api/v1/projects` | 전체 목록 조회 (기존) | - | `projectType: String` 포함 |
| GET | `/api/v1/projects/{id}` | 상세 조회 (기존) | - | `projectType: String` 포함 |
| POST | `/api/v1/projects` | 프로젝트 생성 (기존) | `projectType: String` 추가 | `projectType: String` 포함 |
| PUT | `/api/v1/projects/{id}` | 프로젝트 수정 (기존) | `projectType: String` 추가 | `projectType: String` 포함 |
| **GET** | **`/api/v1/projects/types`** | **기존 유형 목록 조회 (신규)** | - | `["유형A", "유형B", ...]` |

#### 신규 API 상세: `GET /api/v1/projects/types`

- **설명**: 현재 저장된 프로젝트들의 `projectType` 값을 중복 제거하여 정렬 반환 (null 제외)
- **Response Body**:
  ```json
  {
    "success": true,
    "data": ["SKU_SYSTEM", "BUSINESS", "신규유형A"]
  }
  ```

#### Request/Response 필드 변경 요약

```
ProjectDto.Request:
  - 제거: ProjectType type
  + 추가: String projectType

ProjectDto.Response:
  - 제거: ProjectType type
  + 추가: String projectType
```

`ProjectDto.Response`의 `from()` 오버로드는 총 4개이며 모두 수정 대상이다:
1. `from(Project project)` — `.type(...)` → `.projectType(project.getProjectType())`
2. `from(Project project, List<Member>, List<DomainSystem>)` — 동일
3. `from(Project project, long memberCount, LocalDate expectedEndDate)` — 동일
4. `from(Project project, List<Member>, List<DomainSystem>, LocalDate expectedEndDate)` — 동일

### 3.3 서비스 계층

#### 변경: `ProjectService`

- `createProject()`: `request.getProjectType()`을 읽어 빌더에 전달. 빈 문자열이면 null로 정규화.
- `updateProject()`: `project.setProjectType(request.getProjectType())`으로 수정. 동일하게 null 정규화 적용.
- **신규**: `getProjectTypes()` 메서드 추가.

```java
// null 정규화 헬퍼 (createProject/updateProject 양쪽에서 공통 사용)
private String normalizeProjectType(String rawType) {
    return (rawType == null || rawType.isBlank()) ? null : rawType.trim();
}

// createProject() 내 빌더 변경 예시
Project.ProjectBuilder builder = Project.builder()
        .name(request.getName())
        .projectType(normalizeProjectType(request.getProjectType()))
        ...

// updateProject() 내 세터 변경 예시
project.setProjectType(normalizeProjectType(request.getProjectType()));

// ProjectService에 추가
public List<String> getProjectTypes() {
    return projectRepository.findDistinctProjectTypes();
}
```

> 주의: 기존 코드에서 `ProjectService.createProject()`는 `builder.type(request.getType())`으로 enum을 그대로 전달한다. String으로 교체 후 위 정규화 처리를 반드시 적용해야 한다.

#### 변경: `ProjectRepository`

- 제거: `List<Project> findByType(ProjectType type)` (enum 기반, 더 이상 불필요)
- 추가: `@Query`로 distinct projectType 조회

```java
// 신규 메서드
@Query("SELECT DISTINCT p.projectType FROM Project p WHERE p.projectType IS NOT NULL ORDER BY p.projectType")
List<String> findDistinctProjectTypes();
```

#### 변경: `ProjectController`

- 신규 엔드포인트 `GET /api/v1/projects/types` 추가

```java
@GetMapping("/types")
public ResponseEntity<?> getProjectTypes() {
    return ResponseEntity.ok(Map.of(
            "success", true,
            "data", projectService.getProjectTypes()
    ));
}
```

> 주의: Spring MVC 경로 충돌 방지를 위해 `@GetMapping("/types")`는 반드시 `@GetMapping("/{id}")` 앞에 위치해야 한다. 또는 `/{id}` 에 `Long` 타입 바인딩이 실패하면 자동 처리되므로 순서는 무관하다. 그러나 명시적 순서를 위해 앞에 선언한다.

### 3.4 프론트엔드

#### 3.4.1 프로젝트 모달 (index.html)

유형 입력 필드를 `<select>` → `<input type="text" list="project-type-list">` + `<datalist>`로 교체한다.
`projectType`은 nullable이므로 레이블의 필수 표시(`<span class="text-danger">*</span>`)도 함께 제거한다.

```html
<!-- 변경 전 -->
<label for="project-type" class="form-label">유형 <span class="text-danger">*</span></label>
<select class="form-select" id="project-type">
    <option value="SKU_SYSTEM">SKU_SYSTEM</option>
    <option value="BUSINESS">BUSINESS</option>
    <option value="MUKIE">MUKIE</option>
</select>

<!-- 변경 후 -->
<label for="project-type" class="form-label">유형</label>
<input type="text" class="form-control" id="project-type"
       list="project-type-list" maxlength="100"
       placeholder="예: SKU_SYSTEM, BUSINESS (자유 입력 가능)">
<datalist id="project-type-list">
    <!-- JS에서 동적으로 채움 -->
</datalist>
```

> 주의: `maxlength="100"` 속성은 HTML 단에서 바로 추가한다 (§4.3 테스트 시나리오 4번 요건 충족). T-08 작업에 포함한다.

#### 3.4.2 app.js 변경 사항

**showProjectModal() 함수**
- 모달 open 시 `GET /api/v1/projects/types` 호출하여 datalist를 동적으로 채운다. 이 호출은 기존 `Promise.all([members, domain-systems])` 병렬 배열에 추가하여 3개를 동시에 호출한다.
- 수정 모드: `p.type` → `p.projectType`으로 참조 변경 (총 **4곳**).
  - line ~304: 프로젝트 목록 테이블 렌더링
  - line ~588: 프로젝트 목록 카드/행 렌더링 (별도 뷰)
  - line ~704: 프로젝트 상세 `<tr>` 렌더링
  - line ~918: `showProjectModal` 내 수정 모드 초기값 세팅 → `p.type || 'SKU_SYSTEM'` → `p.projectType || ''`
- 초기화 시(신규 모드): `document.getElementById('project-type').value = ''` (기존 `'SKU_SYSTEM'` 기본값 제거).

> 주의: 기존 코드 line ~888에 `document.getElementById('project-type').value = 'SKU_SYSTEM';`이 신규 모드 초기화 코드로 있다. `''`(빈 문자열)로 변경한다.

```javascript
// datalist 채우기 (showProjectModal 내부에서 호출)
async function loadProjectTypesDatalist() {
    var res = await apiCall('/api/v1/projects/types');
    if (res.success && res.data) {
        var datalist = document.getElementById('project-type-list');
        datalist.innerHTML = res.data.map(function(t) {
            return '<option value="' + escapeHtml(t) + '">';
        }).join('');
    }
}
```

**saveProject() 함수**
- 기존: `var type = document.getElementById('project-type').value;` (`<select>` 값을 그대로 사용)
- 변경: `var type = document.getElementById('project-type').value.trim() || null;` (빈 문자열 → null 정규화)
- request body 필드명을 `type` → `projectType`으로 변경.

```javascript
// 변경 전
var type = document.getElementById('project-type').value;
// ...
body: JSON.stringify({ type: type, ... })

// 변경 후
var type = document.getElementById('project-type').value.trim() || null;
// ...
body: JSON.stringify({ projectType: type, ... })
```

**typeBadge() 함수**
- 자유 문자열에서도 동작하도록 수정. 고정 CSS 클래스(`badge-SKU_SYSTEM` 등) 대신 범용 스타일로 변경.
- null/빈 문자열이면 빈 문자열 반환.

```javascript
// 변경 전
function typeBadge(type) {
    return '<span class="badge-status badge-' + type + '">' + type + '</span>';
}

// 변경 후
function typeBadge(type) {
    if (!type) return '';
    return '<span class="badge-project-type">' + escapeHtml(type) + '</span>';
}
```

**렌더링 참조 변경**
- 위의 showProjectModal() 변경 항목에 통합되어 있음 (총 4곳). 별도 추가 작업 없음.

#### 3.4.3 styles.css 변경 사항

- 기존 `badge-SKU_SYSTEM`, `badge-BUSINESS`, `badge-MUKIE` 클래스는 삭제한다.
- 신규 `badge-project-type` 클래스를 추가한다 (회색 계열 범용 배지 스타일).

```css
/* 변경 전 - 삭제 대상 */
.badge-SKU_SYSTEM { background-color: #ede7f6; color: #4527a0; }
.badge-BUSINESS   { background-color: #e0f2f1; color: #00695c; }
.badge-MUKIE      { background-color: #fce4ec; color: #ad1457; }

/* 변경 후 - 신규 추가 */
/* 기존 typeBadge()는 badge-status 클래스와 함께 사용했으므로 padding/border-radius/font-size를 badge-project-type에 포함한다 */
.badge-project-type {
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
    background-color: #e8eaf6;
    color: #283593;
}
```

> 주의: 기존 `typeBadge()` 함수는 `badge-status badge-{type}` 두 클래스를 동시에 붙였으므로 공통 배지 스타일(`badge-status`: padding/border-radius/font-size)이 적용되었다. 변경 후에는 `badge-status` 클래스를 제거하고 신규 `badge-project-type` 단일 클래스로 통일하므로, 해당 공통 스타일을 `badge-project-type` 정의 안에 포함해야 한다.

### 3.5 기존 시스템 연동 및 영향 범위

| 파일 | 변경 유형 | 변경 내용 요약 |
|------|----------|----------------|
| `Project.java` | 수정 | `type` 필드 제거, `projectType` String 필드 추가 |
| `ProjectType.java` | **삭제** | enum 클래스 전체 삭제 |
| `ProjectDto.java` | 수정 | `type: ProjectType` → `projectType: String` (Request, Response, 4개 `from()` 메서드 모두) |
| `ProjectService.java` | 수정 | `type` → `projectType` 참조, `getProjectTypes()` 신규 추가 |
| `ProjectController.java` | 수정 | `GET /types` 엔드포인트 신규 추가 |
| `ProjectRepository.java` | 수정 | `findByType(ProjectType)` 제거, `findDistinctProjectTypes()` 신규 추가 |
| `index.html` | 수정 | `<select>` → `<input list>` + `<datalist>` 교체, 유형 레이블 필수 표시(`*`) 제거, `maxlength="100"` 추가 |
| `app.js` | 수정 | `loadProjectTypesDatalist()` 신규, `p.type` → `p.projectType` 참조 변경 (**4곳**: line ~304/588/704/918 + 초기화 line ~888 빈 문자열 변경), `typeBadge()` 수정, `saveProject()` body 수정 |
| `styles.css` | 수정 | 고정 유형 badge 클래스 3개 삭제, `badge-project-type` 신규 추가 |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T-01 | `ProjectType` enum 삭제 | `ProjectType.java` 파일 삭제 | 낮음 | 없음 |
| T-02 | `Project` 엔티티 수정 | `type` → `projectType: String` 변경 | 낮음 | T-01 |
| T-03 | `ProjectDto` 수정 | Request/Response 및 4개 `from()` 메서드에서 `type` → `projectType` 변경 | 낮음 | T-01 |
| T-04 | `ProjectRepository` 수정 | `findByType` 제거, `findDistinctProjectTypes` 추가 | 낮음 | T-01 |
| T-05 | `ProjectService` 수정 | `type` → `projectType` 참조 변경, `getProjectTypes()` 추가 | 낮음 | T-02, T-03, T-04 |
| T-06 | `ProjectController` 수정 | `GET /types` 엔드포인트 추가 | 낮음 | T-05 |
| T-07 | 데이터 마이그레이션 SQL 실행 | `UPDATE project SET project_type = type WHERE project_type IS NULL AND type IS NOT NULL;` | 낮음 | T-02 기동 후 |
| T-08 | `index.html` 모달 수정 | `<select>` → `<input list>` + `<datalist>` 교체 | 낮음 | 없음 |
| T-09 | `app.js` 수정 | 참조 변경, `loadProjectTypesDatalist()` 추가, `typeBadge()` 수정 | 중간 | T-06, T-08 |
| T-10 | `styles.css` 수정 | 고정 클래스 제거, `badge-project-type` 추가 | 낮음 | 없음 |
| T-11 | 통합 확인 | 생성/수정/목록/상세/datalist 동작 검증 | 낮음 | T-01~T-10 |

### 4.2 구현 순서

1. **Step 1 - 백엔드 (T-01 ~ T-06)**: 빌드 오류 없이 컴파일되는 것이 목표.
   - `ProjectType.java` 삭제
   - `Project.java` 필드 변경
   - `ProjectDto.java` 수정
   - `ProjectRepository.java` 수정
   - `ProjectService.java` 수정
   - `ProjectController.java` 수정
   - `./gradlew compileJava`로 컴파일 확인

2. **Step 2 - 데이터 마이그레이션 (T-07)**:
   - 애플리케이션을 기동하여 Hibernate가 `project_type` 컬럼을 자동 생성한 후
   - DB에서 마이그레이션 SQL 1회 실행

3. **Step 3 - 프론트엔드 (T-08 ~ T-10)**:
   - `index.html` 모달 HTML 수정
   - `app.js` 수정 (참조 변경, 신규 함수)
   - `styles.css` 수정

4. **Step 4 - 통합 확인 (T-11)**:
   - 프로젝트 생성 → 유형 자유 입력 → 저장 확인
   - 프로젝트 수정 → 기존 유형 datalist 자동완성 동작 확인
   - 목록/상세에서 `badge-project-type` 배지 정상 렌더링 확인

### 4.3 테스트 계획

#### 단위 테스트 대상
- `ProjectService.getProjectTypes()`: 중복 제거, null 제외, 정렬 결과 검증

#### 수동 통합 테스트 시나리오

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| 1 | 유형 입력 없이 프로젝트 생성 | `projectType = null` 저장, 목록에서 유형 배지 미표시 |
| 2 | "신규유형X" 자유 입력 후 생성 | 저장 성공, 다음 모달 오픈 시 datalist에 "신규유형X" 포함 |
| 3 | 기존 유형 datalist에서 선택 후 수정 | 선택한 값으로 저장 성공 |
| 4 | 100자 초과 입력 | 브라우저 `maxlength` 속성으로 UI에서 제한 (`<input maxlength="100">` 추가) |
| 5 | 기존 데이터 마이그레이션 SQL 실행 후 목록 조회 | 기존 `type` 값이 `projectType`으로 정상 표시 |

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 리스크 | 설명 | 완화 방안 |
|--------|------|----------|
| 기존 `type` 컬럼 잔존 | Hibernate ddl-auto: update는 컬럼 삭제를 하지 않음. `type` 컬럼이 DB에 남음 | 마이그레이션 SQL 실행 후 수동으로 `ALTER TABLE project DROP COLUMN type;` 실행 가능. 강제성 없음 |
| `findByType(ProjectType)` 호출 잔존 | 다른 코드에서 해당 메서드를 호출하고 있으면 컴파일 오류 | `./gradlew compileJava` 빌드로 즉시 확인 가능. 현재 코드베이스에서는 미사용으로 확인됨 |
| Spring MVC 경로 `/types` vs `/{id}` 충돌 | `@GetMapping("/types")`가 `@GetMapping("/{id}")`에 의해 가려질 수 있음 | `/{id}`에 바인딩되는 타입이 `Long`이므로 문자열 "types"는 바인딩 실패하여 자동으로 `/types`가 선택됨. 안전함 |
| datalist가 빈 목록일 때 UX | 처음 사용 시 프로젝트가 없거나 모두 유형 미지정이면 datalist가 비어 있음 | placeholder 텍스트로 자유 입력 유도. 문제 없음 |

### 5.2 의존성 리스크

- `ProjectType` enum을 직접 참조하는 코드가 현재 4개 파일(`Project.java`, `ProjectDto.java`, `ProjectRepository.java`, enum 파일 자체)로 한정됨. 확인 완료.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 파일 | 경로 |
|------|------|
| Project 엔티티 | `src/main/java/com/timeline/domain/entity/Project.java` |
| ProjectType enum (삭제 대상) | `src/main/java/com/timeline/domain/enums/ProjectType.java` |
| ProjectDto | `src/main/java/com/timeline/dto/ProjectDto.java` |
| ProjectService | `src/main/java/com/timeline/service/ProjectService.java` |
| ProjectController | `src/main/java/com/timeline/controller/ProjectController.java` |
| ProjectRepository | `src/main/java/com/timeline/domain/repository/ProjectRepository.java` |
| 프론트엔드 HTML | `src/main/resources/static/index.html` |
| 프론트엔드 JS | `src/main/resources/static/js/app.js` |
| 프론트엔드 CSS | `src/main/resources/static/css/styles.css` |

### 주요 변경 포인트 요약 (구현자용 체크리스트)

- [ ] `ProjectType.java` 삭제
- [ ] `Project.java`: `type` → `projectType: String` 교체
- [ ] `ProjectDto.java`: Request/Response 및 `from()` 4개 메서드 수정
- [ ] `ProjectRepository.java`: `findByType` 제거, `findDistinctProjectTypes` 추가
- [ ] `ProjectService.java`: `type` → `projectType` 변경, `getProjectTypes()` 추가
- [ ] `ProjectController.java`: `GET /types` 엔드포인트 추가
- [ ] DB 마이그레이션 SQL 실행 (앱 기동 후 1회)
- [ ] `index.html`: 유형 `<select>` → `<input list>` 교체 + `maxlength="100"` 추가 + 유형 레이블 필수 표시(`*`) 제거
- [ ] `app.js`: `loadProjectTypesDatalist()` 추가, `p.type` → `p.projectType` **4곳** (line ~304/588/704/918) + 신규 모드 초기화 line ~888 `'SKU_SYSTEM'` → `''` 변경, `typeBadge()` 수정, `saveProject()` 수정
- [ ] `styles.css`: 고정 badge 3개 제거, `badge-project-type` 추가
