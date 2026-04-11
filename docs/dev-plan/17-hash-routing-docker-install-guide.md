# 개발 계획서: URL Hash 라우팅 + Docker Compose + 설치 가이드

## 1. 개요

### 기능 설명
세 가지 독립적인 개선 사항을 함께 구현한다.

1. **URL Hash 라우팅**: SPA에서 새로고침 또는 URL 공유 시 현재 화면이 유지되도록 `window.location.hash` 기반 라우팅을 적용한다.
2. **Docker Compose 설치 환경**: `git clone` 후 `docker-compose up` 한 명령으로 앱 전체를 실행할 수 있는 환경을 구성한다.
3. **설치 가이드 문서**: Docker Compose 방식과 로컬 직접 실행 방식을 모두 설명하는 `INSTALL.md`를 작성한다.

### 개발 배경 및 목적
- 현재 새로고침 시 항상 대시보드로 초기화되어 딥링크 공유나 작업 재개가 불편하다.
- Docker 환경 없이는 PostgreSQL 설치, 환경 변수 설정 등 onboarding 장벽이 높다.
- 설치 문서 부재로 신규 기여자나 사용자가 직접 실행 방법을 파악하기 어렵다.

### 작성일
2026-04-12

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

**Hash 라우팅**

- FR-001: 사이드바 메뉴 클릭 시 `window.location.hash`를 해당 섹션명으로 업데이트한다.
- FR-002: 프로젝트 상세(`showProjectDetail`) 진입 시 hash를 `#project/{id}` 형태로 업데이트한다.
- FR-003: 간트차트에서 특정 프로젝트 선택 시 hash를 `#gantt/{projectId}` 형태로 업데이트한다.
- FR-004: 멤버별 태스크(assignee-schedule)에서 멤버 선택 시 hash를 `#assignee-schedule/{memberId}` 형태로 업데이트한다.
- FR-005: 페이지 로드 시(`DOMContentLoaded`) `window.location.hash`를 파싱하여 해당 화면으로 직접 이동한다. hash가 없으면 기존처럼 대시보드를 로드한다.
- FR-006: 브라우저 뒤로/앞으로 버튼(`popstate` 이벤트)으로 화면 이동이 가능해야 한다.
- FR-007: 사이드바의 `href="#"` 를 실제 hash URL로 교체하여 접근성을 높인다.

**지원 hash 목록**

| hash 패턴 | 이동 대상 |
|---|---|
| `#dashboard` | 대시보드 |
| `#projects` | 프로젝트 목록 |
| `#project/{id}` | 프로젝트 상세 (id번 프로젝트) |
| `#assignee-schedule` | 멤버별 태스크 (멤버 미선택) |
| `#assignee-schedule/{memberId}` | 멤버별 태스크 (해당 멤버 선택) |
| `#gantt` | 간트차트 (프로젝트 미선택) |
| `#gantt/{projectId}` | 간트차트 (해당 프로젝트 선택) |
| `#warning-center` | 경고 센터 |
| `#settings` | 설정 |
| `#ai-parser` | AI Parser |

**Docker Compose**

- FR-008: `docker-compose.yml`에 PostgreSQL 16과 Spring Boot 앱 두 컨테이너를 정의한다.
- FR-009: `Dockerfile`은 multi-stage build(Gradle 빌드 → JRE 17 runtime) 방식으로 작성한다.
- FR-010: `.env.example` 파일을 제공하여 사용자가 환경 변수를 쉽게 복사·수정할 수 있도록 한다.
- FR-011: `docker-compose.yml`은 `.env` 파일의 환경 변수를 자동으로 읽는다.
- FR-012: PostgreSQL 데이터는 named volume으로 영속화한다.
- FR-013: 앱 컨테이너는 DB 컨테이너가 healthy 상태가 된 후 기동한다(`depends_on: condition: service_healthy`).

**설치 가이드**

- FR-014: `INSTALL.md`에 Docker Compose 방식과 로컬 직접 실행 방식을 모두 설명한다.
- FR-015: 환경 변수 테이블(이름, 기본값, 설명)을 포함한다.
- FR-016: 최소 요구 환경(Java 17, Docker 버전 등)을 명시한다.

### 2.2 비기능 요구사항

- NFR-001: hash 라우팅 변경이 기존 기능(모달 열림, CRUD 동작 등)에 영향을 주지 않아야 한다.
- NFR-002: Docker 이미지 빌드 시 `.env` 파일이 이미지에 포함되지 않아야 한다(`.dockerignore` 사용).
- NFR-003: `INSTALL.md`는 터미널 명령어 복사만으로 설치가 완료되는 수준의 구체성을 가져야 한다.

### 2.3 가정 사항

- hash 라우팅에서 `history.pushState`는 사용하지 않는다. SPA 서버 라우팅 설정 없이 hash만으로 처리한다.
- 간트차트에서 `all`(전체 프로젝트) 선택도 `#gantt/all`로 표현한다.
- Docker Compose 환경에서 Claude CLI(`CLAUDE_CLI_PATH`)는 별도로 컨테이너에 설치하지 않는다. AI Parser는 로컬 직접 실행 시에만 동작한다고 가정한다.
- `settings` 섹션은 내부 탭(holidays/members/domains) 선택 상태는 hash에 포함하지 않는다 (복잡도 대비 실용성이 낮음).

### 2.4 제외 범위 (Out of Scope)

- HTML5 History API(`pushState`) 기반의 URL path 라우팅 (`/project/123` 형식)
- 인증/세션 상태의 URL 유지
- Docker Swarm / Kubernetes 배포 설정
- CI/CD 파이프라인 구성

---

## 3. 시스템 설계

### 3.1 신규 파일 목록

| 파일 경로 | 설명 |
|---|---|
| `Dockerfile` | Multi-stage build Dockerfile |
| `docker-compose.yml` | PostgreSQL + 앱 컨테이너 구성 |
| `.env.example` | 환경 변수 예시 파일 |
| `.dockerignore` | Docker 빌드 제외 목록 |
| `INSTALL.md` | 설치 가이드 문서 |

변경 파일: `src/main/resources/static/js/app.js`, `src/main/resources/static/index.html`

### 3.2 Hash 라우팅 설계

#### 3.2.1 라우팅 함수 구조

`app.js`에 다음 세 개의 전역 함수를 추가한다.

```
navigateTo(hash)          - hash 변경 + 화면 이동 (pushState 없이 hash만 갱신)
handleHashChange()        - 현재 hash를 파싱하여 적절한 load 함수 호출
parseHash(hashStr)        - '#gantt/123' → { section: 'gantt', param: '123' } 로 파싱
```

#### 3.2.2 기존 함수 변경 범위

**`showSection(sectionName, linkEl)`**
- hash 업데이트: `window.location.hash = sectionName;` 라인 추가
- `navigateTo` 를 통해 호출되도록 리팩토링하거나, 함수 내부에서 직접 hash를 갱신하는 방식 중 선택
- 권장: 함수 내부에서 직접 갱신 (기존 호출부를 최소 변경)

**`showProjectDetail(projectId, tabName)`**
- 진입 시 `window.location.hash = 'project/' + projectId;` 업데이트

**`showGanttChart(projectId)`**
- 진입 시 `window.location.hash = 'gantt/' + projectId;` 업데이트

**`onGanttProjectChange(projectId)`**
- 선택 변경 시 hash 업데이트: `window.location.hash = projectId ? 'gantt/' + projectId : 'gantt';`

**`selectScheduleMember(memberId, name)`**
- 선택 시 hash 업데이트: `window.location.hash = 'assignee-schedule/' + memberId;`

**`showProjectList()`**
- `showSection`을 거치지 않고 `loadProjects()`를 직접 호출하는 함수이므로(§6.2 참조), hash 갱신을 이 함수 내부에서 직접 수행해야 한다: `window.location.hash = 'projects';`

**`DOMContentLoaded` 핸들러**
- 실제 코드(line 4597~4645)에서 `loadDashboard()`는 핸들러 마지막 줄(line 4644)에만 있다. `initColorPicker()`, `initAssigneeConflictCheck()`, 탭 이벤트 리스너 등록, 경고 배지 초기 로드 등 앞선 로직은 그대로 유지하고, **마지막 `loadDashboard()` 한 줄만** `handleHashChange()`로 교체한다.
- `window.addEventListener('hashchange', handleHashChange)` 등록은 `handleHashChange()` 호출 직전에 추가한다.

#### 3.2.3 `handleHashChange()` 로직

```javascript
function handleHashChange() {
    var raw = window.location.hash.replace('#', '') || 'dashboard';
    var parsed = parseHash(raw);

    switch(parsed.section) {
        case 'project':
            showProjectDetail(parseInt(parsed.param));
            break;
        case 'gantt':
            currentProjectId = parsed.param ? (parsed.param === 'all' ? 'all' : parseInt(parsed.param)) : null;
            showSection('gantt');
            break;
        case 'assignee-schedule':
            // memberId가 있으면 선택 상태 복원, 없으면 null로 초기화하여 이전 선택 유지 방지
            currentScheduleMemberId = parsed.param ? parseInt(parsed.param) : null;
            // currentScheduleMemberName을 null로 설정한다.
            // loadAssigneeSchedule()은 멤버 목록 HTML을 그린 뒤 line 3191~3192에서
            // selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName)을 호출한다.
            // name이 null이면 UI에 "null 태스크 큐"가 렌더링되므로,
            // loadAssigneeSchedule() 내부의 해당 호출을 아래와 같이 수정해야 한다:
            //   var matchEl = listEl.querySelector('[data-member-id="' + currentScheduleMemberId + '"]');
            //   var mname = matchEl ? matchEl.getAttribute('data-member-name') : '';
            //   await selectScheduleMember(currentScheduleMemberId, mname);
            currentScheduleMemberName = null;
            showSection('assignee-schedule');
            break;
        default:
            // dashboard, projects, warning-center, settings, ai-parser
            showSection(parsed.section);
    }
}
```

#### 3.2.4 hash 업데이트 시 `popstate` vs `hashchange`

- `window.location.hash = '...'` 변경 시 `hashchange` 이벤트가 자동 발생한다.
- `showSection` 내부에서 hash를 갱신하면 `hashchange` → `handleHashChange` → `showSection` 무한 루프가 발생할 수 있다.
- **방지 전략**: `handleHashChange` 내부에서 `showSection`을 호출하지 않고 각 load 함수를 직접 호출하거나, `isHashChangeInProgress` 플래그를 사용하여 중복 실행을 방지한다.

**최종 권장 구현 방식** (단순성 우선, `_isNavigating` 플래그 + 동일 hash 스킵 조합):

```javascript
var _isNavigating = false;

function handleHashChange() {
    if (_isNavigating) return;
    // ... 라우팅 처리
}

function showSection(sectionName, linkEl) {
    _isNavigating = true;
    // 기존 showSection 로직
    // ...
    // hash 업데이트 (현재 hash와 동일하면 스킵하여 불필요한 hashchange 유발 방지)
    if (window.location.hash !== '#' + sectionName) {
        window.location.hash = sectionName;
    }
    // 비동기 로드 함수(loadGanttSection 등)의 완료를 보장할 수 없으므로
    // setTimeout 대신 플래그를 즉시 해제하고 hashchange 억제는 "동일 hash 스킵" 조건에 의존한다.
    // showSection 자신이 hash를 갱신한 경우에는 갱신 직후 _isNavigating = false를 실행해도
    // 브라우저가 hashchange 이벤트를 동기적으로 발생시키지 않으므로 루프가 발생하지 않는다.
    _isNavigating = false;
}
```

> **주의**: `setTimeout(..., 100)` 방식은 `loadGanttSection` 등 비동기 로드 함수가 100ms 내에 완료되지 않으면 뒤로가기 이후 hashchange 이벤트가 플래그 해제 전에 도달할 수 있다. 대신 플래그를 즉시 해제하고 hash 스킵 조건(`window.location.hash !== '#' + sectionName`)으로 루프를 차단하는 것이 더 안전하다.

### 3.3 사이드바 `href` 수정

현재 `index.html`의 사이드바 링크:
```html
<a href="#" class="nav-link" data-section="projects" onclick="showSection('projects', this)">
```

변경 후:
```html
<a href="#projects" class="nav-link" data-section="projects" onclick="showSection('projects', this); return false;">
```

- `href` 속성을 실제 hash URL로 변경하여 마우스 오른쪽 클릭 복사, 새 탭 열기 등이 정상 동작한다.
- `onclick`에 `return false`를 추가하거나 `event.preventDefault()`를 호출하면 `href`의 hash 변경과 `showSection` 내부의 hash 변경이 중복 실행되는 것을 막을 수 있다.
- 단, `showSection` 내부의 "현재 hash와 동일하면 스킵" 조건이 있으면 `href`가 먼저 hash를 갱신한 후 `showSection`이 동일 hash를 감지하여 재갱신을 건너뛰므로 `return false` 없이도 정상 동작한다. 그러나 이 경우 `href` 클릭에 의한 `hashchange` 이벤트가 `handleHashChange`를 호출하여 화면 이동을 **두 번** 실행할 수 있으므로, `return false`를 명시하여 `href` 직접 이동을 막고 `showSection` 경로만 사용하는 것을 권장한다.

### 3.4 Dockerfile 설계

Multi-stage build 구조:

```dockerfile
# Stage 1: Build
FROM gradle:8.14-jdk17 AS builder
WORKDIR /app
COPY build.gradle settings.gradle ./
# 의존성 레이어 캐시를 위해 소스 전 dependencies 다운로드
RUN gradle dependencies --no-daemon || true
COPY src/ src/
RUN gradle bootJar --no-daemon -x test

# Stage 2: Runtime
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar
EXPOSE 2403
ENTRYPOINT ["java", "-jar", "app.jar"]
```

- Base image: `gradle:8.14-jdk17` (빌드), `eclipse-temurin:17-jre-jammy` (런타임)
- 런타임 이미지에 Gradle, JDK 등 빌드 도구를 포함하지 않아 이미지 크기를 줄인다.
- `--no-daemon` 플래그로 Docker 빌드 환경에서 Gradle 데몬이 불필요하게 시작되는 것을 막는다.

### 3.5 docker-compose.yml 설계

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-timeline}
      POSTGRES_USER: ${DB_USERNAME:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USERNAME:-postgres} -d ${DB_NAME:-timeline}"]
      interval: 5s
      timeout: 5s
      retries: 10
    ports:
      - "5432:5432"   # 로컬 DB 클라이언트 접속용 (선택)

  app:
    build: .
    ports:
      - "2403:2403"
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-timeline}
      DB_USERNAME: ${DB_USERNAME:-postgres}
      DB_PASSWORD: ${DB_PASSWORD:-postgres}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
```

- `DB_HOST`는 컨테이너 서비스명 `db`로 고정한다 (컨테이너 내부 DNS).
- 환경 변수 미설정 시 기본값이 적용되어 별도 `.env` 없이도 즉시 실행 가능하다.
- `restart: unless-stopped` 로 컨테이너 재시작 시 자동 복구한다.

### 3.6 .env.example 설계

```env
# Timeline 환경 변수 예시
# 이 파일을 .env 로 복사하고 값을 수정하세요.
# cp .env.example .env

# PostgreSQL 연결 정보
DB_HOST=localhost
DB_PORT=5432
DB_NAME=timeline
DB_USERNAME=postgres
DB_PASSWORD=postgres

# Claude CLI 경로 (AI Parser 기능 사용 시)
# Docker 환경에서는 미지원
# CLAUDE_CLI_PATH=/usr/local/bin/claude
```

### 3.7 .dockerignore 설계

```
.git
.gradle
build/
.env
*.md
.DS_Store
.claude/
docs/
```

- `.env`를 명시적으로 제외하여 비밀 정보가 이미지에 포함되지 않도록 한다.
- `build/` 디렉터리를 제외하여 로컬 빌드 산출물이 컨테이너 빌드를 오염시키지 않는다.

### 3.8 INSTALL.md 구조

1. 요구 환경
2. 빠른 시작 (Docker Compose 방식) — 3단계
3. 로컬 직접 실행 방식
4. 환경 변수 목록 (테이블)
5. 포트 정보
6. 자주 묻는 문제

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 설명 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | `parseHash`, `handleHashChange` 함수 구현 | hash 파싱 및 라우팅 분기 로직 | 중 | 없음 |
| T2 | `showSection` 내 hash 업데이트 추가 | 루프 방지 플래그 포함 | 중 | T1 |
| T3 | `showProjectDetail` hash 업데이트 | `#project/{id}` 반영 | 하 | T1 |
| T4 | `showGanttChart`, `onGanttProjectChange` hash 업데이트 | `#gantt/{id}` 반영 | 하 | T1 |
| T5 | `selectScheduleMember` hash 업데이트 | `#assignee-schedule/{id}` 반영 | 하 | T1 |
| T6 | `showProjectList` hash 복원 | `#projects` 반영 | 하 | T2 |
| T7 | `DOMContentLoaded` 초기화 교체 | `loadDashboard()` → `handleHashChange()` | 하 | T1 |
| T8 | `popstate` / `hashchange` 이벤트 리스너 등록 | | 하 | T1 |
| T9 | 사이드바 `href` 속성 업데이트 | `index.html` 수정 | 하 | T2 |
| T10 | `Dockerfile` 작성 | Multi-stage build | 중 | 없음 |
| T11 | `docker-compose.yml` 작성 | healthcheck 포함 | 하 | T10 |
| T12 | `.env.example` 작성 | | 하 | 없음 |
| T13 | `.dockerignore` 작성 | | 하 | T10 |
| T14 | `INSTALL.md` 작성 | Docker + 직접 실행 방식 | 중 | T10, T11 |
| T15 | 전체 동작 검증 | 새로고침, 뒤로가기, docker-compose up | 중 | 전체 |

### 4.2 구현 순서

1. **Step 1 - Hash 라우팅 핵심 함수 (T1)**
   - `app.js` 최상단 전역 변수에 `_isNavigating = false` 추가
   - `parseHash(hashStr)` 함수 구현
   - `handleHashChange()` 함수 구현

2. **Step 2 - 기존 네비게이션 함수에 hash 업데이트 추가 (T2~T6)**
   - `showSection`: 루프 방지 포함하여 hash 업데이트
   - `showProjectDetail`, `showGanttChart`, `onGanttProjectChange`, `selectScheduleMember`, `showProjectList` 각각 hash 업데이트 추가
   - `loadAssigneeSchedule`: 이전 선택 재호출 시 멤버 name을 DOM에서 직접 조회하도록 수정 (§3.2.3 `assignee-schedule` case 주석 참조)

3. **Step 3 - 초기화 및 이벤트 리스너 교체 (T7, T8)**
   - `DOMContentLoaded` 내 `loadDashboard()` → `handleHashChange()` 교체
   - `window.addEventListener('hashchange', handleHashChange)` 추가

4. **Step 4 - index.html 사이드바 href 수정 (T9)**
   - 각 메뉴 항목의 `href="#"` → `href="#sectionName"` 변경

5. **Step 5 - Docker 파일 작성 (T10~T13)**
   - `Dockerfile`, `docker-compose.yml`, `.env.example`, `.dockerignore` 작성

6. **Step 6 - INSTALL.md 작성 (T14)**
   - Docker Compose 방식, 로컬 직접 실행 방식, 환경 변수 테이블 포함

7. **Step 7 - 검증 (T15)**
   - 각 화면 진입 후 새로고침 → 동일 화면 복원 확인
   - 브라우저 뒤로/앞으로 버튼 동작 확인
   - `docker-compose up` 기동 확인

### 4.3 테스트 계획

**Hash 라우팅 동작 검증 (수동)**

| 시나리오 | 기대 결과 |
|---|---|
| 대시보드에서 새로고침 | `#dashboard` URL, 대시보드 표시 |
| 프로젝트 목록에서 새로고침 | `#projects` URL, 프로젝트 목록 표시 |
| 프로젝트 상세 진입 후 새로고침 | `#project/{id}` URL, 해당 프로젝트 상세 표시 |
| 간트차트에서 프로젝트 선택 후 새로고침 | `#gantt/{projectId}` URL, 해당 프로젝트 간트차트 표시 |
| 멤버별 태스크에서 멤버 선택 후 새로고침 | `#assignee-schedule/{memberId}`, 해당 멤버 큐 표시 |
| 경고 센터 새로고침 | `#warning-center` URL, 경고 센터 표시 |
| 설정 새로고침 | `#settings` URL, 설정 표시 |
| 잘못된 hash(`#invalid`) 진입 | 대시보드로 폴백 |
| 뒤로가기 버튼 | 이전 화면으로 이동 |
| hash 없이 접속(`/`) | 대시보드 로드 |
| 모달 열기/닫기 | hash 변경 없음, 모달 정상 동작 |

**Docker 빌드 검증 (수동)**

| 시나리오 | 기대 결과 |
|---|---|
| `docker-compose up --build` | DB 기동 → healthcheck 통과 → 앱 기동 순서 |
| `http://localhost:2403` 접속 | Timeline 앱 정상 표시 |
| DB 컨테이너 재시작 후 앱 재시작 | 데이터 유지 (volume) |
| `.env` 없이 실행 | 기본값으로 정상 동작 |

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

**R1: hashchange 루프**
- 원인: `showSection` 내부에서 hash를 변경하면 `hashchange` 이벤트가 발생 → `handleHashChange` 재호출 → `showSection` 재호출 무한 루프
- 완화: `_isNavigating` 플래그 또는 "현재 hash와 동일하면 hash 갱신 스킵" 조건으로 방지

**R2: 프로젝트 상세 진입 시 `currentSection` 상태**
- `showProjectDetail`은 `currentSection !== 'projects'` 분기 처리를 내부적으로 가지고 있어 hash 라우팅 시 `showSection('projects')`를 먼저 호출하지 않아도 직접 동작해야 한다.
- `handleHashChange`에서 `case 'project'`는 `showProjectDetail(id)` 직접 호출 (showSection 거치지 않음)로 처리.

**R3: `currentScheduleMemberId` 복원 타이밍**
- `handleHashChange`에서 `currentScheduleMemberId`를 설정 후 `showSection('assignee-schedule')` 호출 → `loadAssigneeSchedule()` 내부에서 `if (currentScheduleMemberId)` 분기로 자동 선택된다. 현재 코드가 이미 이 패턴을 지원하므로 문제 없음.
- 단, `selectScheduleMember` 내부에서 hash를 `#assignee-schedule/{memberId}`로 갱신할 경우, `loadAssigneeSchedule`이 내부에서 `selectScheduleMember`를 재호출하는 흐름에서 hash가 한 번 더 갱신된다. 이 갱신은 동일한 값으로 덮어쓰는 것이므로 실제 문제는 없지만, `_isNavigating` 플래그가 `true`인 상태라면 `handleHashChange`가 재진입을 차단하므로 안전하다. `_isNavigating` 플래그는 `showSection` 진입 시 `true`로 설정되므로 이 경로에서 루프는 발생하지 않는다.

**R4: Docker 빌드 시간**
- Multi-stage build에서 Gradle 의존성 다운로드가 느릴 수 있다.
- 의존성 레이어를 소스 코드 레이어 전에 배치하여 Docker 캐시를 최대한 활용한다.

**R5: `.env` 파일 Docker 이미지 포함 위험**
- `.dockerignore`에 `.env`를 명시하여 빌드 컨텍스트에서 제외한다.
- `docker-compose.yml`에서는 환경 변수를 `environment` 섹션 또는 `env_file` 지시어로 주입한다.

### 5.2 의존성 리스크

- `showGanttChart` 함수는 `currentProjectId`를 설정하고 `showSection('gantt')`를 호출하는 방식이다. 이 순서가 `handleHashChange` 내부에서도 동일하게 유지되어야 한다.
- `assignee-schedule` 복원 시 멤버 ID가 DB에서 삭제된 경우: `loadAssigneeSchedule` 내부에서 멤버를 찾지 못해 선택 상태가 초기화된다. 별도 오류 없이 조용히 폴백하면 충분하다.

---

## 6. 참고 사항

### 6.1 관련 기존 코드 경로

| 파일 | 관련 함수 |
|---|---|
| `src/main/resources/static/js/app.js` | `showSection`, `showProjectDetail`, `showGanttChart`, `onGanttProjectChange`, `selectScheduleMember`, `showProjectList`, `DOMContentLoaded` (line 4597) |
| `src/main/resources/static/index.html` | 사이드바 nav-link `href="#"` (line 24~58) |
| `src/main/resources/application.yml` | 서버 포트 2403, DB 연결 환경 변수 |
| `.env` | 로컬 개발 환경 변수 (DB_HOST, DB_PORT 등) |
| `build.gradle` | Spring Boot 3.5, Java 17, `bootJar` 태스크 |

### 6.2 `showSection` 호출 관계 요약

```
사이드바 클릭                    → showSection(sectionName, linkEl)
showGanttChart(projectId)       → currentProjectId 설정 → showSection('gantt')
showProjectList()               → loadProjects() 직접 호출 (showSection 거치지 않음)
showProjectDetail(id)           → showSection 내부 처리 포함 (독자 로직)
topbar 경고 버튼                → showSection('warning-center')
topbar 설정 버튼                → showSection('settings')
```

### 6.3 Docker 관련 참고

- `eclipse-temurin:17-jre-jammy`: Eclipse Temurin(구 AdoptOpenJDK)의 JRE-only 이미지, LTS Ubuntu 22.04 Jammy 기반
- `postgres:16-alpine`: 공식 PostgreSQL 16 Alpine 기반 이미지, 최소 용량
- `spring-dotenv` 라이브러리(빌드에 포함됨)가 `.env` 파일을 자동으로 읽으므로 로컬 개발 환경에서는 `.env`가 유효하다. Docker 환경에서는 `environment` 섹션으로 직접 주입하므로 `.env` 없이도 동작한다.
