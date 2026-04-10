# Frontend Design

## 1. 레이아웃 구조

화면을 좌우로 양분:

```
+-------------------+----------------------------------------+
|                   |                                        |
|   Left Sidebar    |           Right Work Area              |
|   (Navigation)    |           (Main Content)               |
|                   |                                        |
|   - Dashboard     |   [Section Content Here]               |
|   - Projects      |                                        |
|   - Members       |                                        |
|   - Domain Systems|                                        |
|   - AI Parser     |                                        |
|                   |                                        |
+-------------------+----------------------------------------+
     ~250px                    나머지 영역
```

### Sidebar (좌측)
- 고정 너비 250px, 전체 높이
- 다크 배경 (#343a40)
- 메뉴 항목:
  1. **Dashboard** - 전체 현황 요약
  2. **Projects** - 프로젝트 CRUD + 간트차트
  3. **Members** - 멤버 관리
  4. **Domain Systems** - 도메인 시스템 관리
  5. **AI Parser** - Free-text 파싱 입력

### Work Area (우측)
- Sidebar 오른쪽 나머지 영역
- 각 메뉴 클릭 시 해당 섹션 표시
- 패딩 적용

## 2. 화면별 상세

### 2.1 Dashboard
- 진행 중인 프로젝트 수, 전체 멤버 수, 전체 태스크 수 카드
- 최근 프로젝트 목록 (간략)

### 2.2 Projects (프로젝트 관리)

#### 프로젝트 목록
- 테이블 형태: 이름, 유형, 상태, 기간, 멤버 수
- 각 행에 [간트차트], [수정], [삭제] 버튼

#### 프로젝트 생성/수정 모달
- 이름, 유형(드롭다운), 설명, 시작일, 종료일, 상태 입력
- 멤버 선택 (체크박스 목록)
- 도메인 시스템 선택 (체크박스 목록)

#### 간트차트 뷰
- 프로젝트 선택 시 전체 화면으로 간트차트 표시
- **frappe-gantt** 라이브러리 사용
- 도메인 시스템별 그룹핑 (그룹 헤더로 구분)
- 각 바에 표시: 태스크명, 담당자, 공수(MD)
- 태스크 바 색상은 담당자 역할 기준으로 구분 (DomainSystem의 color 필드는 그룹 헤더 구분선에만 사용):
  - ENGINEER: 파란 계열
  - QA: 녹색 계열
  - PM: 주황 계열
- 의존관계 화살표 표시
- 뷰 모드 전환: Day / Week / Month
- 태스크 바 클릭 시 상세 정보 팝업
- 태스크 바 드래그로 일정 변경

### 2.3 Members (멤버 관리)
- 테이블 형태: 이름, 역할, 이메일, 참여 프로젝트 수
- [추가], [수정], [삭제] 기능
- 모달로 생성/수정

### 2.4 Domain Systems (도메인 시스템 관리)
- 테이블 형태: 이름, 설명, 색상, 연관 프로젝트 수
- [추가], [수정], [삭제] 기능
- 색상 선택 컬러 피커

### 2.5 AI Parser (Free-text 파싱)
- 대형 textarea (free-text 입력)
- [분석] 버튼
- 분석 결과 미리보기 (파싱된 태스크 테이블)
- [저장] 버튼 (확인 후 DB에 저장)
- 프로젝트 선택 드롭다운 (어떤 프로젝트에 태스크를 추가할지)
- 입력 예시 안내 문구 제공

## 3. 간트차트 상세 스펙

### frappe-gantt 라이브러리
- CDN: `https://cdn.jsdelivr.net/npm/frappe-gantt/dist/frappe-gantt.min.js`
- CSS: `https://cdn.jsdelivr.net/npm/frappe-gantt/dist/frappe-gantt.min.css`

### 간트차트 데이터 매핑
```javascript
// API 응답 → frappe-gantt tasks 변환
var tasks = apiData.domainSystems.flatMap(function(ds) {
  return ds.tasks.map(function(task) {
    return {
      id: 'task-' + task.id,
      name: task.name + ' (' + task.assignee.name + ', ' + task.manDays + 'MD)',
      start: task.startDate,
      end: task.endDate,
      progress: task.status === 'COMPLETED' ? 100 : (task.status === 'IN_PROGRESS' ? 50 : 0),
      dependencies: task.dependencies.map(function(depId) { return 'task-' + depId; }).join(', '),
      custom_class: 'bar-' + task.assignee.role.toLowerCase()  // bar-engineer, bar-qa, bar-pm
    };
  });
});
```

### 커스텀 스타일
```css
/* 역할별 색상 */
.bar-engineer .bar-progress, .bar-engineer .bar { fill: #4A90D9; }
.bar-qa .bar-progress, .bar-qa .bar { fill: #27AE60; }
.bar-pm .bar-progress, .bar-pm .bar { fill: #E67E22; }

/* 도메인 시스템 그룹 헤더 */
.domain-group-header {
  font-weight: bold;
  background: #f8f9fa;
  padding: 8px 12px;
  border-left: 4px solid var(--domain-color);
}
```

## 4. JavaScript 함수 구조

```
// app.js 주요 함수 구성
showSection(sectionName)          // 섹션 전환

// Dashboard
loadDashboard()                   // 대시보드 데이터 로드

// Members
loadMembers()                     // 멤버 목록 로드
showMemberModal(memberId?)        // 멤버 생성/수정 모달
saveMember()                      // 멤버 저장
deleteMember(id)                  // 멤버 삭제

// Domain Systems
loadDomainSystems()               // 도메인 시스템 목록 로드
showDomainSystemModal(id?)        // 도메인 시스템 생성/수정 모달
saveDomainSystem()                // 도메인 시스템 저장
deleteDomainSystem(id)            // 도메인 시스템 삭제

// Projects
loadProjects()                    // 프로젝트 목록 로드
showProjectModal(id?)             // 프로젝트 생성/수정 모달
saveProject()                     // 프로젝트 저장
deleteProject(id)                 // 프로젝트 삭제

// Gantt Chart
showGanttChart(projectId)         // 간트차트 표시
loadGanttData(projectId)          // 간트차트 데이터 로드
renderGantt(data)                 // frappe-gantt 렌더링
onTaskDateChange(task, start, end) // 태스크 일정 변경 이벤트

// Tasks
showTaskModal(projectId, taskId?) // 태스크 생성/수정 모달
saveTask()                        // 태스크 저장
deleteTask(id)                    // 태스크 삭제

// AI Parser
parseFreeText()                   // AI free-text 파싱 호출
showParseResult(data)             // 파싱 결과 표시
saveParsedTasks()                 // 파싱된 태스크 저장
```
