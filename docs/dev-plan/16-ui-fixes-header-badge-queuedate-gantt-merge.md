# 개발 계획서: UI 버그 수정 3종 — 헤더 뱃지, 착수일 미지정, 전체 간트 통합

## 1. 개요

- **기능 설명**: 프로젝트 상세 헤더 지연 경고 표시 개선, 담당자 착수일 '미지정' 버그 수정, 전체 간트차트 단일 인스턴스 통합
- **개발 배경 및 목적**: 현재 3가지 UI 문제가 존재한다. (1) 프로젝트 상세 헤더에서 정상/지연 여부를 나타내는 경고 메시지가 alert 블록으로 한 줄을 통째로 점유, (2) 프로젝트 태스크 탭 멤버별 뷰에서 착수일이 항상 '미지정'으로 표시 (API 응답에 queueStartDate 미포함), (3) 전체 간트차트에서 프로젝트별 독립 인스턴스로 렌더링하여 스크롤 동기화가 불완전하고 헤더가 반복됨.
- **작성일**: 2026-04-11

---

## 2. 요구사항 정리

### 2.1 기능 요구사항

- **FR-001**: 프로젝트 상세 헤더에서 지연 여부(`isDelayed`)를 인라인 뱃지로 표시한다. 기존 `#project-detail-delay-warning` div를 제거하고, `#project-detail-meta` 줄의 기간 텍스트 오른쪽에 뱃지를 붙인다.
- **FR-002**: 지연 시 뱃지: 빨간 계열 배경 + 경고 아이콘 + 예상 종료일이 존재하면 "지연 (예상 종료: YYYY-MM-DD)" 텍스트.
- **FR-003**: 정상 시 뱃지: 초록 계열 배경 + "정상" 텍스트. `isDelayed === null/undefined` 이면 뱃지 미표시.
- **FR-004**: `GanttDataDto.AssigneeSummary`에 `queueStartDate` 필드를 추가하고, `TaskService.getGanttData()`에서 담당자의 `getQueueStartDate()`를 매핑한다.
- **FR-005**: 프로젝트 태스크 탭 멤버별 뷰(`loadProjectTasks`)에서 착수일 input의 초기값이 올바르게 표시된다.
- **FR-006**: 전체 간트차트(`loadAllProjectsGantt`)를 단일 frappe-gantt 인스턴스로 재구성한다. 모든 프로젝트 태스크를 하나의 배열로 합치되, `convertToGanttTasks(data, projectName)`의 프로젝트명 prefix 기능을 그대로 활용한다.
- **FR-007**: 단일 인스턴스 전환 시 날짜 범위 앵커 더미 태스크 방식은 불필요하므로 제거한다.
- **FR-008**: 단일 인스턴스에서 프로젝트 구분 표시가 필요하므로, 각 프로젝트 시작 직전에 `custom_class: 'bar-project-separator'` 구분 태스크(더미 바)를 삽입하거나, 기존 `[프로젝트명]` prefix로 구분이 충분하면 구분 바 없이 진행한다. (단순 prefix 방식으로 진행)
- **FR-009**: 단일 인스턴스에서도 주말 제거, 오늘 마커, 론치일 마커 후처리가 동작해야 한다.

### 2.2 비기능 요구사항

- **NFR-001**: 기존 코드 컨벤션 유지 (`var`, `async/await`, 전역 함수, `ResponseEntity<Map>`)
- **NFR-002**: 백엔드 변경은 최소화 — `GanttDataDto.AssigneeSummary`에 필드 1개 추가 + 서비스 매핑 1줄이 전부
- **NFR-003**: `loadAllProjectsGantt` 리팩토링 후 `syncAllProjectGanttsScroll` 함수는 더 이상 필요 없으므로 삭제(또는 비활성화)

### 2.3 가정 사항

- frappe-gantt v0.6.1은 하나의 `#gantt-chart` 컨테이너에 단일 인스턴스만 생성한다. 전체 모드에서도 동일한 컨테이너를 사용한다.
- 프로젝트 구분은 태스크명에 `[프로젝트명]` prefix를 붙이는 것으로 충분하다 (별도 구분 행 불필요).
- 론치일 마커는 여러 프로젝트의 마커를 하나의 SVG에 모두 표시한다.

### 2.4 제외 범위 (Out of Scope)

- 지연 뱃지 클릭 시 팝업/툴팁 (단순 인라인 표시만 구현)
- 전체 간트차트에서 프로젝트별 접기/펼치기
- 프로젝트별 구분선/색상 구역 표시

---

## 3. 시스템 설계

### 3.1 데이터 모델

신규 엔티티 없음. 기존 DTO 필드 1개 추가.

**변경 파일**: `src/main/java/com/timeline/dto/GanttDataDto.java`

```java
// AS-IS: AssigneeSummary (line 79~83)
public static class AssigneeSummary {
    private Long id;
    private String name;
    private MemberRole role;
}

// TO-BE: queueStartDate 필드 추가
public static class AssigneeSummary {
    private Long id;
    private String name;
    private MemberRole role;
    private LocalDate queueStartDate;   // 추가
}
```

### 3.2 API 설계

신규 엔드포인트 없음. 기존 `GET /api/v1/projects/{projectId}/tasks` 응답 구조가 변경된다.

| 변경 위치 | AS-IS | TO-BE |
|-----------|-------|-------|
| `data.domainSystems[].tasks[].assignee` | `{id, name, role}` | `{id, name, role, queueStartDate}` |

### 3.3 서비스 계층

**변경 파일**: `src/main/java/com/timeline/service/TaskService.java`

- `getGanttData()` 메서드 내 `GanttDataDto.AssigneeSummary.builder()` 삼항 블록 (line 82~88)에 `.queueStartDate(task.getAssignee().getQueueStartDate())` 1줄 추가 (`.role(...)` 다음 줄, `.build()` 직전)

```java
// AS-IS (line 82~88)
.assignee(task.getAssignee() != null
        ? GanttDataDto.AssigneeSummary.builder()
                .id(task.getAssignee().getId())
                .name(task.getAssignee().getName())
                .role(task.getAssignee().getRole())
                .build()
        : null)

// TO-BE
.assignee(task.getAssignee() != null
        ? GanttDataDto.AssigneeSummary.builder()
                .id(task.getAssignee().getId())
                .name(task.getAssignee().getName())
                .role(task.getAssignee().getRole())
                .queueStartDate(task.getAssignee().getQueueStartDate())  // 추가
                .build()
        : null)
```

### 3.4 프론트엔드

#### 수정 1: renderProjectDetailHeader — 지연 뱃지 인라인화

**변경 파일**: `src/main/resources/static/js/app.js`

**대상 함수**: `renderProjectDetailHeader` (line 837~872)

현재 구조:
- `#project-detail-meta`: 타입뱃지 + 상태뱃지 + 기간
- `#project-detail-delay-warning`: alert 블록 (별도 줄)

변경 구조:
- `#project-detail-meta`: 타입뱃지 + 상태뱃지 + 기간 + **지연/정상 인라인 뱃지**
- `#project-detail-delay-warning`: 완전히 숨김 처리 (display:none 유지, 내용 비움)

인라인 뱃지 HTML 예시:
```html
<!-- 지연 시 -->
<span class="badge bg-danger ms-1" style="font-size:0.75rem;">
  <i class="bi bi-exclamation-triangle-fill"></i> 지연 (예상 종료: 2026-05-10)
</span>

<!-- 정상 시 -->
<span class="badge bg-success ms-1" style="font-size:0.75rem;">
  <i class="bi bi-check-circle-fill"></i> 정상
</span>
```

**변경 상세 (AS-IS → TO-BE)**:

```javascript
// AS-IS: renderProjectDetailHeader (line 837~872) — 실제 현재 코드 기준
function renderProjectDetailHeader(p) {
    document.getElementById('project-detail-title').textContent = p.name || '';

    var metaEl = document.getElementById('project-detail-meta');
    var metaHtml = '';
    metaHtml += typeBadge(p.projectType) + ' ';
    metaHtml += statusBadge(p.status) + ' ';
    metaHtml += '<span class="text-muted" style="font-size:0.88rem;">';
    metaHtml += formatDateWithDay(p.startDate) + ' ~ ' + formatDateWithDay(p.endDate);
    metaHtml += '</span>';
    if (p.description) {
        metaHtml += ' <span class="text-muted text-truncate" style="font-size:0.85rem; max-width:400px; display:inline-block; vertical-align:middle;">| ' + escapeHtml(p.description) + '</span>';
    }
    metaEl.innerHTML = metaHtml;

    // 지연 경고 렌더링 (별도 div — 제거 대상)
    var delayEl = document.getElementById('project-detail-delay-warning');
    if (p.isDelayed === true) {
        var delayMsg = '<i class="bi bi-exclamation-triangle-fill"></i> ';
        if (p.expectedEndDate && p.endDate) {
            delayMsg += '예상 종료일(' + formatDateWithDay(p.expectedEndDate) + ')이 론치일(' + formatDateWithDay(p.endDate) + ')을 초과합니다.';
        } else {
            delayMsg += '프로젝트 일정이 지연되고 있습니다.';
        }
        delayEl.innerHTML = '<div class="alert alert-danger py-2 px-3 mb-0" style="font-size:0.85rem;">' + delayMsg + '</div>';
        delayEl.style.display = 'block';
    } else if (p.isDelayed === false) {
        delayEl.innerHTML = '<div class="alert alert-success py-2 px-3 mb-0" style="font-size:0.85rem;">'
            + '<i class="bi bi-check-circle-fill"></i> 정상 진행 중</div>';
        delayEl.style.display = 'block';
    } else {
        delayEl.style.display = 'none';
    }
}

// TO-BE
function renderProjectDetailHeader(p) {
    document.getElementById('project-detail-title').textContent = p.name || '';

    var metaEl = document.getElementById('project-detail-meta');
    var metaHtml = '';
    metaHtml += typeBadge(p.projectType) + ' ';
    metaHtml += statusBadge(p.status) + ' ';
    metaHtml += '<span class="text-muted" style="font-size:0.88rem;">';
    metaHtml += formatDateWithDay(p.startDate) + ' ~ ' + formatDateWithDay(p.endDate);
    metaHtml += '</span>';

    // 지연/정상 인라인 뱃지 (isDelayed가 null/undefined면 미표시)
    if (p.isDelayed === true) {
        var delayText = '지연';
        if (p.expectedEndDate) {
            delayText += ' (예상 종료: ' + p.expectedEndDate + ')';
        }
        metaHtml += ' <span class="badge bg-danger ms-1" style="font-size:0.75rem;">'
            + '<i class="bi bi-exclamation-triangle-fill"></i> ' + delayText + '</span>';
    } else if (p.isDelayed === false) {
        metaHtml += ' <span class="badge bg-success ms-1" style="font-size:0.75rem;">'
            + '<i class="bi bi-check-circle-fill"></i> 정상</span>';
    }

    // description은 지연 뱃지 뒤에 위치 (AS-IS 대비 순서 변경: 기간 → 지연뱃지 → description)
    if (p.description) {
        metaHtml += ' <span class="text-muted text-truncate" style="font-size:0.85rem; max-width:400px; display:inline-block; vertical-align:middle;">| ' + escapeHtml(p.description) + '</span>';
    }
    metaEl.innerHTML = metaHtml;

    // delay warning div 비활성화
    var delayEl = document.getElementById('project-detail-delay-warning');
    delayEl.style.display = 'none';
    delayEl.innerHTML = '';
}
```

#### 수정 2: loadProjectTasks — 착수일 초기값 수정

**변경 파일**: `src/main/resources/static/js/app.js`

**대상 코드**: `loadProjectTasks` 내 멤버별 그룹 헤더 렌더링 (line 968~969)

**원인**: `tasks[0].assignee`는 `GanttDataDto.AssigneeSummary`이며, 현재 이 객체에 `queueStartDate` 필드가 없다. 따라서 `assigneeData.queueStartDate`는 항상 `undefined` → 빈 문자열 → placeholder "미지정"으로 표시됨.

**수정 방향**: 백엔드에서 `queueStartDate`를 내려주도록 수정(수정 1)하면 프론트엔드 line 969의 코드는 변경 없이 동작한다. 단, 안전성을 위해 null 체크 방식을 명시적으로 유지한다.

```javascript
// AS-IS (line 968~969) — 변경 불필요, 백엔드 수정으로 해결됨
var assigneeData = tasks[0] && tasks[0].assignee ? tasks[0].assignee : null;
var qsd = assigneeData && assigneeData.queueStartDate ? assigneeData.queueStartDate : '';
```

백엔드 `AssigneeSummary`에 `queueStartDate`가 추가되면 `assigneeData.queueStartDate`가 올바른 날짜 문자열을 반환한다.

#### 수정 3: loadAllProjectsGantt — 단일 frappe-gantt 인스턴스로 통합

**변경 파일**: `src/main/resources/static/js/app.js`

**대상 함수**: `loadAllProjectsGantt` (line 1586~1802)

**변경 전 구조**:
- 프로젝트별 `<div id="gantt-all-chart-{idx}">` 개별 생성
- 각각 `new Gantt(...)` 인스턴스 생성
- `syncAllProjectGanttsScroll()`로 스크롤 동기화 (불완전)
- 각 차트에 날짜 범위 앵커 더미 태스크 삽입

**변경 후 구조**:
- 단일 `#gantt-chart` 컨테이너에 직접 렌더링 (기존 단일 프로젝트 모드와 동일한 컨테이너)
- 모든 프로젝트의 `convertToGanttTasks(data, projectName)` 결과를 하나의 배열로 concat
- `new Gantt('#gantt-chart', allTasks, {...})` 단일 인스턴스 생성
- `ganttInstance` 전역 변수에 단일 인스턴스 할당

**변경 후 코드 (TO-BE 전체)**:

```javascript
async function loadAllProjectsGantt() {
    var chartContainer = document.getElementById('gantt-chart');
    chartContainer.innerHTML = '<div class="text-center text-muted p-3"><i class="bi bi-hourglass-split"></i> 전체 프로젝트 로딩 중...</div>';

    try {
        var projRes = await apiCall('/api/v1/projects');
        var projects = (projRes.success && projRes.data) ? projRes.data : [];
        if (projects.length === 0) {
            chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>등록된 프로젝트가 없습니다.</p></div>';
            ganttInstance = null;
            return;
        }

        // 모든 프로젝트의 태스크 데이터를 병렬 로드
        var taskPromises = projects.map(function(p) {
            return apiCall('/api/v1/projects/' + p.id + '/tasks');
        });
        var taskResults = await Promise.all(taskPromises);

        // 모든 프로젝트 태스크를 하나의 배열로 합침
        var allTasks = [];
        var projectDataList = []; // 론치일 마커 등 후처리에 사용
        for (var i = 0; i < projects.length; i++) {
            var res = taskResults[i];
            if (res.success && res.data) {
                var ganttTasks = convertToGanttTasks(res.data, projects[i].name);
                if (ganttTasks.length > 0) {
                    allTasks = allTasks.concat(ganttTasks);
                    projectDataList.push({ project: projects[i], data: res.data });
                }
            }
        }

        if (allTasks.length === 0) {
            chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>표시할 태스크가 없습니다.</p></div>';
            ganttInstance = null;
            return;
        }

        // 단일 인스턴스 렌더링
        chartContainer.innerHTML = '';
        try {
            ganttInstance = new Gantt('#gantt-chart', allTasks, {
                view_mode: currentViewMode,
                date_format: 'YYYY-MM-DD',
                bar_height: 23,
                bar_corner_radius: 3,
                padding: 11,
                on_click: function(task) {
                    if (task._taskId) {
                        showTaskDetail(task._taskId, { projectId: task._projectId });
                    }
                },
                on_date_change: function() {
                    loadAllProjectsGantt();
                }
            });
        } catch (e) {
            console.error('전체 간트차트 렌더링 실패:', e);
            chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>전체 프로젝트 간트차트 로딩에 실패했습니다.</p></div>';
            ganttInstance = null;
            return;
        }

        setTimeout(function() {
            // 주말 제거 (Day 모드)
            // removeGanttWeekendsForElement는 chartEl에 data-weekends-removed='true'를 설정하지만
            // 전역 ganttWeekendsRemoved 플래그는 건드리지 않는다.
            // 단일 인스턴스 모드에서 론치일 마커 계산이 올바르게 동작하려면 플래그도 함께 갱신해야 한다.
            ganttWeekendsRemoved = false;
            if (ganttInstance && currentViewMode === 'Day') {
                removeGanttWeekendsForElement(ganttInstance, chartContainer);
                ganttWeekendsRemoved = true;
            }

            // 드래그 비활성화 (bar-wrapper를 클릭 핸들러로 교체)
            var bars = chartContainer.querySelectorAll('.bar-wrapper');
            bars.forEach(function(bar) {
                var clone = bar.cloneNode(true);
                bar.parentNode.replaceChild(clone, bar);
                clone.addEventListener('click', function() {
                    var taskId = clone.getAttribute('data-id');
                    if (taskId && taskId.startsWith('task-')) {
                        var id = parseInt(taskId.replace('task-', ''));
                        // projectId 추출: allTasks에서 찾기
                        var found = allTasks.find(function(t) { return t.id === taskId; });
                        showTaskDetail(id, { projectId: found ? found._projectId : null });
                    }
                });
                clone.style.cursor = 'pointer';
            });

            // 오늘 마커
            addGanttTodayMarkerForElement(chartContainer);

            // 각 프로젝트의 론치일 마커
            // 주의: addGanttDeadlineMarkerForElement는 호출 시마다 svg 내 기존 .gantt-deadline-marker-group을
            // 전부 제거하고 새로 그린다. 따라서 루프로 반복 호출하면 마지막 프로젝트 마커만 남는다.
            // 단일 인스턴스 모드에서는 모든 프로젝트 마커를 하나의 svg에 누적하기 위해
            // addGanttDeadlineMarkerForElement를 직접 호출하지 않고, 아래 인라인 로직으로 처리한다.
            var svgEl = chartContainer.querySelector('svg');
            if (svgEl) {
                // 기존 마커 일괄 제거 (단 한 번만)
                svgEl.querySelectorAll('.gantt-deadline-marker-group').forEach(function(el) { el.remove(); });
                var lowerTexts = svgEl.querySelectorAll('.lower-text');
                var weekendsRemoved = chartContainer.getAttribute('data-weekends-removed') === 'true';
                projectDataList.forEach(function(pd) {
                    if (!pd.data.project || !pd.data.project.endDate) return;
                    var project = pd.data.project;
                    if (lowerTexts.length < 2) return;
                    var x0 = parseFloat(lowerTexts[0].getAttribute('x'));
                    var x1 = parseFloat(lowerTexts[1].getAttribute('x'));
                    var colWidth = x1 - x0;
                    if (colWidth <= 0) return;
                    var todayHighlight = svgEl.querySelector('.today-highlight');
                    if (!todayHighlight) return;
                    var todayCenterX = parseFloat(todayHighlight.getAttribute('x')) + parseFloat(todayHighlight.getAttribute('width')) / 2;
                    var today = new Date(); today.setHours(0,0,0,0);
                    var endDateDate = new Date(project.endDate + 'T00:00:00');
                    var diffDays = weekendsRemoved
                        ? countBusinessDaysBetween(today, endDateDate)
                        : Math.round((endDateDate - today) / (1000 * 60 * 60 * 24));
                    var dayPixels = colWidth;
                    if (currentViewMode === 'Week') dayPixels = colWidth / 7;
                    else if (currentViewMode === 'Month') dayPixels = colWidth / 30;
                    var markerX = todayCenterX + (diffDays * dayPixels);
                    var svgWidth = parseFloat(svgEl.getAttribute('width') || svgEl.getBoundingClientRect().width);
                    if (markerX < 0 || markerX > svgWidth) return;
                    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    g.setAttribute('class', 'gantt-deadline-marker-group');
                    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', markerX); line.setAttribute('x2', markerX);
                    line.setAttribute('y1', 0); line.setAttribute('y2', svgEl.getAttribute('height') || '500');
                    line.setAttribute('class', 'gantt-deadline-marker');
                    g.appendChild(line);
                    var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    text.setAttribute('x', markerX + 4); text.setAttribute('y', 15);
                    text.setAttribute('class', 'gantt-deadline-label');
                    text.textContent = '론치일 ' + project.endDate;
                    g.appendChild(text);
                    svgEl.appendChild(g);
                });
            }
        }, 100);

    } catch (e) {
        console.error('전체 프로젝트 간트 로드 실패:', e);
        chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>전체 프로젝트 간트차트 로딩에 실패했습니다.</p></div>';
    }
}
```

**삭제 대상**: `syncAllProjectGanttsScroll` 함수 (line 1807~1827) — 단일 인스턴스로 변경 후 불필요

### 3.5 기존 시스템 연동

| 영향 범위 | 내용 |
|-----------|------|
| `GanttDataDto.AssigneeSummary` | `queueStartDate` 필드 추가. 기존 직렬화/역직렬화 영향 없음 (신규 필드 추가만). `@Data`+`@Builder`+`@NoArgsConstructor`+`@AllArgsConstructor` Lombok 조합이 이미 적용되어 있으므로 Jackson 직렬화 자동 처리됨 |
| `TaskService.getGanttData()` | 매핑 1줄 추가. 기존 로직 변경 없음 |
| `renderProjectDetailHeader()` | `#project-detail-delay-warning` div는 HTML에 유지하되 항상 `display:none`. 기존 CSS/JS에서 이 id를 참조하는 다른 코드 없음 |
| `syncAllProjectGanttsScroll()` | 삭제 예정. 호출부는 `loadAllProjectsGantt` 내부뿐 (line 1774). 함께 제거. 함수 선언 자체는 line 1807~1827 |
| 단일 프로젝트 간트 (`renderGantt`) | 변경 없음 |

---

## 4. 구현 계획

### 4.1 작업 분해 (Task Breakdown)

| # | 작업 | 파일 | 예상 복잡도 | 의존성 |
|---|------|------|------------|--------|
| T1 | `GanttDataDto.AssigneeSummary`에 `queueStartDate` 필드 추가 | `GanttDataDto.java` | 낮음 | 없음 |
| T2 | `TaskService.getGanttData()` 매핑에 `queueStartDate` 추가 | `TaskService.java` | 낮음 | T1 |
| T3 | `renderProjectDetailHeader()` — 지연 인라인 뱃지로 변경 | `app.js` | 낮음 | 없음 |
| T4 | `loadAllProjectsGantt()` — 단일 인스턴스로 리팩토링 | `app.js` | 중간 | 없음 |
| T5 | `syncAllProjectGanttsScroll()` 함수 삭제 | `app.js` | 낮음 | T4 |
| T6 | 컴파일 확인 및 동작 테스트 | - | 낮음 | T1~T5 |

### 4.2 구현 순서

1. **T1 + T3 병렬**: 백엔드 DTO 필드 추가와 프론트 헤더 뱃지 변경은 독립적이므로 동시 작업 가능
2. **T2**: T1 완료 후 서비스 매핑 추가
3. **T4 + T5**: 전체 간트차트 리팩토링 + 불필요 함수 삭제
4. **T6**: 전체 컴파일 및 브라우저 동작 확인

### 4.3 테스트 계획

**수동 확인 항목**:

1. **헤더 뱃지**
   - `isDelayed = true`인 프로젝트 상세 진입 → 빨간 "지연" 뱃지가 기간 옆에 인라인으로 표시됨
   - `isDelayed = false`인 프로젝트 → 초록 "정상" 뱃지 표시
   - `isDelayed = null`인 프로젝트 → 뱃지 미표시
   - 헤더가 이전 대비 세로 높이가 줄어듦 (alert 블록 제거)

2. **착수일 표시**
   - 프로젝트 > 태스크 탭 > 멤버별 뷰 진입
   - `queueStartDate`가 설정된 담당자의 착수일 input에 날짜값이 표시됨
   - `queueStartDate`가 null인 담당자는 placeholder "미지정" 유지

3. **전체 간트차트**
   - 간트 > 프로젝트 선택 "전체" → 단일 차트에 모든 프로젝트 태스크 표시
   - 태스크명에 `[프로젝트명]` prefix 확인
   - 좌우 스크롤 시 단일 스크롤바로 자연스럽게 이동 (동기화 문제 없음)
   - Day 모드에서 주말 제거, 오늘 마커, 론치일 마커 정상 표시

---

## 5. 리스크 및 고려사항

### 5.1 기술적 리스크

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| frappe-gantt 태스크 수 성능 | 프로젝트가 많을 경우 단일 인스턴스의 태스크 수가 증가하여 렌더링 느려질 수 있음 | 현 시점 프로젝트 수가 많지 않으므로 허용. 향후 필요 시 가상 스크롤 검토 |
| 론치일 마커 중복 | `addGanttDeadlineMarkerForElement`는 호출마다 svg 내 기존 `.gantt-deadline-marker-group`을 **전부** 제거 후 재작성한다 (line 1869~1870). 따라서 루프로 반복 호출하면 마지막 프로젝트 마커만 남는다 — FR-009 위반. | §3.4 TO-BE 코드에서 `addGanttDeadlineMarkerForElement` 반복 호출을 제거하고, 인라인 루프로 모든 프로젝트 마커를 하나의 svg에 누적하도록 대체함 |
| 단일 간트에서 날짜 앵커 제거 | 기존 코드의 `bar-anchor-hidden` 더미 태스크가 제거되므로 앵커 관련 후처리 코드(SVG 높이 조정)도 함께 제거해야 함 | T4 리팩토링 시 앵커 관련 코드 블록 전체 삭제 |

### 5.2 의존성 리스크

- `GanttDataDto` 변경은 JSON 직렬화에만 영향. 역직렬화(request body)로 사용되는 DTO가 아니므로 하위 호환성 문제 없음.

---

## 6. 참고 사항

### 관련 기존 코드 경로

| 항목 | 파일 및 위치 |
|------|-------------|
| `renderProjectDetailHeader` | `src/main/resources/static/js/app.js`, line 837~872 |
| `loadProjectTasks` (착수일 렌더링) | `src/main/resources/static/js/app.js`, line 874~1045 (착수일 관련: line 968~972) |
| `loadAllProjectsGantt` | `src/main/resources/static/js/app.js`, line 1586~1802 |
| `syncAllProjectGanttsScroll` | `src/main/resources/static/js/app.js`, line 1807~1827 (삭제 대상) |
| `convertToGanttTasks` | `src/main/resources/static/js/app.js`, line 2067~2108 |
| `GanttDataDto` | `src/main/java/com/timeline/dto/GanttDataDto.java` |
| `TaskService.getGanttData()` | `src/main/java/com/timeline/service/TaskService.java`, line 47~111 (AssigneeSummary 빌더: line 82~88) |
| `#project-detail-delay-warning` | `src/main/resources/static/index.html`, line 240 |
| `#project-detail-meta` | `src/main/resources/static/index.html`, line 239 |
