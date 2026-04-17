// ========================================
// Timeline Application JavaScript
// Version: 20260413d
// ========================================

// ---- 전역 상태 ----
var currentSection = 'projects';
var _isNavigating = false;          // hash 라우팅 루프 방지 플래그
var currentProjectId = null;     // 간트차트에서 사용 중인 프로젝트 ID
var currentGanttData = null;     // 간트차트 원본 데이터
var ganttInstance = null;        // frappe-gantt 인스턴스
var currentViewMode = 'Day';   // 간트차트 뷰 모드
var parsedTaskData = null;       // AI 파싱 결과 임시 저장
var currentModalProjectId = null; // 태스크 모달에서 사용 중인 프로젝트 ID
var isFirstTask = true;          // 현재 모달의 태스크가 첫 번째 태스크인지
var previewDebounceTimer = null; // 프리뷰 API 호출 디바운스 타이머
var currentProjectMembers = [];  // 태스크 모달에서 사용 중인 프로젝트 멤버 목록 (capacity 조회용)
var currentDetailProjectId = null; // 프로젝트 상세 뷰에서 사용 중인 프로젝트 ID
var currentScheduleMemberId = null; // 멤버별 태스크에서 선택된 멤버 ID
var currentScheduleMemberName = null; // 멤버별 태스크에서 선택된 멤버 이름
var allWarningsData = null;      // 경고 센터 전체 경고 캐시
var cachedHolidayDates = null;   // 공휴일/휴무 날짜 캐시 (Set of 'YYYY-MM-DD')
var cachedMemberLeaveDates = {};  // 멤버별 개인 휴가 날짜 캐시 { memberId: { 'YYYY-MM-DD': true } }
var taskStartDatePicker = null;  // 태스크 시작일 flatpickr 인스턴스
var projectTaskViewMode = 'grouped'; // 프로젝트 태스크 뷰 모드: 'grouped' (멤버별) or 'flat' (전체)
var ganttWeekendsRemoved = false; // 간트차트 주말 제거 여부
var _ganttRenderTimerId = null;   // 간트차트 후처리 타이머 (중복 방지)
var pendingImportFile = null;    // Import 대기 중인 파일
var cachedJiraBaseUrl = null;    // Jira 베이스 URL 캐시 (태스크 링크 렌더링용)
var jiraImportProjectId = null;  // Jira Import 모달에서 사용 중인 프로젝트 ID
var jiraPreviewCreatedAfter = null; // Jira Import 미리보기에서 사용한 생성일자 필터
var jiraPreviewStatusFilter = [];  // Jira Import 미리보기에서 사용한 상태 필터
var jiraPreviewBoardId = null;   // Jira Import 미리보기에서 사용한 Board ID (executeJiraImport에서 재사용)
var projectTaskStatusFilter = ['TODO', 'IN_PROGRESS'];  // 프로젝트 태스크 상태 필터 (복수 선택, 기본값: TODO + 진행중)
var scheduleTaskStatusFilter = ['TODO', 'IN_PROGRESS']; // 스케줄 태스크 상태 필터 (복수 선택, 기본값: TODO + 진행중)
var VALID_PROJECT_STATUSES = ['PLANNING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'];
var _defaultProjectStatusFilter = ['PLANNING', 'IN_PROGRESS'];
// v2 키로 마이그레이션: 이전 키 무시하고 새 키 사용
var _savedProjectListFilter2 = localStorage.getItem('projectListStatusFilter_v2');
var projectListStatusFilter = (function() {
    if (!_savedProjectListFilter2) return _defaultProjectStatusFilter.slice();
    try { var arr = JSON.parse(_savedProjectListFilter2); return Array.isArray(arr) ? arr : _defaultProjectStatusFilter.slice(); }
    catch(e) { return _defaultProjectStatusFilter.slice(); }
})();
var ganttShowJiraKey = false;  // 간트차트 티켓번호 표시 여부
var ganttShowDomain = false;   // 간트차트 도메인명 표시 여부
var taskDepSearchBound = false; // 선행 태스크 검색 이벤트 바인딩 여부

// ========================================
// 사이드바 토글
// ========================================

function toggleSidebar() {
    var sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
    // 아이콘 방향 전환
    var icon = document.querySelector('#sidebar-toggle-btn i');
    if (sidebar.classList.contains('collapsed')) {
        icon.className = 'bi bi-chevron-right';
    } else {
        icon.className = 'bi bi-chevron-left';
    }
    // 상태 저장
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed') ? '1' : '0');
}

// 페이지 로드 시 저장된 사이드바 상태 복원
(function() {
    if (localStorage.getItem('sidebarCollapsed') === '1') {
        document.getElementById('sidebar').classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        var icon = document.querySelector('#sidebar-toggle-btn i');
        if (icon) icon.className = 'bi bi-chevron-right';
    }
})();

// ========================================
// Hash 라우팅
// ========================================

/**
 * hash 문자열 파싱 - '#gantt/123' → { section: 'gantt', param: '123' }
 */
function parseHash(hashStr) {
    var parts = hashStr.split('/');
    return {
        section: parts[0] || 'projects',
        param: parts[1] || null
    };
}

/**
 * hash 변경 시 해당 화면으로 이동
 */
function handleHashChange() {
    if (_isNavigating) return;
    var raw = window.location.hash.replace('#', '') || 'projects';
    var parsed = parseHash(raw);

    switch (parsed.section) {
        case 'project':
            if (parsed.param) {
                showProjectDetail(parseInt(parsed.param));
            } else {
                showSection('projects');
            }
            break;
        case 'gantt':
            currentProjectId = parsed.param ? (parsed.param === 'all' ? 'all' : parseInt(parsed.param)) : null;
            showSection('gantt');
            break;
        case 'assignee-schedule':
            currentScheduleMemberId = parsed.param ? parseInt(parsed.param) : null;
            currentScheduleMemberName = null;
            showSection('assignee-schedule');
            break;
        case 'projects':
        case 'warning-center':
        case 'settings':
        case 'ai-parser':
            showSection(parsed.section);
            break;
        default:
            // 잘못된 hash → 프로젝트로 폴백
            showSection('projects');
            break;
    }
}

// ========================================
// 유틸리티 함수
// ========================================

/**
 * API 호출 공통 함수
 */
async function apiCall(url, method, body) {
    var options = {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    var response = await fetch(url, options);

    // Content-Type 확인 후 JSON 파싱
    var contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
        if (!response.ok) {
            return { success: false, message: '서버 오류가 발생했습니다. (HTTP ' + response.status + ')' };
        }
        return { success: true };
    }

    var data = await response.json();
    return data;
}

/**
 * 설명 텍스트를 Jira 스타일 HTML로 변환
 */
function renderDescription(text) {
    if (!text || text === '-') return '<span class="text-muted">-</span>';
    var lines = escapeHtml(text).split('\n');
    var html = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        // 불릿 리스트 (- 또는 * 로 시작)
        var bulletMatch = line.match(/^(\s*)[\-\*]\s+(.*)/);
        if (bulletMatch) {
            if (!inList) { html += '<ul class="desc-list">'; inList = true; }
            html += '<li>' + autoLinkUrls(bulletMatch[2]) + '</li>';
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            if (line.trim() === '') {
                html += '<div class="desc-blank"></div>';
            } else {
                html += '<div>' + autoLinkUrls(line) + '</div>';
            }
        }
    }
    if (inList) html += '</ul>';
    return '<div class="jira-desc">' + html + '</div>';
}

function autoLinkUrls(text) {
    return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

/**
 * 토스트 메시지 표시
 */
function showToast(message, type) {
    var toastEl = document.getElementById('app-toast');
    var msgEl = document.getElementById('toast-message');
    msgEl.textContent = message;

    // 색상 클래스 제거 후 추가
    toastEl.classList.remove('toast-success', 'toast-error', 'toast-warning');
    toastEl.classList.add('toast-' + (type || 'success'));

    var toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3000 });
    toast.show();
}

/**
 * 상태 배지 HTML
 */
function statusBadge(status) {
    return '<span class="badge-status badge-' + status + '">' + status + '</span>';
}

/**
 * 역할 배지 HTML
 */
function roleBadge(role) {
    return '<span class="badge-status badge-' + role + '">' + role + '</span>';
}

/**
 * 프로젝트 유형 배지 HTML (자유 문자열 대응)
 */
function typeBadge(type) {
    if (!type) return '';
    return '<span class="badge-project-type">' + escapeHtml(type) + '</span>';
}

/**
 * 우선순위 배지 HTML
 */
function priorityBadge(priority) {
    if (!priority) return '';
    return '<span class="badge-priority badge-' + priority + '">' + priority + '</span>';
}

/**
 * 태스크 유형 배지 HTML
 */
function taskTypeBadge(taskType) {
    if (!taskType) return '';
    var cssClass = taskType === 'QA' ? 'QA_TYPE' : taskType;
    return '<span class="badge-task-type badge-' + cssClass + '">' + taskType + '</span>';
}

/**
 * 날짜 포맷 (YYYY-MM-DD)
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    return dateStr;
}

/**
 * 날짜 짧은 포맷 + 요일 (MM/DD(월))
 */
function formatShortDateWithDay(dateStr) {
    if (!dateStr) return '-';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return parseInt(parts[1]) + '/' + parseInt(parts[2]) + '(' + days[d.getDay()] + ')';
}

/**
 * 날짜 + 요일 포맷 (YYYY-MM-DD (월))
 */
function formatDateWithDay(dateStr) {
    if (!dateStr) return '-';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return dateStr + '(' + days[d.getDay()] + ')';
}

function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return parseInt(parts[1]) + '/' + parseInt(parts[2]) + '(' + days[d.getDay()] + ')';
}

/**
 * 두 날짜 간 영업일 수 계산 (주말 제외)
 */
function addDays(dateStr, days) {
    var parts = dateStr.split('-');
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() + days);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
}

function calcWorkingDays(startStr, endStr) {
    if (!startStr || !endStr) return null;
    var s = new Date(startStr + 'T00:00:00');
    var e = new Date(endStr + 'T00:00:00');
    if (s > e) return 0;
    var count = 0;
    var cur = new Date(s);
    while (cur <= e) {
        var day = cur.getDay();
        if (day !== 0 && day !== 6) {
            var dateKey = cur.getFullYear() + '-' + ('0' + (cur.getMonth() + 1)).slice(-2) + '-' + ('0' + cur.getDate()).slice(-2);
            if (!cachedHolidayDates || !cachedHolidayDates[dateKey]) {
                count++;
            }
        }
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

function countBusinessDaysBetween(from, to) {
    var start = new Date(from);
    var end = new Date(to);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (start.getTime() === end.getTime()) return 0;
    var forward = end > start;
    var current = new Date(start);
    var count = 0;
    if (forward) {
        while (current < end) {
            current.setDate(current.getDate() + 1);
            var day = current.getDay();
            if (day !== 0 && day !== 6) count++;
        }
    } else {
        while (current > end) {
            current.setDate(current.getDate() - 1);
            var day = current.getDay();
            if (day !== 0 && day !== 6) count--;
        }
    }
    return count;
}

/**
 * confirm 다이얼로그
 */
function confirmAction(message) {
    return window.confirm(message);
}

function showConfirmDialog(message, onConfirm) {
    var modalEl = document.getElementById('confirmDialogModal');
    if (!modalEl) {
        // 동적으로 모달 생성
        modalEl = document.createElement('div');
        modalEl.id = 'confirmDialogModal';
        modalEl.className = 'modal fade';
        modalEl.tabIndex = -1;
        modalEl.style.zIndex = '1060';
        modalEl.innerHTML = '<div class="modal-dialog modal-dialog-centered modal-sm">'
            + '<div class="modal-content">'
            + '<div class="modal-body text-center py-4">'
            + '<p id="confirmDialogMessage" class="mb-0"></p>'
            + '</div>'
            + '<div class="modal-footer justify-content-center border-0 pt-0">'
            + '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">취소</button>'
            + '<button type="button" class="btn btn-danger btn-sm" id="confirmDialogOkBtn">확인</button>'
            + '</div>'
            + '</div></div>';
        document.body.appendChild(modalEl);
    }
    document.getElementById('confirmDialogMessage').textContent = message;
    var okBtn = document.getElementById('confirmDialogOkBtn');
    var modal = new bootstrap.Modal(modalEl, { backdrop: 'static' });
    okBtn.onclick = function() {
        modal.hide();
        if (onConfirm) onConfirm();
    };
    modal.show();
}

/**
 * 공휴일/휴무 날짜 목록 로드 (캐시)
 */
async function loadHolidayDatesCache() {
    if (cachedHolidayDates) return cachedHolidayDates;
    try {
        var res = await apiCall('/api/v1/holidays');
        if (res.success && res.data) {
            cachedHolidayDates = {};
            res.data.forEach(function(h) {
                if (h.date) cachedHolidayDates[h.date] = true;
            });
        } else {
            cachedHolidayDates = {};
        }
    } catch (e) {
        cachedHolidayDates = {};
    }
    return cachedHolidayDates;
}

/**
 * 멤버별 개인 휴가 날짜 로드
 */
async function loadMemberLeaveDatesCache(memberId) {
    if (!memberId) return {};
    if (cachedMemberLeaveDates[memberId]) return cachedMemberLeaveDates[memberId];
    try {
        var res = await apiCall('/api/v1/members/' + memberId + '/leaves');
        var dates = {};
        if (res.success && res.data) {
            res.data.forEach(function(leave) {
                if (leave.date) dates[leave.date] = true;
            });
        }
        cachedMemberLeaveDates[memberId] = dates;
        return dates;
    } catch (e) {
        cachedMemberLeaveDates[memberId] = {};
        return {};
    }
}

/**
 * 태스크 시작일 flatpickr 초기화 (공휴일/주말/개인휴가 비활성화)
 */
function initTaskStartDatePicker(memberLeaves) {
    var currentDate = null;
    if (taskStartDatePicker) {
        currentDate = document.getElementById('task-start-date').value;
        taskStartDatePicker.destroy();
        taskStartDatePicker = null;
    }
    var holidays = cachedHolidayDates || {};
    var leaves = memberLeaves || {};
    taskStartDatePicker = flatpickr('#task-start-date', {
        dateFormat: 'Y-m-d',
        locale: 'ko',
        allowInput: true,
        disable: [
            function(date) {
                var day = date.getDay();
                // 주말
                if (day === 0 || day === 6) return true;
                // 공휴일/휴무
                var y = date.getFullYear();
                var m = String(date.getMonth() + 1).padStart(2, '0');
                var d = String(date.getDate()).padStart(2, '0');
                var dateStr = y + '-' + m + '-' + d;
                if (holidays[dateStr]) return true;
                // 개인 휴가
                if (leaves[dateStr]) return true;
                return false;
            }
        ],
        onChange: function(selectedDates, dateStr) {
            triggerDatePreview();
        }
    });
    // 기존 날짜 복원
    if (currentDate && taskStartDatePicker) {
        taskStartDatePicker.setDate(currentDate, false);
    }
}

// ========================================
// 섹션 전환
// ========================================

function showSection(sectionName, linkEl) {
    _isNavigating = true;

    // 모든 섹션 숨기기
    var sections = document.querySelectorAll('.section');
    sections.forEach(function(section) {
        section.style.display = 'none';
    });

    // 대상 섹션 표시
    var target = document.getElementById(sectionName + '-section');
    if (target) {
        target.style.display = 'block';
    }

    // 네비게이션 링크 활성화 (간트차트 뷰 제외)
    if (linkEl) {
        var navLinks = document.querySelectorAll('#sidebar .nav-link');
        navLinks.forEach(function(link) {
            link.classList.remove('active');
        });
        linkEl.classList.add('active');
    } else if (sectionName !== 'gantt') {
        // linkEl 없이 호출된 경우 data-section으로 찾기
        var navLinks = document.querySelectorAll('#sidebar .nav-link');
        navLinks.forEach(function(link) {
            link.classList.remove('active');
            if (link.getAttribute('data-section') === sectionName) {
                link.classList.add('active');
            }
        });
    }

    currentSection = sectionName;

    // 프로젝트 상세 뷰에서 벗어날 때 초기화
    if (sectionName !== 'projects') {
        currentDetailProjectId = null;
    }

    // hash 업데이트 (현재 hash와 동일하거나 하위 경로이면 스킵)
    var currentHash = window.location.hash;
    if (currentHash !== '#' + sectionName && !currentHash.startsWith('#' + sectionName + '/')) {
        window.location.hash = sectionName;
    }
    _isNavigating = false;

    // 섹션 데이터 로드
    switch (sectionName) {
        case 'projects':
            loadProjects();
            break;
        case 'assignee-schedule':
            loadAssigneeSchedule();
            break;
        case 'gantt':
            loadGanttSection();
            break;
        case 'warning-center':
            loadWarningCenter();
            break;
        case 'settings':
            loadSettingsSection();
            break;
        case 'ai-parser':
            loadAiParserProjects();
            break;
    }
}

// ========================================
// Members
// ========================================

var _projMembersModalProjectId = null;
var _projMembersModalAllMembers = [];

async function showProjectMembersModal(projectId, projectName) {
    _projMembersModalProjectId = projectId;
    document.getElementById('projectMembersModalTitle').textContent = projectName + ' — 멤버';
    document.getElementById('proj-member-search').value = '';
    document.getElementById('proj-member-search-results').style.display = 'none';
    var listEl = document.getElementById('project-members-list');
    listEl.innerHTML = '<div class="text-center text-muted py-3">로딩 중...</div>';
    var modal = bootstrap.Modal.getInstance(document.getElementById('projectMembersModal')) || new bootstrap.Modal(document.getElementById('projectMembersModal'));
    modal.show();

    // 전체 멤버 캐시 로드
    try {
        var allRes = await apiCall('/api/v1/members');
        _projMembersModalAllMembers = (allRes.success && allRes.data) ? allRes.data : [];
    } catch (e) { _projMembersModalAllMembers = []; }

    await renderProjectMembersModalList();
}

async function renderProjectMembersModalList() {
    var projectId = _projMembersModalProjectId;
    var listEl = document.getElementById('project-members-list');
    try {
        var res = await apiCall('/api/v1/projects/' + projectId);
        var members = (res.success && res.data && res.data.members) ? res.data.members : [];
        if (members.length === 0) {
            listEl.innerHTML = '<div class="text-center text-muted py-3">배정된 멤버가 없습니다.</div>';
            return;
        }
        var roleOrder = { PM: 0, EM: 1, BE: 2, FE: 3, QA: 4, PLACEHOLDER: 5 };
        members.sort(function(a, b) {
            var ra = roleOrder[a.role] != null ? roleOrder[a.role] : 99;
            var rb = roleOrder[b.role] != null ? roleOrder[b.role] : 99;
            return ra !== rb ? ra - rb : (a.name || '').localeCompare(b.name || '');
        });
        var html = '<table class="table table-sm mb-0"><thead><tr><th>이름</th><th>역할</th><th>캐파</th><th>팀</th><th></th></tr></thead><tbody>';
        members.forEach(function(m) {
            html += '<tr>';
            html += '<td>' + escapeHtml(m.name) + '</td>';
            html += '<td>' + roleBadge(m.role) + '</td>';
            html += '<td style="text-align:center;">' + (m.capacity != null ? m.capacity : '-') + '</td>';
            html += '<td>' + escapeHtml(m.team || '-') + '</td>';
            html += '<td class="text-end"><button class="btn btn-outline-danger btn-sm" style="padding:0 4px; font-size:0.7rem;" onclick="removeProjMemberFromModal(' + projectId + ',' + m.id + ',\'' + escapeJsString(escapeHtml(m.name)) + '\')"><i class="bi bi-x-lg"></i></button></td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = '<div class="text-center text-danger py-3">로드 실패</div>';
    }
}

function filterProjMemberSearch() {
    var input = document.getElementById('proj-member-search');
    var dropdown = document.getElementById('proj-member-search-results');
    var keyword = input.value.trim().toLowerCase();
    if (!keyword) { dropdown.style.display = 'none'; return; }

    // 현재 프로젝트 멤버 ID 수집 (이미 추가된 멤버 제외)
    var currentIds = [];
    document.querySelectorAll('#project-members-list table tbody tr').forEach(function(row) {
        var btn = row.querySelector('button[onclick]');
        if (btn) {
            var match = btn.getAttribute('onclick').match(/removeProjMemberFromModal\(\d+,(\d+)/);
            if (match) currentIds.push(parseInt(match[1]));
        }
    });

    var matches = _projMembersModalAllMembers.filter(function(m) {
        if (currentIds.indexOf(m.id) !== -1) return false;
        return (m.name || '').toLowerCase().indexOf(keyword) !== -1;
    });

    if (matches.length === 0) {
        dropdown.innerHTML = '<div class="px-2 py-1 text-muted" style="font-size:0.85rem;">결과 없음</div>';
    } else {
        var html = '';
        matches.slice(0, 10).forEach(function(m) {
            html += '<a href="javascript:void(0)" class="d-block px-2 py-1 text-decoration-none rounded" style="font-size:0.85rem; color:#333;" onmouseover="this.style.background=\'#e9ecef\'" onmouseout="this.style.background=\'\'" onclick="addProjMemberFromModal(' + _projMembersModalProjectId + ',' + m.id + ')">'
                + escapeHtml(m.name) + ' <span class="text-muted">(' + m.role + (m.team ? ', ' + escapeHtml(m.team) : '') + ')</span></a>';
        });
        dropdown.innerHTML = html;
    }
    dropdown.style.display = '';
}

async function addProjMemberFromModal(projectId, memberId) {
    document.getElementById('proj-member-search').value = '';
    document.getElementById('proj-member-search-results').style.display = 'none';
    try {
        await apiCall('/api/v1/projects/' + projectId + '/members', 'POST', { memberId: memberId });
        await renderProjectMembersModalList();
        showToast('멤버가 추가되었습니다.', 'success');
    } catch (e) { showToast('멤버 추가 실패', 'error'); }
}

async function removeProjMemberFromModal(projectId, memberId, memberName) {
    if (!confirm(memberName + ' 멤버를 제거하시겠습니까?')) return;
    try {
        await apiCall('/api/v1/projects/' + projectId + '/members/' + memberId, 'DELETE');
        await renderProjectMembersModalList();
        showToast(memberName + ' 멤버가 제거되었습니다.', 'success');
    } catch (e) { showToast('멤버 제거 실패', 'error'); }
}

var _cachedMembers = [];
var _memberSortField = 'name';
var _memberSortAsc = true;

async function loadMembers() {
    try {
        var res = await apiCall('/api/v1/members');
        _cachedMembers = (res.success && res.data) ? res.data : [];
        renderMembersTable();
    } catch (e) {
        console.error('멤버 목록 로드 실패:', e);
        showToast('멤버 목록을 불러오는데 실패했습니다.', 'error');
    }
}

function sortMembers(field) {
    if (_memberSortField === field) {
        _memberSortAsc = !_memberSortAsc;
    } else {
        _memberSortField = field;
        _memberSortAsc = true;
    }
    renderMembersTable();
}

function renderMembersTable() {
    var tbody = document.getElementById('members-table');
    if (_cachedMembers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">등록된 멤버가 없습니다.</td></tr>';
        updateMemberSortIcons();
        return;
    }

    var sorted = _cachedMembers.slice().sort(function(a, b) {
        var va, vb;
        if (_memberSortField === 'capacity') {
            va = a.capacity != null ? parseFloat(a.capacity) : 1.0;
            vb = b.capacity != null ? parseFloat(b.capacity) : 1.0;
        } else {
            va = (a[_memberSortField] || '').toString().toLowerCase();
            vb = (b[_memberSortField] || '').toString().toLowerCase();
        }
        if (va < vb) return _memberSortAsc ? -1 : 1;
        if (va > vb) return _memberSortAsc ? 1 : -1;
        return 0;
    });

    var html = '';
    sorted.forEach(function(m) {
        html += '<tr>';
        html += '<td>' + escapeHtml(m.name) + '</td>';
        html += '<td>' + roleBadge(m.role) + '</td>';
        html += '<td>' + escapeHtml(m.team || '-') + '</td>';
        html += '<td>' + escapeHtml(m.email || '-') + '</td>';
        html += '<td>' + (m.capacity != null ? m.capacity : '1.0') + '</td>';
        html += '<td class="text-center">';
        html += '<div class="action-buttons">';
        html += '<button class="btn btn-outline-primary btn-sm" onclick="showMemberModal(' + m.id + ')" title="수정"><i class="bi bi-pencil"></i></button>';
        html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteMember(' + m.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
        html += '</div>';
        html += '</td>';
        html += '</tr>';
    });
    tbody.innerHTML = html;
    updateMemberSortIcons();
}

function updateMemberSortIcons() {
    var fields = ['name', 'role', 'team', 'email', 'capacity'];
    fields.forEach(function(f) {
        var icon = document.getElementById('member-sort-icon-' + f);
        if (!icon) return;
        if (f === _memberSortField) {
            icon.className = 'bi ' + (_memberSortAsc ? 'bi-sort-down' : 'bi-sort-up');
            icon.classList.remove('text-muted');
        } else {
            icon.className = 'bi bi-arrow-down-up text-muted';
        }
    });
}

async function showMemberModal(memberId) {
    document.getElementById('member-id').value = '';
    document.getElementById('member-name').value = '';
    document.getElementById('member-role').value = 'BE';
    document.getElementById('member-team').value = '';
    document.getElementById('member-email').value = '';
    document.getElementById('member-capacity').value = '1.0';
    document.getElementById('member-queue-start-date').value = '';

    if (memberId) {
        document.getElementById('memberModalTitle').textContent = '멤버 수정';
        try {
            var res = await apiCall('/api/v1/members/' + memberId);
            if (res.success && res.data) {
                var m = res.data;
                document.getElementById('member-id').value = m.id;
                document.getElementById('member-name').value = m.name || '';
                document.getElementById('member-role').value = m.role || 'BE';
                document.getElementById('member-team').value = m.team || '';
                document.getElementById('member-email').value = m.email || '';
                document.getElementById('member-capacity').value = m.capacity != null ? m.capacity : '1.0';
                document.getElementById('member-queue-start-date').value = m.queueStartDate || '';
            }
        } catch (e) {
            showToast('멤버 정보를 불러오는데 실패했습니다.', 'error');
            return;
        }
    } else {
        document.getElementById('memberModalTitle').textContent = '멤버 추가';
    }

    var modal = new bootstrap.Modal(document.getElementById('memberModal'));
    modal.show();
}

async function saveMember() {
    var id = document.getElementById('member-id').value;
    var name = document.getElementById('member-name').value.trim();
    var role = document.getElementById('member-role').value;
    var team = document.getElementById('member-team').value.trim();
    var email = document.getElementById('member-email').value.trim();
    var capacity = document.getElementById('member-capacity').value;
    var queueStartDate = document.getElementById('member-queue-start-date').value;

    if (!name) {
        showToast('이름을 입력해주세요.', 'warning');
        return;
    }

    var body = { name: name, role: role, team: team || null, email: email, capacity: capacity ? parseFloat(capacity) : 1.0, queueStartDate: queueStartDate || null };

    try {
        var res;
        if (id) {
            res = await apiCall('/api/v1/members/' + id, 'PUT', body);
        } else {
            res = await apiCall('/api/v1/members', 'POST', body);
        }

        if (res.success) {
            showToast(id ? '멤버가 수정되었습니다.' : '멤버가 추가되었습니다.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('memberModal')).hide();
            loadMembers();
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('멤버 저장 실패:', e);
        showToast('멤버 저장에 실패했습니다.', 'error');
    }
}

async function deleteMember(id) {
    if (!confirmAction('이 멤버를 삭제하시겠습니까?')) return;

    try {
        var res = await apiCall('/api/v1/members/' + id, 'DELETE');
        if (res.success) {
            showToast('멤버가 삭제되었습니다.', 'success');
            loadMembers();
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('멤버 삭제 실패:', e);
        showToast('멤버 삭제에 실패했습니다.', 'error');
    }
}

// ========================================
// Domain Systems
// ========================================

async function loadDomainSystems() {
    try {
        var res = await apiCall('/api/v1/domain-systems');
        var domainSystems = (res.success && res.data) ? res.data : [];
        var tbody = document.getElementById('domain-systems-table');

        if (domainSystems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">등록된 도메인 시스템이 없습니다.</td></tr>';
            return;
        }

        var html = '';
        domainSystems.forEach(function(ds) {
            html += '<tr>';
            html += '<td>' + escapeHtml(ds.name) + '</td>';
            html += '<td>' + escapeHtml(ds.description || '-') + '</td>';
            html += '<td><span class="color-preview" style="background-color:' + sanitizeColor(ds.color) + '"></span>' + escapeHtml(ds.color || '-') + '</td>';
            html += '<td class="text-center">';
            html += '<div class="action-buttons">';
            html += '<button class="btn btn-outline-primary btn-sm" onclick="showDomainSystemModal(' + ds.id + ')" title="수정"><i class="bi bi-pencil"></i></button>';
            html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteDomainSystem(' + ds.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
            html += '</div>';
            html += '</td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
    } catch (e) {
        console.error('도메인 시스템 목록 로드 실패:', e);
        showToast('도메인 시스템 목록을 불러오는데 실패했습니다.', 'error');
    }
}

async function showDomainSystemModal(dsId) {
    document.getElementById('ds-id').value = '';
    document.getElementById('ds-name').value = '';
    document.getElementById('ds-description').value = '';
    document.getElementById('ds-color').value = '#4A90D9';
    document.getElementById('ds-color-label').textContent = '#4A90D9';

    if (dsId) {
        document.getElementById('domainSystemModalTitle').textContent = '도메인 시스템 수정';
        try {
            var res = await apiCall('/api/v1/domain-systems/' + dsId);
            if (res.success && res.data) {
                var ds = res.data;
                document.getElementById('ds-id').value = ds.id;
                document.getElementById('ds-name').value = ds.name || '';
                document.getElementById('ds-description').value = ds.description || '';
                document.getElementById('ds-color').value = ds.color || '#4A90D9';
                document.getElementById('ds-color-label').textContent = ds.color || '#4A90D9';
            }
        } catch (e) {
            showToast('도메인 시스템 정보를 불러오는데 실패했습니다.', 'error');
            return;
        }
    } else {
        document.getElementById('domainSystemModalTitle').textContent = '도메인 시스템 추가';
    }

    var modal = new bootstrap.Modal(document.getElementById('domainSystemModal'));
    modal.show();
}

async function saveDomainSystem() {
    var id = document.getElementById('ds-id').value;
    var name = document.getElementById('ds-name').value.trim();
    var description = document.getElementById('ds-description').value.trim();
    var color = document.getElementById('ds-color').value;

    if (!name) {
        showToast('이름을 입력해주세요.', 'warning');
        return;
    }

    var body = { name: name, description: description, color: color };

    try {
        var res;
        if (id) {
            res = await apiCall('/api/v1/domain-systems/' + id, 'PUT', body);
        } else {
            res = await apiCall('/api/v1/domain-systems', 'POST', body);
        }

        if (res.success) {
            showToast(id ? '도메인 시스템이 수정되었습니다.' : '도메인 시스템이 추가되었습니다.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('domainSystemModal')).hide();
            loadDomainSystems();
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('도메인 시스템 저장 실패:', e);
        showToast('도메인 시스템 저장에 실패했습니다.', 'error');
    }
}

async function deleteDomainSystem(id) {
    if (!confirmAction('이 도메인 시스템을 삭제하시겠습니까?')) return;

    try {
        var res = await apiCall('/api/v1/domain-systems/' + id, 'DELETE');
        if (res.success) {
            showToast('도메인 시스템이 삭제되었습니다.', 'success');
            loadDomainSystems();
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('도메인 시스템 삭제 실패:', e);
        showToast('도메인 시스템 삭제에 실패했습니다.', 'error');
    }
}

// ========================================
// Projects
// ========================================

var _projFilterType = [];
var _projFilterQuarter = [];

function applyProjectListStatusFilter(projects) {
    var result = projects;
    // 상태 필터
    if (projectListStatusFilter.length > 0) {
        result = result.filter(function(p) { return projectListStatusFilter.indexOf(p.status) !== -1; });
    }
    // 프로젝트명 검색
    var nameFilter = (document.getElementById('proj-filter-name') || {}).value || '';
    if (nameFilter.trim()) {
        var kw = nameFilter.trim().toLowerCase();
        result = result.filter(function(p) { return (p.name || '').toLowerCase().indexOf(kw) !== -1; });
    }
    // PPL 필터
    var pplFilter = (document.getElementById('proj-filter-ppl') || {}).value || '';
    if (pplFilter) {
        result = result.filter(function(p) { return p.pplName === pplFilter; });
    }
    // EPL 필터
    var eplFilter = (document.getElementById('proj-filter-epl') || {}).value || '';
    if (eplFilter) {
        result = result.filter(function(p) { return p.eplName === eplFilter; });
    }
    // 유형 필터
    if (_projFilterType.length > 0) {
        result = result.filter(function(p) { return _projFilterType.indexOf(p.projectType) !== -1; });
    }
    // 분기 필터
    if (_projFilterQuarter.length > 0) {
        result = result.filter(function(p) {
            if (!p.quarter) return false;
            var qs = p.quarter.split(',').map(function(q) { return q.trim(); });
            return _projFilterQuarter.some(function(fq) { return qs.indexOf(fq) !== -1; });
        });
    }
    return result;
}

function applyProjectListFilters() {
    renderProjectsTable(window._cachedProjects || []);
}

function onProjFilterStatusChange() {
    projectListStatusFilter = [];
    document.querySelectorAll('.proj-filter-status-cb:checked').forEach(function(cb) { projectListStatusFilter.push(cb.value); });
    localStorage.setItem('projectListStatusFilter_v2', JSON.stringify(projectListStatusFilter));
    var btn = document.getElementById('proj-filter-status-btn');
    if (btn) btn.textContent = projectListStatusFilter.length > 0 ? '상태 (' + projectListStatusFilter.length + ')' : '상태';
    applyProjectListFilters();
}

function onProjFilterTypeChange() {
    _projFilterType = [];
    document.querySelectorAll('.proj-filter-type-cb:checked').forEach(function(cb) { _projFilterType.push(cb.value); });
    var btn = document.getElementById('proj-filter-type-btn');
    if (btn) btn.textContent = _projFilterType.length > 0 ? '유형 (' + _projFilterType.length + ')' : '유형';
    applyProjectListFilters();
}

function onProjFilterQuarterChange() {
    _projFilterQuarter = [];
    document.querySelectorAll('.proj-filter-quarter-cb:checked').forEach(function(cb) { _projFilterQuarter.push(cb.value); });
    var btn = document.getElementById('proj-filter-quarter-btn');
    if (btn) btn.textContent = _projFilterQuarter.length > 0 ? '분기 (' + _projFilterQuarter.length + ')' : '분기';
    applyProjectListFilters();
}

function populateProjectFilterOptions(projects) {
    // PPL/EPL 드롭다운
    var ppls = {}, epls = {}, types = {}, quarters = {};
    projects.forEach(function(p) {
        if (p.pplName) ppls[p.pplName] = true;
        if (p.eplName) epls[p.eplName] = true;
        if (p.projectType) types[p.projectType] = true;
        if (p.quarter) p.quarter.split(',').forEach(function(q) { q = q.trim(); if (q) quarters[q] = true; });
    });

    var pplSel = document.getElementById('proj-filter-ppl');
    var curPpl = pplSel ? pplSel.value : '';
    if (pplSel) {
        pplSel.innerHTML = '<option value="">PPL 전체</option>';
        Object.keys(ppls).sort().forEach(function(n) { pplSel.innerHTML += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; });
        pplSel.value = curPpl;
    }
    var eplSel = document.getElementById('proj-filter-epl');
    var curEpl = eplSel ? eplSel.value : '';
    if (eplSel) {
        eplSel.innerHTML = '<option value="">EPL 전체</option>';
        Object.keys(epls).sort().forEach(function(n) { eplSel.innerHTML += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; });
        eplSel.value = curEpl;
    }
    // 유형 드롭다운 체크박스
    var typeMenu = document.getElementById('proj-filter-type-menu');
    if (typeMenu) {
        var typeHtml = '';
        var typeKeys = Object.keys(types).sort();
        typeKeys.forEach(function(t) {
            var checked = _projFilterType.indexOf(t) !== -1 ? ' checked' : '';
            typeHtml += '<div class="form-check"><input class="form-check-input proj-filter-type-cb" type="checkbox" value="' + escapeHtml(t) + '" id="pft-' + escapeHtml(t) + '"' + checked + ' onchange="onProjFilterTypeChange()"><label class="form-check-label" for="pft-' + escapeHtml(t) + '">' + escapeHtml(t) + '</label></div>';
        });
        typeMenu.innerHTML = typeHtml || '<div class="text-muted">유형 없음</div>';
        var typeBtn = document.getElementById('proj-filter-type-btn');
        if (typeBtn) typeBtn.textContent = _projFilterType.length > 0 ? '유형 (' + _projFilterType.length + ')' : '유형';
    }
    // 분기 드롭다운 체크박스
    var qMenu = document.getElementById('proj-filter-quarter-menu');
    if (qMenu) {
        var qHtml = '';
        var qKeys = Object.keys(quarters).sort();
        qKeys.forEach(function(q) {
            var checked = _projFilterQuarter.indexOf(q) !== -1 ? ' checked' : '';
            qHtml += '<div class="form-check"><input class="form-check-input proj-filter-quarter-cb" type="checkbox" value="' + escapeHtml(q) + '" id="pfq-' + escapeHtml(q) + '"' + checked + ' onchange="onProjFilterQuarterChange()"><label class="form-check-label" for="pfq-' + escapeHtml(q) + '">' + escapeHtml(q) + '</label></div>';
        });
        qMenu.innerHTML = qHtml || '<div class="text-muted">분기 없음</div>';
        var qBtn = document.getElementById('proj-filter-quarter-btn');
        if (qBtn) qBtn.textContent = _projFilterQuarter.length > 0 ? '분기 (' + _projFilterQuarter.length + ')' : '분기';
    }
}

function renderProjectListFilterButtons() {
    var menu = document.getElementById('proj-filter-status-menu');
    if (!menu) return;
    var sf = projectListStatusFilter;
    var statuses = [
        { value: 'PLANNING', label: '플래닝' },
        { value: 'IN_PROGRESS', label: '진행중' },
        { value: 'COMPLETED', label: '완료' },
        { value: 'ON_HOLD', label: '보류' }
    ];
    var html = '';
    statuses.forEach(function(s) {
        var checked = sf.indexOf(s.value) !== -1 ? ' checked' : '';
        html += '<div class="form-check"><input class="form-check-input proj-filter-status-cb" type="checkbox" value="' + s.value + '" id="pfs-' + s.value + '"' + checked + ' onchange="onProjFilterStatusChange()"><label class="form-check-label" for="pfs-' + s.value + '">' + s.label + '</label></div>';
    });
    menu.innerHTML = html;
    var btn = document.getElementById('proj-filter-status-btn');
    if (btn) btn.textContent = sf.length > 0 ? '상태 (' + sf.length + ')' : '상태';
}

/**
 * 프로젝트 목록 테이블 렌더링 (필터 적용)
 */
var _projSortField = null;
var _projSortAsc = true;

function renderProjectsTable(projects) {
    var tbody = document.getElementById('projects-table');
    var filtered = applyProjectListStatusFilter(projects);

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" class="text-center text-muted">해당 상태의 프로젝트가 없습니다.</td></tr>';
        updateProjSortIcons();
        return;
    }

    // 클라이언트 정렬 적용
    if (_projSortField) {
        filtered = filtered.slice().sort(function(a, b) {
            var va, vb;
            if (_projSortField === 'sortOrder' || _projSortField === 'totalManDays' || _projSortField === 'estimatedDays') {
                va = a[_projSortField] != null ? Number(a[_projSortField]) : 0;
                vb = b[_projSortField] != null ? Number(b[_projSortField]) : 0;
            } else {
                va = (a[_projSortField] || '').toString().toLowerCase();
                vb = (b[_projSortField] || '').toString().toLowerCase();
            }
            if (va < vb) return _projSortAsc ? -1 : 1;
            if (va > vb) return _projSortAsc ? 1 : -1;
            return 0;
        });
    }

    var html = '';
    filtered.forEach(function(p) {
        var memberCount = p.memberCount != null ? p.memberCount : 0;
        var delayHtml = '';
        if (p.isDelayed === true) {
            delayHtml = '<span class="delay-indicator delayed"><i class="bi bi-exclamation-triangle-fill"></i> 지연</span>';
        } else if (p.isDelayed === false) {
            delayHtml = '<span class="delay-indicator on-track"><i class="bi bi-check-circle-fill"></i> 정상</span>';
        } else {
            delayHtml = '-';
        }
        html += '<tr data-project-id="' + p.id + '">';
        html += '<td class="text-center" style="padding:4px;"><input type="checkbox" class="proj-schedule-cb" value="' + p.id + '" onclick="event.stopPropagation(); updateScheduleCalcBtn()"></td>';
        html += '<td class="text-center" style="padding:4px;"><button class="btn btn-sm p-0 border-0 text-muted proj-ms-toggle" data-project-id="' + p.id + '" onclick="event.stopPropagation(); toggleProjectMilestones(' + p.id + ', this)" title="마일스톤"><i class="bi bi-chevron-right"></i></button></td>';
        html += '<td class="proj-drag-handle" style="cursor:grab; text-align:center; color:#adb5bd; padding:4px;"><i class="bi bi-grip-vertical"></i></td>';
        var descTooltip = p.description ? ' data-bs-toggle="tooltip" data-bs-placement="top" data-bs-html="true" data-bs-custom-class="tooltip-left-align" title="' + escapeHtml(p.description).replace(/\n/g, '<br>') + '"' : '';
        html += '<td class="text-center" style="padding:4px;"><button class="btn btn-sm p-0 border-0 text-info" onclick="showProjectLinksPopup(' + p.id + ', this, event)" title="링크"><i class="bi bi-link-45deg"></i></button></td>';
        html += '<td class="cursor-pointer" onclick="showProjectDetail(' + p.id + ')"' + descTooltip + '><strong>' + escapeHtml(p.name) + '</strong></td>';
        html += '<td><a href="javascript:void(0)" onclick="event.stopPropagation(); showProjectMembersModal(' + p.id + ', \'' + escapeJsString(escapeHtml(p.name)) + '\')" style="text-decoration:none;">' + memberCount + '명</a></td>';
        var beCount = p.beCount != null ? p.beCount : 0;
        var beTooltip = '';
        if (p.beMembers && p.beMembers.length > 0) {
            beTooltip = ' data-bs-toggle="tooltip" data-bs-placement="bottom" title="' + p.beMembers.map(function(m) { return escapeHtml(m.name) + '(' + m.capacity + ')'; }).join(', ') + '"';
        }
        html += '<td style="font-size:0.85rem; text-align:center; cursor:default;"' + beTooltip + '>' + (beCount > 0 ? beCount : '-') + '</td>';
        var mdVal = p.totalManDays != null && p.totalManDays > 0 ? p.totalManDays : '-';
        html += '<td style="font-size:0.85rem; text-align:center;">' + mdVal + '</td>';
        var estDays = p.estimatedDays != null && p.estimatedDays > 0 ? p.estimatedDays : '-';
        html += '<td style="font-size:0.85rem; text-align:center;">' + estDays + '</td>';
        html += '<td>' + formatDateWithDay(p.startDate) + '</td>';
        html += '<td>' + formatDateWithDay(p.endDate) + '</td>';
        html += '<td style="font-size:0.8rem;">' + escapeHtml(p.pplName || '-') + '</td>';
        html += '<td style="font-size:0.8rem;">' + escapeHtml(p.quarter || '-') + '</td>';
        html += '<td>' + typeBadge(p.projectType) + '</td>';
        html += '<td>' + statusBadge(p.status) + '</td>';
        html += '<td>' + delayHtml + '</td>';
        html += '<td class="text-center">';
        html += '<div class="action-buttons">';
        html += '<button class="btn btn-outline-primary btn-sm" onclick="event.stopPropagation(); showProjectModal(' + p.id + ')" title="수정"><i class="bi bi-pencil"></i></button>';
        html += '<button class="btn btn-outline-danger btn-sm" onclick="event.stopPropagation(); deleteProject(' + p.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
        html += '</div>';
        html += '</td>';
        html += '</tr>';
    });
    tbody.innerHTML = html;
    updateProjSortIcons();
    // Bootstrap tooltip 초기화 (html 지원)
    tbody.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function(el) {
        new bootstrap.Tooltip(el, { html: true });
    });
    // 정렬 상태 표시 + 드래그 제어
    var sortResetEl = document.getElementById('proj-sort-reset');
    if (_projSortField) {
        // 헤더 정렬 활성 → 드래그 비활성, 리셋 버튼 표시
        if (sortResetEl) sortResetEl.style.display = '';
        tbody.querySelectorAll('.proj-drag-handle').forEach(function(el) { el.style.visibility = 'hidden'; });
    } else {
        if (sortResetEl) sortResetEl.style.display = 'none';
        initProjectListDragDrop(tbody);
    }
}

function initProjectListDragDrop(tbody) {
    if (typeof Sortable === 'undefined' || !tbody) return;
    if (tbody._sortable) tbody._sortable.destroy();
    tbody._sortable = new Sortable(tbody, {
        handle: '.proj-drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        draggable: 'tr[data-project-id]:not([class*="ms-row"])',
        onStart: function() {
            // 드래그 시작 시 모든 마일스톤 행 접기
            tbody.querySelectorAll('tr[class*="ms-row"]').forEach(function(r) { r.remove(); });
            tbody.querySelectorAll('.proj-ms-toggle i').forEach(function(icon) {
                icon.className = 'bi bi-chevron-right';
            });
        },
        onEnd: function() {
            var rows = tbody.querySelectorAll('tr[data-project-id]');
            var ids = [];
            rows.forEach(function(row) { ids.push(parseInt(row.getAttribute('data-project-id'))); });
            saveProjectListOrder(ids);
        }
    });
}

async function saveProjectListOrder(projectIds) {
    try {
        for (var i = 0; i < projectIds.length; i++) {
            await apiCall('/api/v1/projects/' + projectIds[i] + '/sort-order', 'PATCH', { sortOrder: i + 1 });
        }
        // 캐시 업데이트
        if (window._cachedProjects) {
            projectIds.forEach(function(pid, idx) {
                var p = window._cachedProjects.find(function(proj) { return proj.id === pid; });
                if (p) p.sortOrder = idx + 1;
            });
        }
        showToast('프로젝트 순서가 변경되었습니다.', 'success');
    } catch (e) {
        showToast('순서 변경 실패', 'error');
    }
}

async function updateProjectSortOrder(projectId, value) {
    var sortOrder = value !== '' ? parseInt(value) : null;
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/sort-order', 'PATCH', { sortOrder: sortOrder });
        if (res.success) {
            // 캐시 업데이트
            var p = window._cachedProjects.find(function(proj) { return proj.id === projectId; });
            if (p) p.sortOrder = sortOrder;
            showToast('순서가 변경되었습니다.', 'success');
        }
    } catch (e) {
        showToast('순서 변경에 실패했습니다.', 'error');
    }
}

function sortProjectList(field) {
    if (_projSortField === field) {
        _projSortAsc = !_projSortAsc;
    } else {
        _projSortField = field;
        _projSortAsc = true;
    }
    renderProjectsTable(window._cachedProjects || []);
}

function resetProjectListSort() {
    _projSortField = null;
    _projSortAsc = true;
    renderProjectsTable(window._cachedProjects || []);
}

function updateProjSortIcons() {
    var fields = ['name', 'totalManDays', 'estimatedDays', 'projectType', 'status', 'startDate', 'endDate'];
    fields.forEach(function(f) {
        var icon = document.getElementById('proj-sort-icon-' + f);
        if (!icon) return;
        if (f === _projSortField) {
            icon.className = 'bi ' + (_projSortAsc ? 'bi-sort-down' : 'bi-sort-up');
            icon.classList.remove('text-muted');
        } else {
            icon.className = 'bi bi-arrow-down-up text-muted';
        }
    });
}

async function toggleProjectMilestones(projectId, btn) {
    await loadHolidayDatesCache();
    var existingRows = document.querySelectorAll('.ms-row-' + projectId);
    if (existingRows.length > 0) {
        // 접기
        existingRows.forEach(function(r) { r.remove(); });
        btn.querySelector('i').className = 'bi bi-chevron-right';
        return;
    }
    // 펼치기
    btn.querySelector('i').className = 'bi bi-chevron-down';
    var projectRow = document.querySelector('#projects-table tr[data-project-id="' + projectId + '"]');
    if (!projectRow) return;
    // 로딩 row
    var colCount = projectRow.children.length;
    var loadingRow = document.createElement('tr');
    loadingRow.className = 'ms-row-' + projectId;
    loadingRow.innerHTML = '<td colspan="' + colCount + '" class="text-center text-muted" style="font-size:0.8rem; background:#fafafa;">로딩 중...</td>';
    projectRow.after(loadingRow);
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/milestones');
        loadingRow.remove();
        var milestones = (res.success && res.data) ? res.data : [];
        if (milestones.length === 0) {
            var emptyRow = document.createElement('tr');
            emptyRow.className = 'ms-row-' + projectId;
            emptyRow.innerHTML = '<td colspan="' + colCount + '" style="font-size:0.8rem; background:#fafafa; padding-left:60px;" class="text-muted">마일스톤 없음</td>';
            projectRow.after(emptyRow);
            return;
        }
        // 역순으로 insert (after이므로 마지막 것이 가장 위에)
        // 헤더 순서: [체크] [토글] [드래그] [링크] | 프로젝트명 | 멤버 | BE | MD | 소요일 | 시작일 | 론치일 | PPL | 분기 | 유형 | 상태 | 지연 | 액션
        // 마일스톤:  [빈4칸]                       | 이름       | -   | -  | -  | QA일수 | 시작일 | 종료일 | [나머지 pad]
        var msPadCols = colCount - 11; // 11 = 4(빈) + 이름 + 멤버 + BE + MD + 소요일 + 시작일 + 론치일
        for (var i = milestones.length - 1; i >= 0; i--) {
            var ms = milestones[i];
            var msRow = document.createElement('tr');
            msRow.className = 'ms-row-' + projectId;
            msRow.style.fontSize = '0.82rem';
            msRow.style.background = '#fafafa';
            var msDays = (ms.startDate && ms.endDate) ? calcWorkingDays(ms.startDate, ms.endDate) : null;
            var msDaysLabel = msDays != null ? ' <span class="text-muted" style="font-size:0.75rem;">(' + msDays + ' days)</span>' : '';
            var msTypeLabel = ms.type ? (_milestoneTypeLabels[ms.type] || ms.type) : '';
            var msNameDisplay = (msTypeLabel ? '<span class="badge bg-secondary me-1" style="font-size:0.7rem;">' + msTypeLabel + '</span>' : '') + escapeHtml(ms.name) + msDaysLabel;
            // 소요일 컬럼: QA 마일스톤이면 일수 표시
            var msEstDays = (ms.type === 'QA' && ms.days) ? ms.days : '';
            msRow.innerHTML = '<td></td><td></td><td></td><td></td>'
                + '<td style="padding-left:8px; color:' + getMilestoneColor(ms.name) + ';">' + msNameDisplay + '</td>'
                + '<td></td><td></td><td></td>'
                + '<td style="text-align:center;">' + msEstDays + '</td>'
                + '<td>' + formatDateWithDay(ms.startDate) + '</td>'
                + '<td>' + formatDateWithDay(ms.endDate) + '</td>'
                + (msPadCols > 0 ? '<td colspan="' + msPadCols + '"></td>' : '');
            projectRow.after(msRow);
        }
    } catch (e) {
        loadingRow.innerHTML = '<td colspan="' + colCount + '" class="text-center text-danger" style="font-size:0.8rem; background:#fafafa;">로드 실패</td>';
    }
}

async function loadProjects() {
    // 목록 뷰 표시, 상세 뷰 숨김
    document.getElementById('project-list-view').style.display = '';
    document.getElementById('project-detail-view').style.display = 'none';

    renderProjectListFilterButtons();

    try {
        var res = await apiCall('/api/v1/projects');
        var projects = (res.success && res.data) ? res.data : [];
        window._cachedProjects = projects;
        populateProjectFilterOptions(projects);

        if (projects.length === 0) {
            document.getElementById('projects-table').innerHTML =
                '<tr><td colspan="10" class="text-center text-muted">등록된 프로젝트가 없습니다.</td></tr>';
            return;
        }

        renderProjectsTable(projects);
    } catch (e) {
        console.error('프로젝트 목록 로드 실패:', e);
        showToast('프로젝트 목록을 불러오는데 실패했습니다.', 'error');
    }
}

// ========================================
// 프로젝트 상세 뷰
// ========================================

function showProjectList() {
    document.getElementById('project-list-view').style.display = '';
    document.getElementById('project-detail-view').style.display = 'none';
    currentDetailProjectId = null;
    // hash 업데이트 (showSection을 거치지 않으므로 직접 갱신)
    _isNavigating = true;
    if (window.location.hash !== '#projects') {
        window.location.hash = 'projects';
    }
    _isNavigating = false;
    loadProjects();
}

async function showProjectDetail(projectId, tabName) {
    currentDetailProjectId = projectId;
    // hash 업데이트
    _isNavigating = true;
    if (window.location.hash !== '#project/' + projectId) {
        window.location.hash = 'project/' + projectId;
    }
    _isNavigating = false;
    document.getElementById('project-list-view').style.display = 'none';
    document.getElementById('project-detail-view').style.display = '';

    // 프로젝트 섹션으로 전환 (다른 섹션에서 호출 시)
    if (currentSection !== 'projects') {
        // 섹션만 전환하고 loadProjects()는 호출하지 않음 (재귀 방지)
        var sections = document.querySelectorAll('.section');
        sections.forEach(function(section) { section.style.display = 'none'; });
        var target = document.getElementById('projects-section');
        if (target) target.style.display = 'block';
        // 사이드바 active 갱신
        var navLinks = document.querySelectorAll('#sidebar .nav-link');
        navLinks.forEach(function(link) {
            link.classList.remove('active');
            if (link.getAttribute('data-section') === 'projects') {
                link.classList.add('active');
            }
        });
        currentSection = 'projects';
        document.getElementById('project-list-view').style.display = 'none';
        document.getElementById('project-detail-view').style.display = '';
    }

    // 탭 활성화
    if (tabName) {
        var tabMap = { 'tasks': '#tab-tasks', 'gantt': '#tab-gantt', 'milestones': '#tab-milestones', 'members': '#tab-members', 'links': '#tab-links' };
        var tabTarget = tabMap[tabName];
        if (tabTarget) {
            var tabEl = document.querySelector('#project-detail-tabs a[href="' + tabTarget + '"]');
            if (tabEl) {
                var bsTab = new bootstrap.Tab(tabEl);
                bsTab.show();
            }
        }
    } else {
        // 기본 태스크 탭
        var tasksTab = document.querySelector('#project-detail-tabs a[href="#tab-tasks"]');
        if (tasksTab) {
            var bsTab = new bootstrap.Tab(tasksTab);
            bsTab.show();
        }
    }

    // 프로젝트 데이터 로드 후 헤더 렌더링 + 태스크 탭 로드
    var projRes = await apiCall('/api/v1/projects/' + projectId);
    var p = (projRes.success && projRes.data) ? projRes.data : {};
    window._currentDetailProject = p;
    renderProjectDetailHeader(p);
    await loadProjectTasks(projectId);
}

function renderProjectDetailHeader(p) {
    // 프로젝트명 설정
    document.getElementById('project-detail-title').textContent = p.name || '';

    // 인라인 메타 렌더링
    var metaEl = document.getElementById('project-detail-meta');
    var metaHtml = '';
    metaHtml += typeBadge(p.projectType) + ' ';
    metaHtml += statusBadge(p.status) + ' ';
    metaHtml += '<span class="text-muted" style="font-size:0.88rem;">';
    metaHtml += formatDateWithDay(p.startDate) + ' ~ ' + formatDateWithDay(p.endDate);
    metaHtml += '</span>';
    if (p.pplName) metaHtml += ' <span class="badge bg-info" style="font-size:0.72rem;">PPL: ' + escapeHtml(p.pplName) + '</span>';
    if (p.eplName) metaHtml += ' <span class="badge bg-primary" style="font-size:0.72rem;">EPL: ' + escapeHtml(p.eplName) + '</span>';

    // 지연/정상 인라인 뱃지 (isDelayed가 null/undefined면 미표시)
    if (p.isDelayed === true) {
        var delayText = '지연';
        if (p.expectedEndDate) {
            delayText += ' (예상 종료: ' + escapeHtml(p.expectedEndDate) + ')';
        }
        metaHtml += ' <span class="badge bg-danger ms-1" style="font-size:0.75rem;">'
            + '<i class="bi bi-exclamation-triangle-fill"></i> ' + delayText + '</span>';
    } else if (p.isDelayed === false) {
        metaHtml += ' <span class="badge bg-success ms-1" style="font-size:0.75rem;">'
            + '<i class="bi bi-check-circle-fill"></i> 정상</span>';
    }

    // description은 지연 뱃지 뒤에 위치
    if (p.description) {
        metaHtml += ' <span class="text-muted text-truncate" style="font-size:0.85rem; max-width:400px; display:inline-block; vertical-align:middle;">| ' + escapeHtml(p.description) + '</span>';
    }
    metaEl.innerHTML = metaHtml;

    // delay warning div 비활성화
    var delayEl = document.getElementById('project-detail-delay-warning');
    delayEl.style.display = 'none';
    delayEl.innerHTML = '';

    // Jira 가져오기 버튼은 항상 표시 (보드 미설정이어도 Epic으로 하부 티켓 가져오기 가능)
    var jiraBtn = document.getElementById('jira-import-btn');
    if (jiraBtn) {
        jiraBtn.style.display = '';
    }
}

async function loadProjectTasks(projectId) {
    var contentEl = document.getElementById('project-tasks-content');

    // 아코디언 접기/펼치기 상태 저장 (DOM 재생성 전)
    var collapseStates = {};
    var collapseEls = contentEl.querySelectorAll('[id^="assignee-collapse-"]');
    collapseEls.forEach(function(el) {
        collapseStates[el.id] = el.classList.contains('show');
    });

    // 기존 flatpickr 인스턴스 정리 (메모리 누수 방지)
    var oldDateInputs = contentEl.querySelectorAll('.project-task-queue-start-date');
    oldDateInputs.forEach(function(el) {
        if (el._flatpickr) el._flatpickr.destroy();
    });

    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/tasks');
        if (!res.success || !res.data) {
            contentEl.innerHTML = '<div class="text-center text-muted">태스크를 불러올 수 없습니다.</div>';
            return;
        }
        var allTasks = [];
        var inactiveTasks = []; // HOLD, CANCELLED
        if (res.data.domainSystems) {
            res.data.domainSystems.forEach(function(ds) {
                if (ds.tasks) {
                    ds.tasks.forEach(function(t) {
                        t._domainSystemName = ds.name;
                        t._domainSystemColor = ds.color;
                        if (t.status === 'HOLD' || t.status === 'CANCELLED') {
                            inactiveTasks.push(t);
                        } else {
                            allTasks.push(t);
                        }
                    });
                }
            });
        }
        if (allTasks.length === 0 && inactiveTasks.length === 0) {
            contentEl.innerHTML = '<div class="d-flex align-items-center gap-2 mb-3">'
                + '<button class="btn btn-primary btn-sm" onclick="showTaskModal(null, ' + projectId + ')"><i class="bi bi-plus-lg"></i> 태스크 추가</button>'
                + '</div>'
                + '<div class="text-center text-muted p-3">등록된 태스크가 없습니다.</div>';
            return;
        }

        // 뷰 모드 토글 버튼
        var toggleHtml = '<div class="d-flex align-items-center flex-wrap gap-2 mb-3">';
        toggleHtml += '<div class="btn-group btn-group-sm" role="group">';
        toggleHtml += '<button type="button" class="btn ' + (projectTaskViewMode === 'grouped' ? 'btn-primary' : 'btn-outline-primary') + '" onclick="switchProjectTaskView(\'grouped\', ' + projectId + ')"><i class="bi bi-people-fill"></i> 멤버별</button>';
        toggleHtml += '<button type="button" class="btn ' + (projectTaskViewMode === 'flat' ? 'btn-primary' : 'btn-outline-primary') + '" onclick="switchProjectTaskView(\'flat\', ' + projectId + ')"><i class="bi bi-list-ul"></i> 전체</button>';
        toggleHtml += '</div>';
        // 상태 필터 버튼 그룹 (복수 선택)
        var af = projectTaskStatusFilter;
        var afAll = af.length === 0;
        toggleHtml += '<div class="btn-group btn-group-sm" id="project-status-filter-group">';
        toggleHtml += '<button type="button" class="btn btn-sm ' + (afAll ? 'btn-dark' : 'btn-outline-dark') + '" onclick="clearProjectStatusFilter(' + projectId + ')">전체</button>';
        toggleHtml += '<button type="button" class="btn btn-sm ' + (af.indexOf('TODO') !== -1 ? 'btn-warning' : 'btn-outline-warning') + '" onclick="toggleProjectStatusFilter(\'TODO\',' + projectId + ')">TODO</button>';
        toggleHtml += '<button type="button" class="btn btn-sm ' + (af.indexOf('IN_PROGRESS') !== -1 ? 'btn-primary' : 'btn-outline-primary') + '" onclick="toggleProjectStatusFilter(\'IN_PROGRESS\',' + projectId + ')">진행중</button>';
        toggleHtml += '<button type="button" class="btn btn-sm ' + (af.indexOf('COMPLETED') !== -1 ? 'btn-success' : 'btn-outline-success') + '" onclick="toggleProjectStatusFilter(\'COMPLETED\',' + projectId + ')">완료</button>';
        toggleHtml += '<button type="button" class="btn btn-sm ' + (af.indexOf('HOLD') !== -1 ? 'btn-secondary' : 'btn-outline-secondary') + '" onclick="toggleProjectStatusFilter(\'HOLD\',' + projectId + ')">홀드</button>';
        toggleHtml += '<button type="button" class="btn btn-sm ' + (af.indexOf('CANCELLED') !== -1 ? 'btn-danger' : 'btn-outline-danger') + '" onclick="toggleProjectStatusFilter(\'CANCELLED\',' + projectId + ')">취소</button>';
        toggleHtml += '</div>';
        var totalCount = allTasks.length + inactiveTasks.length;
        var allTasksConcat = allTasks.concat(inactiveTasks);
        var projTotalMd = allTasksConcat.reduce(function(s, t) { return s + (t.status !== 'CANCELLED' && t.manDays ? parseFloat(t.manDays) : 0); }, 0);
        var projRemainMd = allTasksConcat.reduce(function(s, t) { return s + (t.status !== 'CANCELLED' && t.status !== 'COMPLETED' && t.manDays ? parseFloat(t.manDays) : 0); }, 0);
        var mdOverrideVal = (window._currentDetailProject && window._currentDetailProject.totalManDaysOverride != null) ? window._currentDetailProject.totalManDaysOverride : '';
        toggleHtml += '<span class="text-muted" style="font-size:0.8rem;">' + totalCount + '건' + (inactiveTasks.length > 0 ? ' (비활성 ' + inactiveTasks.length + ')' : '') + ' | 공수: ' + projRemainMd + '/' + projTotalMd + ' MD'
            + ' | Override MD: <input type="number" id="project-md-override-inline" value="' + mdOverrideVal + '" placeholder="미입력" min="0" step="0.5" style="width:65px; font-size:0.8rem; padding:1px 4px; border:1px solid #ccc; border-radius:3px;" onchange="saveProjectMdOverride(this.value)">'
            + '</span>';
        toggleHtml += '<button class="btn btn-primary btn-sm" onclick="showTaskModal(null, ' + projectId + ')"><i class="bi bi-plus-lg"></i> 태스크 추가</button>';
        // grouped 뷰: 상단 전체선택 toolbar 없음 (멤버별 카드 헤더에 배치)
        // flat 뷰: 기존 전역 toolbar 유지
        if (projectTaskViewMode === 'flat') {
            toggleHtml += '<div id="project-batch-delete-toolbar" class="d-flex align-items-center gap-2">';
            toggleHtml += '<input type="checkbox" id="project-select-all" title="전체 선택">';
            toggleHtml += '<label for="project-select-all" class="mb-0" style="font-size:0.8rem;">전체 선택</label>';
            toggleHtml += '<button class="btn btn-danger btn-sm ms-2" id="project-batch-delete-btn" disabled>';
            toggleHtml += '<i class="bi bi-trash"></i> 선택 삭제 (<span id="project-selected-count">0</span>)';
            toggleHtml += '</button>';
            toggleHtml += '</div>';
        }
        toggleHtml += '</div>';

        var html = '';

        // 상태 필터 적용
        var filteredAllTasks = applyProjectStatusFilter(allTasks);

        if (projectTaskViewMode === 'flat') {
            // 전체 목록: 시작일 기준 정렬
            filteredAllTasks.sort(function(a, b) {
                return (a.startDate || '9999').localeCompare(b.startDate || '9999');
            });
            filteredAllTasks.forEach(function(t) {
                html += renderProjectTaskItem(t, null, projectId, false, true);
            });
        } else {
            // 멤버별 그룹화
            var assigneeGroups = {};
            var assigneeNames = {};
            filteredAllTasks.forEach(function(t) {
                var key = (t.assignee && t.assignee.id) ? t.assignee.id : 'unassigned';
                var name = (t.assignee && t.assignee.name) ? t.assignee.name : '미배정';
                if (!assigneeGroups[key]) {
                    assigneeGroups[key] = [];
                    assigneeNames[key] = name;
                }
                assigneeGroups[key].push(t);
            });

            var sortedKeys = Object.keys(assigneeGroups).sort(function(a, b) {
                if (a === 'unassigned') return 1;
                if (b === 'unassigned') return -1;
                return assigneeNames[a].localeCompare(assigneeNames[b]);
            });

            sortedKeys.forEach(function(key) {
                var tasks = assigneeGroups[key];
                var name = assigneeNames[key];
                var isUnassigned = (key === 'unassigned');

                var ordered = [];
                var unordered = [];
                var parallelTasks = [];
                tasks.forEach(function(t) {
                    if (t.executionMode === 'PARALLEL') {
                        parallelTasks.push(t);
                    } else if (!isUnassigned && t.assigneeOrder != null && t.assigneeOrder > 0) {
                        ordered.push(t);
                    } else {
                        unordered.push(t);
                    }
                });
                ordered.sort(function(a, b) { return (a.assigneeOrder || 0) - (b.assigneeOrder || 0); });

                var collapseId = 'assignee-collapse-' + key;
                html += '<div class="card mb-3">';
                html += '<div class="card-header py-2 assignee-collapse-header" style="cursor:pointer;" '
                      + 'data-collapse-target="#' + collapseId + '" '
                      + 'aria-expanded="true" aria-controls="' + collapseId + '">';
                html += '<div class="d-flex align-items-center gap-2">';
                html += '<i class="bi bi-person-fill"></i> <strong>' + escapeHtml(name) + '</strong>';
                if (!isUnassigned) {
                    var assigneeData = tasks[0] && tasks[0].assignee ? tasks[0].assignee : null;
                    var qsd = assigneeData && assigneeData.queueStartDate ? assigneeData.queueStartDate : '';
                    html += '<span class="text-muted ms-2" style="font-size:0.8rem;" onclick="event.stopPropagation()">착수일:</span>';
                    html += '<input type="text" class="form-control form-control-sm project-task-queue-start-date" data-member-id="' + key + '" data-member-name="' + escapeHtml(name) + '" value="' + escapeHtml(qsd) + '" placeholder="미지정" style="width:120px; font-size:0.8rem;" onclick="event.stopPropagation()">';
                    html += '<button class="btn btn-sm btn-outline-success project-task-queue-start-recalculate" data-member-id="' + key + '" data-member-name="' + escapeHtml(name) + '" style="padding:2px 6px;" title="TODO 태스크 일정 최적화" onclick="event.stopPropagation()"><i class="bi bi-arrow-repeat"></i> 일정 최적화</button>';
                    html += '<button class="btn btn-sm btn-outline-secondary project-task-unavailable-btn" data-member-id="' + key + '" data-member-name="' + escapeHtml(name) + '" style="padding:2px 6px;" title="비가용일 조회" onclick="event.stopPropagation()"><i class="bi bi-calendar-x"></i></button>';
                }
                // 멤버 카드 헤더에 멤버별 전체선택 추가
                var memberSelectId = 'member-select-all-' + key;
                var memberDeleteBtnId = 'member-batch-delete-btn-' + key;
                var memberCountId = 'member-selected-count-' + key;
                html += '<input type="checkbox" id="' + memberSelectId + '" class="member-select-all-cb" '
                    + 'data-member-key="' + key + '" title="이 멤버 태스크 전체 선택" style="cursor:pointer;" onclick="event.stopPropagation()">';
                html += '<button class="btn btn-danger btn-sm" id="' + memberDeleteBtnId + '" '
                    + 'data-member-key="' + key + '" disabled style="padding:2px 8px; font-size:0.78rem;" onclick="event.stopPropagation()">'
                    + '<i class="bi bi-trash"></i> 선택삭제(<span id="' + memberCountId + '">0</span>)'
                    + '</button>';

                var aTotalMd = tasks.reduce(function(s, t) { return s + (t.status !== 'CANCELLED' && t.manDays ? parseFloat(t.manDays) : 0); }, 0);
                var aRemainMd = tasks.reduce(function(s, t) { return s + (t.status !== 'CANCELLED' && t.status !== 'COMPLETED' && t.manDays ? parseFloat(t.manDays) : 0); }, 0);
                html += '<span class="text-muted ms-auto" style="font-size:0.8rem;">' + aRemainMd + '/' + aTotalMd + ' MD</span>';
                html += '<span class="badge bg-secondary ms-1">' + tasks.length + '건</span>';
                html += '<i class="bi bi-chevron-down ms-1 toggle-icon" style="transition: transform 0.2s;"></i>';
                html += '</div>';
                html += '</div>';
                html += '<div id="' + collapseId + '" class="collapse show">';
                html += '<div class="card-body p-2">';

                if (!isUnassigned && ordered.length > 0) {
                    html += '<div class="project-task-queue sortable-list" data-assignee-id="' + key + '">';
                    ordered.forEach(function(t, idx) {
                        html += renderProjectTaskItem(t, idx + 1, projectId, true, false);
                    });
                    html += '</div>';
                } else if (!isUnassigned) {
                    html += '<div class="project-task-queue sortable-list" data-assignee-id="' + key + '">';
                    html += '</div>';
                }

                if (!isUnassigned && unordered.length > 0) {
                    html += '<div class="mt-2 mb-1"><small class="text-warning"><i class="bi bi-exclamation-circle"></i> 순서 미지정 (' + unordered.length + '건) — 위로 드래그하여 순서 지정</small></div>';
                    html += '<div class="project-task-unordered sortable-list" data-assignee-id="' + key + '">';
                    unordered.forEach(function(t) {
                        html += renderProjectTaskItem(t, null, projectId, true, false);
                    });
                    html += '</div>';
                }

                if (parallelTasks.length > 0) {
                    html += '<div class="mt-2 mb-1"><small class="text-info"><i class="bi bi-arrows-expand"></i> PARALLEL (' + parallelTasks.length + '건) — 독립 일정</small></div>';
                    parallelTasks.forEach(function(t) {
                        html += renderProjectTaskItem(t, null, projectId, false, false);
                    });
                }

                if (isUnassigned) {
                    unordered.forEach(function(t) {
                        html += renderProjectTaskItem(t, null, projectId, false, true);
                    });
                }

                html += '</div></div></div>';  // card-body, collapse, card
            });
        }

        // HOLD/CANCELLED 태스크 별도 표시 (상태 필터에 따라 표시 여부 결정)
        var showInactive = (af.length === 0 || af.indexOf('HOLD') !== -1 || af.indexOf('CANCELLED') !== -1);
        if (showInactive && inactiveTasks.length > 0) {
            // 필터 비어있으면 전체, 아니면 선택된 상태만 필터링
            var filteredInactive = (af.length === 0) ? inactiveTasks : inactiveTasks.filter(function(t) { return af.indexOf(t.status) !== -1; });
            if (filteredInactive.length > 0) {
                html += '<div class="card mb-3 border-secondary" style="opacity:0.7;">';
                html += '<div class="card-header py-2 bg-light">';
                html += '<strong class="text-secondary" style="font-size:0.85rem;"><i class="bi bi-pause-circle"></i> 비활성 태스크 (' + filteredInactive.length + '건)</strong>';
                html += '</div>';
                html += '<div class="card-body p-2">';
                filteredInactive.forEach(function(t) {
                    html += renderProjectTaskItem(t, null, projectId, false, true);
                });
                html += '</div></div>';
            }
        }

        contentEl.innerHTML = toggleHtml + html;

        // 아코디언 접기/펼치기 상태 복원
        if (Object.keys(collapseStates).length > 0) {
            Object.keys(collapseStates).forEach(function(id) {
                var el = document.getElementById(id);
                if (el) {
                    if (!collapseStates[id]) {
                        // 이전에 접혀있었으면 접기
                        el.classList.remove('show');
                        // aria-expanded도 동기화
                        var trigger = contentEl.querySelector('[data-collapse-target="#' + id + '"]');
                        if (trigger) trigger.setAttribute('aria-expanded', 'false');
                    }
                }
            });
        }

        // 배치 삭제 툴바 이벤트 바인딩 (flat/grouped 뷰 공통 동작)
        var selectAllCb = document.getElementById('project-select-all');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', function() {
                var cbs = document.querySelectorAll('#project-tasks-content .project-task-checkbox');
                cbs.forEach(function(cb) { cb.checked = selectAllCb.checked; });
                updateProjectSelectedCount();
            });
        }
        var batchDeleteBtn = document.getElementById('project-batch-delete-btn');
        if (batchDeleteBtn) {
            batchDeleteBtn.addEventListener('click', function() {
                batchDeleteSelectedProjectTasks(projectId);
            });
        }

        // SortableJS 초기화 (멤버별 뷰에서만)
        if (projectTaskViewMode === 'grouped') {
            initProjectTaskDragDrop(projectId);
        }

        // 멤버별 전체선택 + 삭제 버튼 이벤트 바인딩 (grouped 뷰에서만)
        if (projectTaskViewMode === 'grouped') {
            document.querySelectorAll('.member-select-all-cb').forEach(function(cb) {
                cb.addEventListener('change', function() {
                    var key = this.getAttribute('data-member-key');
                    var memberCbs = document.querySelectorAll(
                        '#project-tasks-content .project-task-checkbox[data-member-key="' + key + '"]');
                    memberCbs.forEach(function(c) { c.checked = cb.checked; });
                    updateProjectSelectedCount();
                });
            });
            document.querySelectorAll('[id^="member-batch-delete-btn-"]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var key = btn.getAttribute('data-member-key');
                    batchDeleteSelectedProjectTasks(projectId, key);
                });
            });
        }

        // 담당자 태스크 착수일 flatpickr 초기화 (멤버별 뷰에서만)
        if (projectTaskViewMode === 'grouped') {
            await initProjectTaskQueueStartDates(projectId);
            // 아코디언 헤더 클릭 이벤트 (interactive 요소 제외)
            document.querySelectorAll('.assignee-collapse-header').forEach(function(header) {
                header.addEventListener('click', function(e) {
                    var tag = e.target.tagName.toLowerCase();
                    if (tag === 'input' || tag === 'button' || tag === 'select' || tag === 'textarea'
                        || e.target.closest('button') || e.target.closest('input')) return;
                    var targetSel = header.getAttribute('data-collapse-target');
                    if (!targetSel) return;
                    var collapseEl = document.querySelector(targetSel);
                    if (!collapseEl) return;
                    var bsCollapse = bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false });
                    if (collapseEl.classList.contains('show')) {
                        bsCollapse.hide();
                        header.setAttribute('aria-expanded', 'false');
                    } else {
                        bsCollapse.show();
                        header.setAttribute('aria-expanded', 'true');
                    }
                });
            });
        }
    } catch (e) {
        console.error('프로젝트 태스크 로드 실패:', e);
        contentEl.innerHTML = '<div class="text-center text-muted">태스크를 불러올 수 없습니다.</div>';
    }
}

/**
 * 프로젝트 태스크 뷰 모드 전환
 */
function switchProjectTaskView(mode, projectId) {
    projectTaskViewMode = mode;
    loadProjectTasks(projectId);
}

/**
 * 프로젝트 태스크 상태 필터 적용
 * allTasks에서 현재 projectTaskStatusFilter에 해당하는 태스크만 반환
 */
function applyProjectStatusFilter(tasks) {
    if (projectTaskStatusFilter.length === 0) return tasks;
    return tasks.filter(function(t) { return projectTaskStatusFilter.indexOf(t.status) !== -1; });
}

/**
 * 프로젝트 태스크 상태 필터 토글 (복수 선택)
 */
function toggleProjectStatusFilter(status, projectId) {
    var idx = projectTaskStatusFilter.indexOf(status);
    if (idx !== -1) {
        projectTaskStatusFilter.splice(idx, 1);
    } else {
        projectTaskStatusFilter.push(status);
    }
    loadProjectTasks(projectId);
}

function clearProjectStatusFilter(projectId) {
    projectTaskStatusFilter = [];
    loadProjectTasks(projectId);
}

/**
 * 스케줄 태스크 상태 필터 적용
 */
function applyScheduleStatusFilter(tasks) {
    if (scheduleTaskStatusFilter.length === 0) return tasks;
    return tasks.filter(function(t) { return scheduleTaskStatusFilter.indexOf(t.status) !== -1; });
}

/**
 * 스케줄 태스크 상태 필터 토글 (복수 선택)
 */
function toggleScheduleStatusFilter(status) {
    var idx = scheduleTaskStatusFilter.indexOf(status);
    if (idx !== -1) {
        scheduleTaskStatusFilter.splice(idx, 1);
    } else {
        scheduleTaskStatusFilter.push(status);
    }
    if (currentScheduleMemberId) {
        selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
    }
}

function clearScheduleStatusFilter() {
    scheduleTaskStatusFilter = [];
    if (currentScheduleMemberId) {
        selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
    }
}

/**
 * 프로젝트 태스크 탭: 담당자별 태스크 착수일 flatpickr + 저장 버튼 초기화
 */
async function initProjectTaskQueueStartDates(projectId) {
    await loadHolidayDatesCache();
    var holidays = cachedHolidayDates || {};

    var dateInputs = document.querySelectorAll('.project-task-queue-start-date');
    for (var i = 0; i < dateInputs.length; i++) {
        var el = dateInputs[i];
        var memberId = el.getAttribute('data-member-id');
        var memberLeaves = await loadMemberLeaveDatesCache(parseInt(memberId));
        if (el._flatpickr) el._flatpickr.destroy();
        flatpickr(el, {
            dateFormat: 'Y-m-d',
            locale: 'ko',
            allowInput: true,
            disable: [
                (function(h, ml) {
                    return function(date) {
                        var day = date.getDay();
                        if (day === 0 || day === 6) return true;
                        var y = date.getFullYear();
                        var m = String(date.getMonth() + 1).padStart(2, '0');
                        var d = String(date.getDate()).padStart(2, '0');
                        var dateStr = y + '-' + m + '-' + d;
                        if (h[dateStr]) return true;
                        if (ml[dateStr]) return true;
                        return false;
                    };
                })(holidays, memberLeaves)
            ],
            onChange: (function(mid, mname, pid) {
                return async function(selectedDates, dateStr) {
                    if (dateStr !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
                    try {
                        var res = await apiCall('/api/v1/members/' + mid + '/queue-start-date', 'PATCH',
                            { queueStartDate: dateStr || null });
                        if (res.success) {
                            showToast(mname + '님의 착수일이 저장되었습니다.', 'success');
                            await loadProjectTasks(pid);
                        } else {
                            showToast(res.message || '저장에 실패했습니다.', 'error');
                        }
                    } catch (e) {
                        console.error('착수일 자동 저장 실패:', e);
                        showToast('착수일 저장에 실패했습니다.', 'error');
                    }
                };
            })(memberId, el.getAttribute('data-member-name') || memberId, projectId)
        });
    }

    // 비가용일 조회 버튼 이벤트 바인딩 (XSS 방지: data-attribute + addEventListener)
    var unavailBtns = document.querySelectorAll('.project-task-unavailable-btn');
    unavailBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var memberId = parseInt(btn.getAttribute('data-member-id'));
            var memberName = btn.getAttribute('data-member-name');
            showUnavailableDatesPopup(memberId, memberName);
        });
    });

    // 일정 최적화 버튼 이벤트 바인딩
    var recalcBtns = document.querySelectorAll('.project-task-queue-start-recalculate');
    recalcBtns.forEach(function(btn) {
        btn.addEventListener('click', async function() {
            var memberId = btn.getAttribute('data-member-id');
            var memberName = btn.getAttribute('data-member-name');
            try {
                var res = await apiCall('/api/v1/members/' + memberId + '/recalculate-queue', 'POST');
                if (res.success) {
                    showToast(memberName + '님의 TODO 태스크 일정이 최적화되었습니다.', 'success');
                    await loadProjectTasks(projectId);
                } else {
                    showToast(res.message || '최적화에 실패했습니다.', 'error');
                }
            } catch (e) {
                showToast('일정 최적화에 실패했습니다.', 'error');
            }
        });
    });
}

/**
 * 프로젝트 태스크 선택 개수 카운터 업데이트
 */
function updateProjectSelectedCount() {
    if (projectTaskViewMode === 'flat') {
        // 기존 전역 카운터 로직 유지
        var checked = document.querySelectorAll('#project-tasks-content .project-task-checkbox:checked');
        var countEl = document.getElementById('project-selected-count');
        var deleteBtn = document.getElementById('project-batch-delete-btn');
        if (countEl) countEl.textContent = checked.length;
        if (deleteBtn) deleteBtn.disabled = (checked.length === 0);
        var allCbs = document.querySelectorAll('#project-tasks-content .project-task-checkbox');
        var selectAllCb = document.getElementById('project-select-all');
        if (selectAllCb) {
            selectAllCb.checked = allCbs.length > 0 && checked.length === allCbs.length;
        }
    } else {
        // grouped 뷰: 멤버별 카운터 업데이트
        document.querySelectorAll('.member-select-all-cb').forEach(function(cb) {
            var key = cb.getAttribute('data-member-key');
            var memberCbs = document.querySelectorAll(
                '#project-tasks-content .project-task-checkbox[data-member-key="' + key + '"]');
            var memberChecked = document.querySelectorAll(
                '#project-tasks-content .project-task-checkbox[data-member-key="' + key + '"]:checked');
            var countEl = document.getElementById('member-selected-count-' + key);
            var deleteBtn = document.getElementById('member-batch-delete-btn-' + key);
            if (countEl) countEl.textContent = memberChecked.length;
            if (deleteBtn) deleteBtn.disabled = (memberChecked.length === 0);
            // indeterminate 처리
            if (memberCbs.length === 0) {
                cb.checked = false;
                cb.indeterminate = false;
            } else if (memberChecked.length === 0) {
                cb.checked = false;
                cb.indeterminate = false;
            } else if (memberChecked.length === memberCbs.length) {
                cb.checked = true;
                cb.indeterminate = false;
            } else {
                cb.checked = false;
                cb.indeterminate = true;
            }
        });
    }
}

/**
 * 프로젝트 태스크 선택 삭제
 */
var projectBatchDeleteInProgress = false;
async function batchDeleteSelectedProjectTasks(projectId, memberKey) {
    if (projectBatchDeleteInProgress) return;
    var selector = '#project-tasks-content .project-task-checkbox:checked';
    // grouped 뷰 멤버별 삭제 버튼에서 호출 시 해당 멤버 체크박스만 대상
    if (memberKey != null) {
        selector = '#project-tasks-content .project-task-checkbox[data-member-key="'
            + memberKey + '"]:checked';
    }
    var checked = document.querySelectorAll(selector);
    if (checked.length === 0) return;
    if (!confirmAction(checked.length + '개 태스크를 삭제하시겠습니까?')) return;
    projectBatchDeleteInProgress = true;
    var taskIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    try {
        var res = await apiCall('/api/v1/tasks/batch-delete', 'POST', { taskIds: taskIds });
        if (res.success) {
            showToast(res.deleted + '개 태스크가 삭제되었습니다.', 'success');
            await loadProjectTasks(projectId);
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        showToast('태스크 삭제에 실패했습니다.', 'error');
    } finally {
        projectBatchDeleteInProgress = false;
    }
}

/**
 * 프로젝트 태스크 아이템 HTML 렌더링
 */
function renderProjectTaskItem(t, orderNum, projectId, draggable, showAssignee) {
    var borderColor = (orderNum != null) ? '#0d6efd' : '#ffc107';
    var html = '<div class="schedule-task-item d-flex align-items-center" data-task-id="' + t.id + '"'
        + ' onclick="showTaskModal(' + t.id + ', ' + projectId + ')"'
        + (orderNum == null && draggable ? ' style="border-left:3px solid ' + borderColor + ';"' : '')
        + '>';
    // 비활성 태스크(HOLD/CANCELLED)는 data-member-key="inactive",
    // 그 외는 assignee.id 또는 'unassigned'
    var memberKey = (t.status === 'HOLD' || t.status === 'CANCELLED')
        ? 'inactive'
        : (t.assignee && t.assignee.id ? t.assignee.id : 'unassigned');
    html += '<input type="checkbox" class="project-task-checkbox me-1" value="' + t.id + '" '
        + 'data-member-key="' + memberKey + '" '
        + 'onclick="event.stopPropagation(); updateProjectSelectedCount();">';
    if (draggable) {
        html += '<i class="bi bi-grip-vertical drag-handle cursor-pointer me-2" title="드래그하여 순서 변경"></i>';
    }
    if (orderNum != null) {
        html += '<span class="schedule-task-order">' + orderNum + '</span>';
    }
    html += '<div class="flex-grow-1">';
    html += '<div><strong>' + escapeHtml(t.name) + '</strong>';
    if (t._domainSystemName) {
        html += ' <span class="text-muted" style="font-size:0.78rem;">(' + escapeHtml(t._domainSystemName) + ')</span>';
    }
    html += '</div>';
    html += '<div class="text-muted" style="font-size:0.78rem;">';
    if (showAssignee && t.assignee && t.assignee.name) {
        html += escapeHtml(t.assignee.name) + ' | ';
    }
    html += formatDateWithDay(t.startDate) + ' ~ ' + formatDateWithDay(t.endDate) + ' | ' + (t.manDays || 0) + ' MD';
    html += '</div>';
    html += '</div>';
    html += '<div class="ms-2 d-flex align-items-center gap-1">';
    if (t.jiraKey && cachedJiraBaseUrl && isSafeUrl(cachedJiraBaseUrl)) {
        html += '<a href="' + escapeHtml(cachedJiraBaseUrl) + '/browse/' + escapeHtml(t.jiraKey) + '" target="_blank" rel="noopener noreferrer"'
            + ' class="badge bg-info text-decoration-none" title="Jira 티켓 보기"'
            + ' onclick="event.stopPropagation();">'
            + '<i class="bi bi-link-45deg"></i> ' + escapeHtml(t.jiraKey) + '</a>';
    } else if (t.jiraKey) {
        html += '<span class="badge bg-info"><i class="bi bi-link-45deg"></i> ' + escapeHtml(t.jiraKey) + '</span>';
    }
    html += statusBadge(t.status);
    html += '</div>';
    html += '</div>';
    return html;
}

/**
 * 프로젝트 태스크 드래그 & 드롭 초기화
 */
function initProjectTaskDragDrop(projectId) {
    if (typeof Sortable === 'undefined') return;

    var assigneeIds = [];
    var orderedContainers = document.querySelectorAll('#project-tasks-content .project-task-queue');
    var unorderedContainers = document.querySelectorAll('#project-tasks-content .project-task-unordered');

    orderedContainers.forEach(function(container) {
        var assigneeId = container.getAttribute('data-assignee-id');
        if (assigneeIds.indexOf(assigneeId) < 0) assigneeIds.push(assigneeId);

        new Sortable(container, {
            group: 'project-queue-' + assigneeId,
            handle: '.drag-handle',
            filter: 'input[type="checkbox"]',
            preventOnFilter: false,
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: function() { onProjectTaskDragEnd(assigneeId, projectId); }
        });
    });

    unorderedContainers.forEach(function(container) {
        var assigneeId = container.getAttribute('data-assignee-id');

        new Sortable(container, {
            group: 'project-queue-' + assigneeId,
            handle: '.drag-handle',
            filter: 'input[type="checkbox"]',
            preventOnFilter: false,
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: function() { onProjectTaskDragEnd(assigneeId, projectId); }
        });
    });
}

/**
 * 프로젝트 태스크 드래그 완료 핸들러
 */
async function onProjectTaskDragEnd(assigneeId, projectId) {
    var orderedContainer = document.querySelector('#project-tasks-content .project-task-queue[data-assignee-id="' + assigneeId + '"]');
    if (!orderedContainer) return;
    var items = orderedContainer.querySelectorAll('.schedule-task-item[data-task-id]');
    var taskIds = [];
    items.forEach(function(item) {
        taskIds.push(parseInt(item.getAttribute('data-task-id')));
    });
    if (taskIds.length === 0) return;

    try {
        var body = { assigneeId: parseInt(assigneeId), taskIds: taskIds };
        var res = await apiCall('/api/v1/tasks/assignee-order', 'PATCH', body);
        if (res.success) {
            showToast('태스크 순서가 변경되었습니다.', 'success');
        } else {
            showToast(res.message || '순서 변경에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('태스크 순서 변경 실패:', e);
        showToast('태스크 순서 변경에 실패했습니다.', 'error');
    }
    // 새로고침
    await loadProjectTasks(projectId);
}

// ---- 프로젝트 링크 ----

async function loadProjectLinks() {
    var projectId = currentDetailProjectId;
    if (!projectId) return;
    var listEl = document.getElementById('project-links-list');
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/links');
        var links = (res.success && res.data) ? res.data : [];
        if (links.length === 0) {
            listEl.innerHTML = '<div class="text-center text-muted p-3">등록된 링크가 없습니다.</div>';
            return;
        }
        var html = '<div class="list-group">';
        links.forEach(function(l) {
            html += '<div class="list-group-item d-flex align-items-center" id="proj-link-row-' + l.id + '">';
            html += '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer" class="flex-grow-1 text-decoration-none">';
            html += '<i class="bi bi-link-45deg me-1"></i> <strong>' + escapeHtml(l.label) + '</strong>';
            html += ' <small class="text-muted">' + escapeHtml(l.url) + '</small>';
            html += '</a>';
            html += '<button class="btn btn-outline-secondary btn-sm ms-2" style="padding:0 4px; font-size:0.7rem;" onclick="editProjectLinkInline(' + projectId + ',' + l.id + ',\'' + escapeJsString(l.label) + '\',\'' + escapeJsString(l.url) + '\')" title="수정"><i class="bi bi-pencil"></i></button>';
            html += '<button class="btn btn-outline-danger btn-sm ms-1" style="padding:0 4px; font-size:0.7rem;" onclick="deleteProjectLink(' + projectId + ',' + l.id + ')"><i class="bi bi-x-lg"></i></button>';
            html += '</div>';
        });
        html += '</div>';
        listEl.innerHTML = html;
    } catch (e) {
        listEl.innerHTML = '<div class="text-center text-danger p-3">링크를 불러올 수 없습니다.</div>';
    }
}

async function addProjectLink() {
    var projectId = currentDetailProjectId;
    if (!projectId) return;
    var label = document.getElementById('proj-link-label').value.trim();
    var url = document.getElementById('proj-link-url').value.trim();
    if (!label || !url) {
        showToast('이름과 주소를 모두 입력하세요.', 'warning');
        return;
    }
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/links', 'POST', { label: label, url: url });
        if (res.success) {
            document.getElementById('proj-link-label').value = '';
            document.getElementById('proj-link-url').value = '';
            loadProjectLinks();
            showToast('링크가 추가되었습니다.', 'success');
        } else {
            showToast(res.message || '링크 추가 실패', 'error');
        }
    } catch (e) {
        showToast('링크 추가 실패', 'error');
    }
}

function editProjectLinkInline(projectId, linkId, label, url) {
    var row = document.getElementById('proj-link-row-' + linkId);
    if (!row) return;
    row.innerHTML = '<div class="d-flex align-items-center gap-1 w-100">'
        + '<input type="text" class="form-control form-control-sm" id="edit-link-label-' + linkId + '" value="' + escapeHtml(label) + '" style="width:150px;">'
        + '<input type="url" class="form-control form-control-sm flex-grow-1" id="edit-link-url-' + linkId + '" value="' + escapeHtml(url) + '">'
        + '<button class="btn btn-primary btn-sm" style="white-space:nowrap;" onclick="saveProjectLinkEdit(' + projectId + ',' + linkId + ')">저장</button>'
        + '<button class="btn btn-secondary btn-sm" onclick="loadProjectLinks()">취소</button>'
        + '</div>';
    document.getElementById('edit-link-label-' + linkId).focus();
}

async function saveProjectLinkEdit(projectId, linkId) {
    var label = document.getElementById('edit-link-label-' + linkId).value.trim();
    var url = document.getElementById('edit-link-url-' + linkId).value.trim();
    if (!label || !url) { showToast('이름과 주소를 입력하세요.', 'warning'); return; }
    try {
        await apiCall('/api/v1/projects/' + projectId + '/links/' + linkId, 'PUT', { label: label, url: url });
        loadProjectLinks();
        showToast('링크가 수정되었습니다.', 'success');
    } catch (e) { showToast('링크 수정 실패', 'error'); }
}

async function deleteProjectLink(projectId, linkId) {
    if (!confirm('이 링크를 삭제하시겠습니까?')) return;
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/links/' + linkId, 'DELETE');
        if (res.success) {
            loadProjectLinks();
            showToast('링크가 삭제되었습니다.', 'success');
        }
    } catch (e) {
        showToast('링크 삭제 실패', 'error');
    }
}

async function showProjectLinksPopup(projectId, btn, event) {
    event.stopPropagation();
    var existing = document.querySelector('.project-links-popover');
    if (existing) {
        var isSameBtn = existing._triggerBtn === btn;
        existing.remove();
        if (isSameBtn) return;
    }

    var popover = document.createElement('div');
    popover.className = 'project-links-popover';
    popover.style.cssText = 'position:absolute; z-index:1050; background:#fff; border:1px solid #dee2e6; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.15); min-width:280px; max-width:400px; font-size:0.85rem;';
    popover._triggerBtn = btn;
    popover._projectId = projectId;
    popover.innerHTML = '<div class="text-center text-muted p-2">로딩 중...</div>';
    document.body.appendChild(popover);

    var rect = btn.getBoundingClientRect();
    popover.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popover.style.left = (rect.left + window.scrollX + 20) + 'px';

    function closePopover(e) {
        if (!popover.contains(e.target) && e.target !== btn && !e.target.closest('.project-links-popover')) {
            popover.remove();
            document.removeEventListener('click', closePopover);
        }
    }
    setTimeout(function() { document.addEventListener('click', closePopover); }, 0);

    await renderLinksPopoverContent(popover);
}

async function renderLinksPopoverContent(popover) {
    var projectId = popover._projectId;
    var res = await apiCall('/api/v1/projects/' + projectId + '/links');
    var links = (res.success && res.data) ? res.data : [];

    var html = '<div class="p-2 border-bottom bg-light d-flex align-items-center" style="border-radius:6px 6px 0 0;">';
    html += '<strong class="me-auto">링크</strong>';
    html += '<button class="btn btn-sm p-0 border-0 text-primary" onclick="event.stopPropagation(); toggleLinksPopupAddForm(this)" title="추가"><i class="bi bi-plus-lg"></i></button>';
    html += '</div>';

    // 추가 폼 (숨김)
    html += '<div class="links-popup-add-form p-2 border-bottom" style="display:none;">';
    html += '<input type="text" class="form-control form-control-sm mb-1 links-popup-label" placeholder="이름" style="font-size:0.8rem;">';
    html += '<input type="url" class="form-control form-control-sm mb-1 links-popup-url" placeholder="https://..." style="font-size:0.8rem;">';
    html += '<button class="btn btn-primary btn-sm w-100" style="font-size:0.8rem;" onclick="event.stopPropagation(); saveLinksPopupLink(this)">추가</button>';
    html += '</div>';

    // 링크 목록
    html += '<div class="links-popup-list" style="max-height:250px; overflow-y:auto;">';
    if (links.length === 0) {
        html += '<div class="text-center text-muted p-2">링크가 없습니다.</div>';
    } else {
        links.forEach(function(l) {
            html += '<div class="d-flex align-items-center px-2 py-1 links-popup-item" data-link-id="' + l.id + '" style="gap:4px;">';
            html += '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener noreferrer" class="flex-grow-1 text-decoration-none text-truncate" style="color:#333; font-size:0.82rem;" title="' + escapeHtml(l.url) + '">';
            html += '<i class="bi bi-link-45deg"></i> ' + escapeHtml(l.label);
            html += '</a>';
            html += '<button class="btn btn-sm p-0 border-0 text-secondary" onclick="event.stopPropagation(); editLinksPopupLink(this,' + l.id + ',\'' + escapeJsString(escapeHtml(l.label)) + '\',\'' + escapeJsString(escapeHtml(l.url)) + '\')" title="수정"><i class="bi bi-pencil" style="font-size:0.7rem;"></i></button>';
            html += '<button class="btn btn-sm p-0 border-0 text-danger" onclick="event.stopPropagation(); deleteLinksPopupLink(this,' + l.id + ')" title="삭제"><i class="bi bi-x-lg" style="font-size:0.7rem;"></i></button>';
            html += '</div>';
        });
    }
    html += '</div>';
    popover.innerHTML = html;
}

function toggleLinksPopupAddForm(btn) {
    var popover = btn.closest('.project-links-popover');
    var form = popover.querySelector('.links-popup-add-form');
    form.style.display = form.style.display === 'none' ? '' : 'none';
    if (form.style.display !== 'none') {
        form.querySelector('.links-popup-label').focus();
    }
}

async function saveLinksPopupLink(btn) {
    var popover = btn.closest('.project-links-popover');
    var label = popover.querySelector('.links-popup-label').value.trim();
    var url = popover.querySelector('.links-popup-url').value.trim();
    if (!label || !url) { showToast('이름과 주소를 입력하세요.', 'warning'); return; }
    var projectId = popover._projectId;
    var editId = popover._editLinkId;

    if (editId) {
        await apiCall('/api/v1/projects/' + projectId + '/links/' + editId, 'PUT', { label: label, url: url });
        popover._editLinkId = null;
    } else {
        await apiCall('/api/v1/projects/' + projectId + '/links', 'POST', { label: label, url: url });
    }
    await renderLinksPopoverContent(popover);
}

function editLinksPopupLink(btn, linkId, label, url) {
    var popover = btn.closest('.project-links-popover');
    var form = popover.querySelector('.links-popup-add-form');
    form.style.display = '';
    popover.querySelector('.links-popup-label').value = label;
    popover.querySelector('.links-popup-url').value = url;
    popover._editLinkId = linkId;
    popover.querySelector('.links-popup-label').focus();
    var saveBtn = form.querySelector('.btn-primary');
    saveBtn.textContent = '수정';
}

async function deleteLinksPopupLink(btn, linkId) {
    var popover = btn.closest('.project-links-popover');
    var projectId = popover._projectId;
    await apiCall('/api/v1/projects/' + projectId + '/links/' + linkId, 'DELETE');
    await renderLinksPopoverContent(popover);
}

// ---- 프로젝트 멤버 ----

var _projectMemberSort = { field: 'role', asc: true };

async function loadProjectMembers(projectId) {
    var contentEl = document.getElementById('project-members-content');
    try {
        var res = await apiCall('/api/v1/projects/' + projectId);
        if (!res.success || !res.data) {
            contentEl.innerHTML = '<div class="text-center text-muted">정보를 불러올 수 없습니다.</div>';
            return;
        }
        var members = res.data.members || [];

        // 멤버 추가 버튼
        var html = '<div class="d-flex align-items-center gap-2 mb-2">';
        html += '<button class="btn btn-primary btn-sm" onclick="showAddProjectMemberModal(' + projectId + ')"><i class="bi bi-person-plus"></i> 멤버 추가</button>';
        html += '<span class="text-muted" style="font-size:0.8rem;">' + members.length + '명</span>';
        html += '</div>';

        if (members.length === 0) {
            html += '<div class="text-center text-muted p-3">참여자가 없습니다.</div>';
            contentEl.innerHTML = html;
            return;
        }

        // 정렬
        var sf = _projectMemberSort.field;
        var sa = _projectMemberSort.asc;
        var roleOrder = { PM: 0, EM: 1, BE: 2, FE: 3, QA: 4, PLACEHOLDER: 5 };
        members.sort(function(a, b) {
            var va, vb;
            if (sf === 'role') {
                va = roleOrder[a.role] != null ? roleOrder[a.role] : 99;
                vb = roleOrder[b.role] != null ? roleOrder[b.role] : 99;
            } else if (sf === 'name') {
                va = (a.name || '').toLowerCase();
                vb = (b.name || '').toLowerCase();
            } else if (sf === 'email') {
                va = (a.email || '').toLowerCase();
                vb = (b.email || '').toLowerCase();
            }
            if (va < vb) return sa ? -1 : 1;
            if (va > vb) return sa ? 1 : -1;
            return 0;
        });

        function sortIcon(field) {
            if (sf !== field) return '';
            return sa ? ' <i class="bi bi-caret-up-fill" style="font-size:0.7rem;"></i>' : ' <i class="bi bi-caret-down-fill" style="font-size:0.7rem;"></i>';
        }

        html += '<div class="table-responsive"><table class="table table-hover table-sm mb-0">';
        html += '<thead><tr>';
        html += '<th class="sortable-header" onclick="sortProjectMembers(\'name\',' + projectId + ')">이름' + sortIcon('name') + '</th>';
        html += '<th class="sortable-header" onclick="sortProjectMembers(\'role\',' + projectId + ')">역할' + sortIcon('role') + '</th>';
        html += '<th class="sortable-header" onclick="sortProjectMembers(\'email\',' + projectId + ')">이메일' + sortIcon('email') + '</th>';
        html += '<th>캐파</th><th style="width:50px;"></th>';
        html += '</tr></thead>';
        html += '<tbody>';
        members.forEach(function(m) {
            html += '<tr>';
            html += '<td>' + escapeHtml(m.name) + '</td>';
            html += '<td>' + roleBadge(m.role) + '</td>';
            html += '<td>' + escapeHtml(m.email || '-') + '</td>';
            html += '<td>' + (m.capacity != null ? m.capacity : '1.0') + '</td>';
            html += '<td><button class="btn btn-outline-danger btn-sm" style="padding:0 4px; font-size:0.7rem;" onclick="removeProjectMember(' + projectId + ',' + m.id + ',\'' + escapeJsString(escapeHtml(m.name)) + '\')"><i class="bi bi-x-lg"></i></button></td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        contentEl.innerHTML = html;
    } catch (e) {
        console.error('프로젝트 참여자 로드 실패:', e);
        contentEl.innerHTML = '<div class="text-center text-muted">참여자를 불러올 수 없습니다.</div>';
    }
}

function sortProjectMembers(field, projectId) {
    if (_projectMemberSort.field === field) {
        _projectMemberSort.asc = !_projectMemberSort.asc;
    } else {
        _projectMemberSort.field = field;
        _projectMemberSort.asc = true;
    }
    loadProjectMembers(projectId);
}

async function removeProjectMember(projectId, memberId, memberName) {
    if (!confirm(memberName + ' 멤버를 프로젝트에서 제거하시겠습니까?')) return;
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/members/' + memberId, 'DELETE');
        if (res.success) {
            showToast(memberName + ' 멤버가 제거되었습니다.', 'success');
            loadProjectMembers(projectId);
        } else {
            showToast(res.message || '멤버 제거에 실패했습니다.', 'error');
        }
    } catch (e) {
        showToast('멤버 제거에 실패했습니다.', 'error');
    }
}

async function showAddProjectMemberModal(projectId) {
    // 현재 프로젝트 멤버 ID 목록
    var projRes = await apiCall('/api/v1/projects/' + projectId);
    var currentMemberIds = [];
    if (projRes.success && projRes.data && projRes.data.members) {
        currentMemberIds = projRes.data.members.map(function(m) { return m.id; });
    }
    // 전체 멤버 목록
    var allRes = await apiCall('/api/v1/members');
    var allMembers = (allRes.success && allRes.data) ? allRes.data : [];
    // 프로젝트에 아직 없는 멤버만
    var available = allMembers.filter(function(m) { return currentMemberIds.indexOf(m.id) < 0; });

    var listEl = document.getElementById('add-project-member-list');
    if (available.length === 0) {
        listEl.innerHTML = '<div class="text-center text-muted py-3">추가 가능한 멤버가 없습니다.</div>';
    } else {
        var roleOrder = { PM: 0, EM: 1, BE: 2, FE: 3, QA: 4, PLACEHOLDER: 5 };
        available.sort(function(a, b) {
            var ra = roleOrder[a.role] != null ? roleOrder[a.role] : 99;
            var rb = roleOrder[b.role] != null ? roleOrder[b.role] : 99;
            if (ra !== rb) return ra - rb;
            return (a.name || '').localeCompare(b.name || '');
        });
        var html = '';
        available.forEach(function(m) {
            html += '<div class="form-check">';
            html += '<input class="form-check-input add-project-member-cb" type="checkbox" value="' + m.id + '" id="add-pm-' + m.id + '">';
            html += '<label class="form-check-label" for="add-pm-' + m.id + '">' + escapeHtml(m.name) + ' ' + roleBadge(m.role) + (m.team ? ' <small class="text-muted">' + escapeHtml(m.team) + '</small>' : '') + '</label>';
            html += '</div>';
        });
        listEl.innerHTML = html;
    }
    document.getElementById('add-project-member-project-id').value = projectId;
    var modal = new bootstrap.Modal(document.getElementById('addProjectMemberModal'));
    modal.show();
}

async function confirmAddProjectMembers() {
    var projectId = parseInt(document.getElementById('add-project-member-project-id').value);
    var checkboxes = document.querySelectorAll('.add-project-member-cb:checked');
    if (checkboxes.length === 0) {
        showToast('추가할 멤버를 선택하세요.', 'warning');
        return;
    }
    var added = 0;
    for (var i = 0; i < checkboxes.length; i++) {
        var memberId = parseInt(checkboxes[i].value);
        var res = await apiCall('/api/v1/projects/' + projectId + '/members', 'POST', { memberId: memberId });
        if (res.success) added++;
    }
    bootstrap.Modal.getInstance(document.getElementById('addProjectMemberModal')).hide();
    showToast(added + '명의 멤버가 추가되었습니다.', 'success');
    loadProjectMembers(projectId);
}

async function showProjectModal(projectId) {
    // 폼 초기화
    document.getElementById('project-id').value = '';
    document.getElementById('project-name').value = '';
    document.getElementById('project-type').value = '';
    document.getElementById('project-description').value = '';
    document.getElementById('project-start-date').value = '';
    document.getElementById('project-end-date').value = '';
    document.getElementById('project-status').value = 'PLANNING';
    document.getElementById('project-jira-board-id').value = '';
    document.getElementById('project-jira-epic-key').value = '';
    document.getElementById('project-total-md-override').value = '';
    document.getElementById('project-ppl').value = '';
    document.getElementById('project-epl').value = '';
    document.getElementById('project-quarter').value = '';
    document.getElementById('project-delay-warning').style.display = 'none';
    document.getElementById('project-delay-warning').innerHTML = '';

    // 도메인시스템/프로젝트 유형/멤버 병렬 로드
    var checklistResults = await Promise.all([
        apiCall('/api/v1/domain-systems'),
        apiCall('/api/v1/projects/types'),
        apiCall('/api/v1/members')
    ]);
    var dsRes = checklistResults[0];
    var typesRes = checklistResults[1];
    var membersRes = checklistResults[2];

    // datalist 채우기
    if (typesRes.success && typesRes.data) {
        var datalist = document.getElementById('project-type-list');
        datalist.innerHTML = typesRes.data.map(function(t) {
            return '<option value="' + escapeHtml(t) + '">';
        }).join('');
    }
    // PPL/EPL 멤버 드롭다운 채우기
    var allMembers = (membersRes.success && membersRes.data) ? membersRes.data : [];
    var memberOptHtml = '<option value="">선택 안함</option>';
    allMembers.forEach(function(m) {
        memberOptHtml += '<option value="' + m.id + '">' + escapeHtml(m.name) + ' (' + m.role + ')</option>';
    });
    document.getElementById('project-ppl').innerHTML = memberOptHtml;
    document.getElementById('project-epl').innerHTML = memberOptHtml;

    var allDs = (dsRes.success && dsRes.data) ? dsRes.data : [];

    var currentDs = [];

    if (projectId) {
        document.getElementById('projectModalTitle').textContent = '프로젝트 수정';
        try {
            var res = await apiCall('/api/v1/projects/' + projectId);
            if (res.success && res.data) {
                var p = res.data;
                document.getElementById('project-id').value = p.id;
                document.getElementById('project-name').value = p.name || '';
                document.getElementById('project-type').value = p.projectType || '';
                document.getElementById('project-description').value = p.description || '';
                document.getElementById('project-start-date').value = p.startDate || '';
                document.getElementById('project-end-date').value = p.endDate || '';
                document.getElementById('project-status').value = p.status || 'PLANNING';
                document.getElementById('project-jira-board-id').value = p.jiraBoardId || '';
                document.getElementById('project-jira-epic-key').value = p.jiraEpicKey || '';
                document.getElementById('project-total-md-override').value = p.totalManDaysOverride != null ? p.totalManDaysOverride : '';
                document.getElementById('project-ppl').value = p.pplId || '';
                document.getElementById('project-epl').value = p.eplId || '';
                document.getElementById('project-quarter').value = p.quarter || '';
                currentDs = p.domainSystems ? p.domainSystems.map(function(d) { return d.id; }) : [];

                // 지연 경고 표시
                var delayWarning = document.getElementById('project-delay-warning');
                if (p.isDelayed === true) {
                    delayWarning.innerHTML = '<div class="alert alert-danger mb-0 py-2 px-3" style="font-size:0.85rem;">'
                        + '<i class="bi bi-exclamation-triangle-fill"></i> <strong>지연 경고:</strong> '
                        + '예상 종료일(' + formatDateWithDay(p.expectedEndDate) + ')이 론치일(' + formatDateWithDay(p.endDate) + ')을 초과합니다.'
                        + '</div>';
                    delayWarning.style.display = 'block';
                } else if (p.isDelayed === false) {
                    delayWarning.innerHTML = '<div class="alert alert-success mb-0 py-2 px-3" style="font-size:0.85rem;">'
                        + '<i class="bi bi-check-circle-fill"></i> 예상 종료일(' + formatDateWithDay(p.expectedEndDate) + ')이 론치일 내에 있습니다.'
                        + '</div>';
                    delayWarning.style.display = 'block';
                } else {
                    delayWarning.style.display = 'none';
                }
            }
        } catch (e) {
            showToast('프로젝트 정보를 불러오는데 실패했습니다.', 'error');
            return;
        }
    } else {
        document.getElementById('projectModalTitle').textContent = '프로젝트 추가';
    }

    // 도메인 시스템 체크리스트 렌더링
    var dsHtml = '';
    allDs.forEach(function(ds) {
        var checked = currentDs.indexOf(ds.id) >= 0 ? 'checked' : '';
        dsHtml += '<div class="form-check">';
        dsHtml += '<input class="form-check-input" type="checkbox" value="' + ds.id + '" id="pds-' + ds.id + '" ' + checked + '>';
        dsHtml += '<label class="form-check-label" for="pds-' + ds.id + '">';
        dsHtml += '<span class="color-preview" style="background-color:' + sanitizeColor(ds.color) + ';width:14px;height:14px;"></span>';
        dsHtml += escapeHtml(ds.name);
        dsHtml += '</label>';
        dsHtml += '</div>';
    });
    document.getElementById('project-ds-checklist').innerHTML = dsHtml || '<span class="text-muted">등록된 도메인 시스템이 없습니다.</span>';

    var modal = new bootstrap.Modal(document.getElementById('projectModal'));
    modal.show();
}

async function saveProject() {
    var id = document.getElementById('project-id').value;
    var name = document.getElementById('project-name').value.trim();
    var type = document.getElementById('project-type').value.trim() || null;
    var description = document.getElementById('project-description').value.trim();
    var startDate = document.getElementById('project-start-date').value;
    var endDate = document.getElementById('project-end-date').value;
    var status = document.getElementById('project-status').value;

    if (!name) {
        showToast('프로젝트명을 입력해주세요.', 'warning');
        return;
    }
    // startDate, endDate는 선택사항 (nullable)

    var jiraBoardId = document.getElementById('project-jira-board-id').value.trim() || null;
    var jiraEpicKey = document.getElementById('project-jira-epic-key').value.trim() || null;
    var mdOverrideVal = document.getElementById('project-total-md-override').value;
    var totalManDaysOverride = mdOverrideVal ? parseFloat(mdOverrideVal) : null;
    var pplVal = document.getElementById('project-ppl').value;
    var eplVal = document.getElementById('project-epl').value;

    var body = {
        name: name,
        projectType: type,
        description: description,
        startDate: startDate || null,
        endDate: endDate || null,
        status: status,
        jiraBoardId: jiraBoardId,
        jiraEpicKey: jiraEpicKey,
        totalManDaysOverride: totalManDaysOverride,
        pplId: pplVal ? parseInt(pplVal) : null,
        eplId: eplVal ? parseInt(eplVal) : null,
        quarter: document.getElementById('project-quarter').value.trim() || null
    };

    try {
        var res;
        if (id) {
            res = await apiCall('/api/v1/projects/' + id, 'PUT', body);
        } else {
            res = await apiCall('/api/v1/projects', 'POST', body);
        }

        if (res.success) {
            var projectId = id || (res.data ? res.data.id : null);

            // 도메인 시스템 업데이트
            if (projectId) {
                await updateProjectDomainSystems(projectId);
            }

            showToast(id ? '프로젝트가 수정되었습니다.' : '프로젝트가 추가되었습니다.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('projectModal')).hide();
            loadProjects();
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('프로젝트 저장 실패:', e);
        showToast('프로젝트 저장에 실패했습니다.', 'error');
    }
}

/**
 * 프로젝트 도메인 시스템 업데이트 (체크리스트 기반)
 */
async function updateProjectDomainSystems(projectId) {
    // 현재 프로젝트 도메인 시스템 조회
    var projectRes = await apiCall('/api/v1/projects/' + projectId);
    var currentDs = [];
    if (projectRes.success && projectRes.data && projectRes.data.domainSystems) {
        currentDs = projectRes.data.domainSystems.map(function(d) { return d.id; });
    }

    // 체크된 도메인 시스템 ID 수집
    var selectedDs = [];
    var checkboxes = document.querySelectorAll('#project-ds-checklist input[type="checkbox"]:checked');
    checkboxes.forEach(function(cb) {
        selectedDs.push(parseInt(cb.value));
    });

    // 추가
    for (var i = 0; i < selectedDs.length; i++) {
        if (currentDs.indexOf(selectedDs[i]) < 0) {
            await apiCall('/api/v1/projects/' + projectId + '/domain-systems', 'POST', { domainSystemId: selectedDs[i] });
        }
    }

    // 제거
    for (var j = 0; j < currentDs.length; j++) {
        if (selectedDs.indexOf(currentDs[j]) < 0) {
            await apiCall('/api/v1/projects/' + projectId + '/domain-systems/' + currentDs[j], 'DELETE');
        }
    }
}

async function deleteProject(id) {
    if (!confirmAction('이 프로젝트를 삭제하시겠습니까?\n관련된 모든 태스크도 함께 삭제됩니다.')) return;

    try {
        var res = await apiCall('/api/v1/projects/' + id, 'DELETE');
        if (res.success) {
            showToast('프로젝트가 삭제되었습니다.', 'success');
            loadProjects();
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('프로젝트 삭제 실패:', e);
        showToast('프로젝트 삭제에 실패했습니다.', 'error');
    }
}

// ========================================
// Gantt Chart
// ========================================

/**
 * 간트차트 섹션 초기 로드 (프로젝트 드롭다운 초기화)
 */
async function loadGanttSection() {
    try {
        var res = await apiCall('/api/v1/projects');
        var projects = (res.success && res.data) ? res.data : [];
        var select = document.getElementById('gantt-project-select');
        var currentVal = select.value;
        var optHtml = '<option value="">프로젝트 선택...</option>';
        optHtml += '<option value="all">전체 프로젝트</option>';
        projects.forEach(function(p) {
            optHtml += '<option value="' + p.id + '">' + escapeHtml(p.name) + ' (' + p.status + ')</option>';
        });
        select.innerHTML = optHtml;
        // 이전 선택 유지
        if (currentVal) {
            select.value = currentVal;
        }
        // 프로젝트가 선택되어 있으면 간트 로드
        if (currentProjectId) {
            select.value = currentProjectId;
            if (currentProjectId === 'all') {
                await loadAllProjectsGantt();
            } else {
                await loadGanttData(currentProjectId);
            }
        }
    } catch (e) {
        console.error('간트차트 프로젝트 목록 로드 실패:', e);
    }
}

/**
 * 간트차트 프로젝트 선택 변경
 */
async function onGanttProjectChange(projectId) {
    // hash 업데이트
    _isNavigating = true;
    var ganttHash = projectId ? 'gantt/' + projectId : 'gantt';
    if (window.location.hash !== '#' + ganttHash) {
        window.location.hash = ganttHash;
    }
    _isNavigating = false;

    if (!projectId) {
        currentProjectId = null;
        document.getElementById('gantt-chart').innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>프로젝트를 선택하여 간트차트를 표시하세요.</p></div>';
        document.getElementById('gantt-warnings').style.display = 'none';
        document.getElementById('gantt-milestones-btn').style.display = 'none';
        ganttWarningsCount = 0;
        updateGanttWarningsBtn();
        ganttInstance = null;
        return;
    }
    if (projectId === 'all') {
        currentProjectId = 'all';
        document.getElementById('gantt-warnings').style.display = 'none';
        document.getElementById('gantt-milestones-btn').style.display = 'none';
        ganttWarningsCount = 0;
        updateGanttWarningsBtn();
        await loadAllProjectsGantt();
        return;
    }
    currentProjectId = parseInt(projectId);
    document.getElementById('gantt-milestones-btn').style.display = '';
    await loadGanttData(currentProjectId);
}

/**
 * 간트차트 섹션으로 이동하여 해당 프로젝트 간트 표시
 */
function showGanttChart(projectId) {
    currentProjectId = parseInt(projectId);
    // hash 업데이트 (showSection이 'gantt'로 설정하지만, projectId를 포함해야 함)
    _isNavigating = true;
    if (window.location.hash !== '#gantt/' + projectId) {
        window.location.hash = 'gantt/' + projectId;
    }
    _isNavigating = false;
    showSection('gantt');
}

async function loadGanttData(projectId) {
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/tasks');
        if (res.success && res.data) {
            currentGanttData = res.data;
            renderGantt(res.data);
        } else {
            showToast('간트차트 데이터를 불러오는데 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('간트차트 데이터 로드 실패:', e);
        showToast('간트차트 데이터를 불러오는데 실패했습니다.', 'error');
    }
}

// ---- 프로젝트 상세 간트 탭 ----

var _projGanttInstance = null;
var _projGanttData = null;
var _projGanttViewMode = 'Day';
var _projGanttTimerId = null;

async function loadProjectGanttTab() {
    if (!currentDetailProjectId) return;
    var chartEl = document.getElementById('proj-gantt-chart');
    chartEl.innerHTML = '<div class="text-center text-muted p-3"><div class="spinner-border spinner-border-sm"></div> 로딩 중...</div>';
    try {
        var res = await apiCall('/api/v1/projects/' + currentDetailProjectId + '/tasks');
        if (res.success && res.data) {
            _projGanttData = res.data;
            renderProjectGantt();
        } else {
            chartEl.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>데이터를 불러올 수 없습니다.</p></div>';
        }
    } catch (e) {
        console.error('프로젝트 간트 로드 실패:', e);
        chartEl.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>로드 실패</p></div>';
    }
}

function renderProjectGantt() {
    var chartEl = document.getElementById('proj-gantt-chart');
    if (!_projGanttData) return;

    // 옵션 읽기
    var showJira = document.getElementById('proj-gantt-show-jira-key');
    var showDomain = document.getElementById('proj-gantt-show-domain');
    var savedJira = ganttShowJiraKey;
    var savedDomain = ganttShowDomain;
    ganttShowJiraKey = showJira ? showJira.checked : true;
    ganttShowDomain = showDomain ? showDomain.checked : false;

    var tasks = convertToGanttTasks(_projGanttData);
    var _projBizDaysMap = buildBizDaysMap(tasks);

    // 글로벌 상태 복원
    ganttShowJiraKey = savedJira;
    ganttShowDomain = savedDomain;

    if (tasks.length === 0) {
        chartEl.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>표시할 태스크가 없습니다.</p></div>';
        _projGanttInstance = null;
        return;
    }

    chartEl.innerHTML = '';
    try {
        _projGanttInstance = new Gantt('#proj-gantt-chart', tasks, {
            view_mode: _projGanttViewMode,
            date_format: 'YYYY-MM-DD',
            bar_height: 20,
            bar_corner_radius: 3,
            padding: 8,
            on_click: function(task) {
                if (task._taskId) showTaskModal(task._taskId, currentDetailProjectId);
            },
            on_date_change: function() { loadProjectGanttTab(); }
        });

        if (_projGanttTimerId) { clearTimeout(_projGanttTimerId); _projGanttTimerId = null; }
        _projGanttTimerId = setTimeout(function() {
            _projGanttTimerId = null;
            var svg = chartEl.querySelector('svg');
            if (!svg || !svg.querySelector('.lower-text')) return;

            // 주말 제거 (Day 모드)
            if (_projGanttInstance && _projGanttViewMode === 'Day') {
                removeGanttWeekendsForElement(_projGanttInstance, chartEl, _projBizDaysMap);
            }

            // 드래그 비활성화
            chartEl.querySelectorAll('.bar-wrapper').forEach(function(bar) {
                var clone = bar.cloneNode(true);
                bar.parentNode.replaceChild(clone, bar);
                clone.addEventListener('click', function() {
                    var taskId = clone.getAttribute('data-id');
                    if (taskId && taskId.startsWith('task-')) {
                        showTaskModal(parseInt(taskId.replace('task-', '')), currentDetailProjectId);
                    }
                });
                clone.style.cursor = 'pointer';
            });

            // 마커
            if (_projGanttData.project) {
                // 론치일 세로 가이드선 제거됨
            }

            // sticky 헤더
            var scrollContainer = chartEl.closest('.card-body');
            if (scrollContainer) {
                setupGanttStickyHeader(chartEl);
            }
        }, 150);
    } catch (e) {
        console.error('프로젝트 간트 렌더링 실패:', e);
        chartEl.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>렌더링 실패</p></div>';
    }
}

function reloadProjectGantt() {
    if (_projGanttData) renderProjectGantt();
}

function changeProjectGanttViewMode(mode) {
    _projGanttViewMode = mode;
    var btns = document.querySelectorAll('#proj-gantt-view-mode .btn');
    btns.forEach(function(btn) {
        btn.classList.remove('active');
        if (btn.textContent.trim() === mode) btn.classList.add('active');
    });
    if (_projGanttData) renderProjectGantt();
}

/**
 * 전체 프로젝트 간트차트 로드 — 프로젝트별 개별 차트를 세로로 쌓고 좌우 스크롤 동기화
 */
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
        var _allBizDaysMap = buildBizDaysMap(allTasks);

        // 단일 인스턴스 렌더링
        chartContainer.innerHTML = '';
        try {
            ganttInstance = new Gantt('#gantt-chart', allTasks, {
                view_mode: currentViewMode,
                date_format: 'YYYY-MM-DD',
                bar_height: 20,
                bar_corner_radius: 3,
                padding: 8,
                on_click: function(task) {
                    if (task._taskId) {
                        showTaskModal(task._taskId, task._projectId);
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

        // 이전 후처리 타이머 취소
        if (_ganttRenderTimerId) {
            clearTimeout(_ganttRenderTimerId);
            _ganttRenderTimerId = null;
        }

        _ganttRenderTimerId = setTimeout(function() {
            _ganttRenderTimerId = null;

            var svg = chartContainer.querySelector('svg');
            if (!svg || !svg.querySelector('.lower-text')) return;

            // 주말 제거 (Day 모드)
            ganttWeekendsRemoved = false;
            if (ganttInstance && currentViewMode === 'Day') {
                removeGanttWeekendsForElement(ganttInstance, chartContainer, _allBizDaysMap);
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
                        showTaskModal(id, found ? found._projectId : null);
                    }
                });
                clone.style.cursor = 'pointer';
            });

            // sticky 헤더 설정
            setupGanttStickyHeader(chartContainer);
        }, 150);

    } catch (e) {
        console.error('전체 프로젝트 간트 로드 실패:', e);
        chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>전체 프로젝트 간트차트 로딩에 실패했습니다.</p></div>';
    }
}

/**
 * 특정 요소 내 간트차트에 오늘 마커 삽입
 */
function addGanttTodayMarkerForElement(chartEl) {
    try {
        var svg = chartEl.querySelector('svg');
        if (!svg) return;
        var existing = svg.querySelectorAll('.gantt-today-marker-group');
        existing.forEach(function(el) { el.remove(); });

        var todayEl = svg.querySelector('.today-highlight');
        if (todayEl) {
            var rect = todayEl.getBoundingClientRect();
            var svgRect = svg.getBoundingClientRect();
            var x = rect.left - svgRect.left + rect.width / 2;
            var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'gantt-today-marker-group');
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x);
            line.setAttribute('x2', x);
            line.setAttribute('y1', 0);
            line.setAttribute('y2', svg.getAttribute('height') || '500');
            line.setAttribute('class', 'gantt-today-marker');
            g.appendChild(line);
            svg.appendChild(g);
        }
    } catch (e) {
        console.error('오늘 마커 삽입 실패:', e);
    }
}

/**
 * 특정 요소 내 간트차트에 론치일 마커 삽입
 */
function addGanttDeadlineMarkerForElement(project, inst, chartEl) {
    try {
        if (!project || !project.endDate) return;
        var svg = chartEl.querySelector('svg');
        if (!svg || !inst) return;

        var existing = svg.querySelectorAll('.gantt-deadline-marker-group');
        existing.forEach(function(el) { el.remove(); });

        var lowerTexts = svg.querySelectorAll('.lower-text');
        if (lowerTexts.length < 2) return;
        var x0 = parseFloat(lowerTexts[0].getAttribute('x'));
        var x1 = parseFloat(lowerTexts[1].getAttribute('x'));
        var colWidth = x1 - x0;
        if (colWidth <= 0) return;

        var todayHighlight = svg.querySelector('.today-highlight');
        if (!todayHighlight) return;
        var todayX = parseFloat(todayHighlight.getAttribute('x'));
        var todayWidth = parseFloat(todayHighlight.getAttribute('width'));
        var todayCenterX = todayX + todayWidth / 2;

        var today = new Date(); today.setHours(0,0,0,0);
        var endDateDate = new Date(project.endDate + 'T00:00:00');
        var weekendsRemoved = chartEl.getAttribute('data-weekends-removed') === 'true';
        var diffDays;
        if (weekendsRemoved) {
            diffDays = countBusinessDaysBetween(today, endDateDate);
        } else {
            diffDays = Math.round((endDateDate - today) / (1000 * 60 * 60 * 24));
        }

        var dayPixels = colWidth;
        if (currentViewMode === 'Week') dayPixels = colWidth / 7;
        else if (currentViewMode === 'Month') dayPixels = colWidth / 30;

        var markerX = todayCenterX + (diffDays * dayPixels);
        var svgWidth = parseFloat(svg.getAttribute('width') || svg.getBoundingClientRect().width);
        if (markerX < 0) return;
        if (markerX > svgWidth - 20) {
            var newWidth = markerX + 200;
            svg.setAttribute('width', newWidth);
            svg.setAttribute('viewBox', '0 0 ' + newWidth + ' ' + (svg.getAttribute('height') || 500));
        }

        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'gantt-deadline-marker-group');
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', markerX);
        line.setAttribute('x2', markerX);
        line.setAttribute('y1', 0);
        line.setAttribute('y2', svg.getAttribute('height') || '500');
        line.setAttribute('class', 'gantt-deadline-marker');
        g.appendChild(line);
        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', markerX + 4);
        text.setAttribute('y', 15);
        text.setAttribute('class', 'gantt-deadline-label');
        text.textContent = '론치 ' + formatShortDateWithDay(project.endDate) + ': ' + project.name;
        g.appendChild(text);
        svg.appendChild(g);
    } catch (e) {
        console.error('론치일 마커 삽입 실패:', e);
    }
}

/**
 * 특정 요소 내 간트차트에서 주말 열 제거
 */
function removeGanttWeekendsForElement(inst, chartEl, bizDaysMap) {
    if (!inst) return;
    // 프로젝트 탭 간트는 _projGanttViewMode 사용, 독립 간트는 currentViewMode 사용
    var viewMode = (chartEl.id === 'proj-gantt-chart') ? _projGanttViewMode : currentViewMode;
    if (viewMode !== 'Day') return;
    var svg = chartEl.querySelector('svg');
    if (!svg) return;

    var dates = inst.dates;
    if (!dates || dates.length < 2) return;

    var lowerTexts = Array.from(svg.querySelectorAll('.lower-text'));
    if (lowerTexts.length < 2) return;
    var colWidth = parseFloat(lowerTexts[1].getAttribute('x')) - parseFloat(lowerTexts[0].getAttribute('x'));
    if (!colWidth || colWidth <= 0) return;

    var gridOffsetX = parseFloat(lowerTexts[0].getAttribute('x')) - colWidth / 2;

    var isWeekend = [];
    var weekendCount = 0;
    for (var i = 0; i < dates.length; i++) {
        var day = dates[i].getDay();
        var isWE = (day === 0 || day === 6);
        isWeekend.push(isWE);
        if (isWE) weekendCount++;
    }
    if (weekendCount === 0) return;

    var offset = [];
    var cumul = 0;
    for (var i = 0; i < dates.length; i++) {
        if (isWeekend[i]) cumul += colWidth;
        offset.push(cumul);
    }
    var totalRemoved = cumul;

    // shiftForCol/shiftForX — removeGanttWeekends와 동일한 로직
    function shiftForCol(col) {
        if (col <= 0) return 0;
        return offset[Math.min(col - 1, dates.length - 1)];
    }
    function shiftForX(x) {
        var col = Math.floor((x - gridOffsetX) / colWidth);
        return shiftForCol(Math.max(0, col));
    }

    // 1. lower-text: 주말 제거, 평일 이동
    for (var i = 0; i < lowerTexts.length && i < dates.length; i++) {
        if (isWeekend[i]) {
            lowerTexts[i].remove();
        } else {
            var x = parseFloat(lowerTexts[i].getAttribute('x'));
            lowerTexts[i].setAttribute('x', x - shiftForCol(i));
        }
    }

    // 2. upper-text
    svg.querySelectorAll('.upper-text').forEach(function(el) {
        var x = parseFloat(el.getAttribute('x'));
        el.setAttribute('x', x - shiftForX(x));
    });

    // 3. grid ticks
    svg.querySelectorAll('.tick').forEach(function(el) {
        if (el.tagName === 'line' || el.tagName === 'LINE') {
            var x = parseFloat(el.getAttribute('x1'));
            var newX = x - shiftForX(x);
            el.setAttribute('x1', newX);
            el.setAttribute('x2', newX);
        }
    });

    // 4. today-highlight
    var todayHL = svg.querySelector('.today-highlight');
    if (todayHL) {
        var x = parseFloat(todayHL.getAttribute('x'));
        todayHL.setAttribute('x', x - shiftForX(x));
    }

    // 5. bar 처리 — bizDaysMap이 있으면 정확한 영업일 수 기반, 없으면 shiftForX 기반
    svg.querySelectorAll('.bar-wrapper').forEach(function(bw) {
        var bar = bw.querySelector('.bar');
        var progress = bw.querySelector('.bar-progress');
        var label = bw.querySelector('.bar-label');

        if (bar) {
            var origX = parseFloat(bar.getAttribute('x'));
            var origW = parseFloat(bar.getAttribute('width'));
            var newX = origX - shiftForX(origX);
            var newW;

            // bizDaysMap에서 정확한 영업일 수로 bar 너비 설정
            var taskId = bw.getAttribute('data-id');
            if (bizDaysMap && taskId && bizDaysMap[taskId]) {
                newW = bizDaysMap[taskId] * colWidth;
            } else {
                var newRight = (origX + origW) - shiftForX(origX + origW);
                newW = Math.max(newRight - newX, colWidth * 0.5);
            }

            bar.setAttribute('x', newX);
            bar.setAttribute('width', newW);

            if (progress) {
                var pW = parseFloat(progress.getAttribute('width'));
                var ratio = origW > 0 ? pW / origW : 0;
                progress.setAttribute('x', newX);
                progress.setAttribute('width', newW * ratio);
            }

            if (label) {
                if (label.classList.contains('big')) {
                    label.setAttribute('x', newX + newW + 5);
                } else {
                    label.setAttribute('x', newX + newW / 2);
                }
            }
        }
    });

    // grid-row 너비 줄이기
    var gridRows = svg.querySelectorAll('.grid-row');
    gridRows.forEach(function(row) {
        var rw = parseFloat(row.getAttribute('width'));
        row.setAttribute('width', rw - totalRemoved);
    });

    var gridHeader = svg.querySelector('.grid-header');
    if (gridHeader) {
        var ghw = parseFloat(gridHeader.getAttribute('width'));
        gridHeader.setAttribute('width', ghw - totalRemoved);
    }

    var svgW = parseFloat(svg.getAttribute('width'));
    svg.setAttribute('width', svgW - totalRemoved);

    chartEl.setAttribute('data-weekends-removed', 'true');
}

function buildBizDaysMap(ganttTasks) {
    var map = {};
    ganttTasks.forEach(function(t) { if (t._bizDays) map[t.id] = t._bizDays; });
    return map;
}

function convertToGanttTasks(data, projectName) {
    var tasks = [];
    if (!data) return tasks;

    // 마일스톤을 간트 태스크로 변환 (최상단에 표시)
    if (data.milestones && data.milestones.length > 0) {
        data.milestones.forEach(function(ms) {
            if (!ms.startDate || !ms.endDate) return;
            var msBizDays = calcWorkingDays(ms.startDate, ms.endDate) || 1;
            tasks.push({
                id: 'milestone-' + ms.id,
                name: '▸ ' + ms.name,
                start: ms.startDate,
                end: addDays(ms.endDate, 1),
                progress: 0,
                dependencies: '',
                custom_class: 'bar-milestone bar-milestone-' + ms.name.toLowerCase().replace(/[^a-z가-힣]/g, ''),
                _isMilestone: true,
                _bizDays: msBizDays
            });
        });
    }

    // 론치일을 마일스톤 바로 표시
    if (data.project && data.project.endDate) {
        tasks.push({
            id: 'launch-' + data.project.id,
            name: '▸ 론치 ' + formatShortDateWithDay(data.project.endDate) + ': ' + (data.project.name || projectName || ''),
            start: data.project.endDate,
            end: addDays(data.project.endDate, 1),
            progress: 0,
            dependencies: '',
            custom_class: 'bar-milestone bar-milestone-론치',
            _isMilestone: true,
            _bizDays: 1
        });
    }

    if (!data.domainSystems) return tasks;
    data.domainSystems.forEach(function(ds) {
        if (!ds.tasks || ds.tasks.length === 0) return;
        ds.tasks.forEach(function(task) {
            // HOLD/CANCELLED 제외
            if (task.status === 'HOLD' || task.status === 'CANCELLED') return;
            if (!task.startDate || !task.endDate) return;

            var assigneeName = task.assignee ? task.assignee.name : '미정';
            var assigneeRole = task.assignee ? task.assignee.role : 'BE';
            var manDays = task.manDays || 0;
            var deps = '';
            if (task.dependencies && task.dependencies.length > 0) {
                deps = task.dependencies.map(function(depId) { return 'task-' + depId; }).join(', ');
            }
            var barClass = 'bar-' + assigneeRole.toLowerCase();
            var priorityPrefix = task.priority ? '[' + task.priority + '] ' : '';
            var parallelPrefix = task.executionMode === 'PARALLEL' ? '[P] ' : '';
            var progress = 0;
            if (task.status === 'COMPLETED') progress = 100;
            else if (task.status === 'IN_PROGRESS') progress = 50;

            var namePrefix = projectName ? '[' + projectName + '] ' : '';
            var jiraPrefix = (ganttShowJiraKey && task.jiraKey) ? '[' + task.jiraKey + '] ' : '';
            var domainPart = ganttShowDomain ? '[' + ds.name + '] ' : '';
            var bizDays = calcWorkingDays(task.startDate, task.endDate) || 1;
            tasks.push({
                id: 'task-' + task.id,
                name: parallelPrefix + priorityPrefix + jiraPrefix + namePrefix + domainPart + task.name + ' (' + assigneeName + ', ' + manDays + 'MD, ' + bizDays + '일)',
                start: task.startDate,
                end: addDays(task.endDate, 1),
                progress: progress,
                dependencies: deps,
                custom_class: barClass,
                _taskId: task.id,
                _projectId: data.project ? data.project.id : null,
                _domainSystem: ds.name,
                _domainSystemColor: ds.color,
                _jiraKey: task.jiraKey,
                _bizDays: bizDays
            });
        });
    });
    return tasks;
}

function renderGantt(data) {
    var chartContainer = document.getElementById('gantt-chart');

    var tasks = convertToGanttTasks(data);
    var _ganttBizDaysMap = buildBizDaysMap(tasks);

    if (tasks.length === 0) {
        chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>등록된 태스크가 없습니다.<br>태스크를 추가해주세요.</p></div>';
        ganttInstance = null;
        return;
    }

    // 기존 차트 정리
    chartContainer.innerHTML = '';

    try {
        ganttInstance = new Gantt('#gantt-chart', tasks, {
            view_mode: currentViewMode,
            date_format: 'YYYY-MM-DD',
            bar_height: 20,
            bar_corner_radius: 3,
            padding: 8,
            on_click: function(task) {
                if (task._taskId) {
                    showTaskModal(task._taskId, currentProjectId);
                }
            },
            on_date_change: function(task, start, end) {
                // 드래그 변경 무시 - 다시 렌더링
                loadGanttData(currentProjectId);
            }
        });

        // 이전 후처리 타이머 취소 (연속 렌더링 시 중복 방지)
        if (_ganttRenderTimerId) {
            clearTimeout(_ganttRenderTimerId);
            _ganttRenderTimerId = null;
        }

        // 주말 제거 + 드래그 비활성화 + 마커
        _ganttRenderTimerId = setTimeout(function() {
            _ganttRenderTimerId = null;

            // SVG가 실제로 렌더링되었는지 확인
            var svg = chartContainer.querySelector('svg');
            if (!svg || !svg.querySelector('.lower-text')) return;

            // 1. 주말 열 제거 (Day 모드)
            removeGanttWeekends(_ganttBizDaysMap);

            // 2. 드래그 완전 비활성화: bar의 drag 이벤트 제거
            var bars = document.querySelectorAll('#gantt-chart .bar-wrapper');
            bars.forEach(function(bar) {
                var clone = bar.cloneNode(true);
                bar.parentNode.replaceChild(clone, bar);
                clone.addEventListener('click', function() {
                    var taskId = clone.getAttribute('data-id');
                    if (taskId && taskId.startsWith('task-')) {
                        var id = parseInt(taskId.replace('task-', ''));
                        showTaskModal(id, currentProjectId);
                    }
                });
                clone.style.cursor = 'pointer';
            });

            // 3. sticky 헤더 설정
            setupGanttStickyHeader(chartContainer);
        }, 150);
    } catch (e) {
        console.error('간트차트 렌더링 실패:', e);
        chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>간트차트 렌더링에 실패했습니다.</p></div>';
    }

    // 간트차트 경고 로드
    if (data.project && data.project.id) {
        loadGanttWarnings(data.project.id);
    }
}

/**
 * 간트차트 토글 필터 변경 후 재렌더링 (FR-002)
 */
function reRenderGanttWithToggles() {
    if (currentProjectId === 'all') {
        loadAllProjectsGantt();
    } else if (currentProjectId && currentGanttData) {
        renderGantt(currentGanttData);
    }
}

/**
 * 간트차트 오늘 날짜 수직선 삽입
 */
function addGanttTodayMarker() {
    try {
        var svg = document.querySelector('#gantt-chart svg');
        if (!svg || !ganttInstance) return;

        // 기존 마커 제거
        var existing = svg.querySelectorAll('.gantt-today-marker-group');
        existing.forEach(function(el) { el.remove(); });

        // frappe-gantt에서 날짜 위치 계산
        var todayStr = formatDateObj(new Date());
        var todayEl = svg.querySelector('.today-highlight');
        if (todayEl) {
            // frappe-gantt에는 today-highlight 클래스로 오늘 열이 있을 수 있음
            var rect = todayEl.getBoundingClientRect();
            var svgRect = svg.getBoundingClientRect();
            var x = rect.left - svgRect.left + rect.width / 2;
            var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'gantt-today-marker-group');
            var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x);
            line.setAttribute('x2', x);
            line.setAttribute('y1', 0);
            line.setAttribute('y2', svg.getAttribute('height') || '500');
            line.setAttribute('class', 'gantt-today-marker');
            g.appendChild(line);
            svg.appendChild(g);
        }
    } catch (e) {
        console.error('오늘 마커 삽입 실패:', e);
    }
}

/**
 * 간트차트 마감선 삽입
 * - frappe-gantt 내부 grid column 너비를 역산하여 deadline 날짜의 x 좌표를 계산
 * - 빨간색 수직선으로 표시
 */
function addGanttDeadlineMarker(project) {
    try {
        if (!project || !project.endDate) return;
        var svg = document.querySelector('#gantt-chart svg');
        if (!svg || !ganttInstance) return;

        // 기존 론치일 마커 제거
        var existing = svg.querySelectorAll('.gantt-deadline-marker-group');
        existing.forEach(function(el) { el.remove(); });

        var lowerTexts = svg.querySelectorAll('.lower-text');
        if (lowerTexts.length < 2) return;

        var x0 = parseFloat(lowerTexts[0].getAttribute('x'));
        var x1 = parseFloat(lowerTexts[1].getAttribute('x'));
        var colWidth = x1 - x0;
        if (colWidth <= 0) return;

        var todayHighlight = svg.querySelector('.today-highlight');
        if (!todayHighlight) return;

        var todayX = parseFloat(todayHighlight.getAttribute('x'));
        var todayWidth = parseFloat(todayHighlight.getAttribute('width'));
        var todayCenterX = todayX + todayWidth / 2;

        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var endDateDate = new Date(project.endDate + 'T00:00:00');
        var diffDays;
        if (ganttWeekendsRemoved) {
            diffDays = countBusinessDaysBetween(today, endDateDate);
        } else {
            diffDays = Math.round((endDateDate - today) / (1000 * 60 * 60 * 24));
        }

        var dayPixels = colWidth;
        if (currentViewMode === 'Week') {
            dayPixels = colWidth / 7;
        } else if (currentViewMode === 'Month') {
            dayPixels = colWidth / 30;
        } else if (currentViewMode === 'Quarter Day') {
            dayPixels = colWidth * 4;
        } else if (currentViewMode === 'Half Day') {
            dayPixels = colWidth * 2;
        }

        var markerX = todayCenterX + (diffDays * dayPixels);

        var svgWidth = parseFloat(svg.getAttribute('width') || svg.getBoundingClientRect().width);
        if (markerX < 0) return;
        if (markerX > svgWidth - 20) {
            var newWidth = markerX + 200;
            svg.setAttribute('width', newWidth);
            svg.setAttribute('viewBox', '0 0 ' + newWidth + ' ' + (svg.getAttribute('height') || 500));
        }

        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'gantt-deadline-marker-group');
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', markerX);
        line.setAttribute('x2', markerX);
        line.setAttribute('y1', 0);
        line.setAttribute('y2', svg.getAttribute('height') || '500');
        line.setAttribute('class', 'gantt-deadline-marker');
        g.appendChild(line);

        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', markerX + 4);
        text.setAttribute('y', 15);
        text.setAttribute('class', 'gantt-deadline-label');
        text.textContent = '론치 ' + formatShortDateWithDay(project.endDate) + ': ' + project.name;
        g.appendChild(text);

        svg.appendChild(g);
    } catch (e) {
        console.error('론치일 마커 삽입 실패:', e);
    }
}

/**
 * 간트차트 날짜 헤더 sticky 구현
 * SVG의 date 레이어와 grid-header를 DOM 최상위로 이동하고,
 * 스크롤 이벤트에서 translateY로 헤더 위치를 보정한다.
 * @param {HTMLElement} chartEl - #gantt-chart 요소
 */
function setupGanttStickyHeader(chartEl) {
    var scrollContainer = chartEl.closest('.card-body') || document.querySelector('#gantt-container .card-body');
    if (!scrollContainer) return;
    var svg = chartEl.querySelector('svg');
    if (!svg) return;

    var gridLayer = svg.querySelector('g.grid');
    var dateLayer = svg.querySelector('g.date');
    if (!gridLayer || !dateLayer) return;

    // grid-header rect (헤더 배경)
    var gridHeaderRect = gridLayer.querySelector('rect.grid-header');

    // rect.grid-header의 height를 날짜 헤더 전체 높이로 동적 재설정
    // getBBox()로 g.date의 실제 렌더링 bounding box를 구해서 정밀한 height 설정
    if (gridHeaderRect && dateLayer) {
        var dateBBox;
        try { dateBBox = dateLayer.getBBox(); } catch(e) { dateBBox = null; }
        if (dateBBox && dateBBox.height > 0) {
            var headerHeight = dateBBox.y + dateBBox.height + 2; // 2px 여유
            gridHeaderRect.setAttribute('height', headerHeight);
        } else {
            // getBBox 실패 시 fallback: .lower-text의 최대 y + font-size + 4px
            var lowerTexts = dateLayer.querySelectorAll('.lower-text');
            var maxY = 0;
            lowerTexts.forEach(function(t) {
                var y = parseFloat(t.getAttribute('y') || 0);
                if (y > maxY) maxY = y;
            });
            if (maxY > 0) {
                var fontSize = 12;
                var firstLower = lowerTexts[0];
                if (firstLower) {
                    var fs = parseFloat(firstLower.getAttribute('font-size') || 0);
                    if (fs > 0) fontSize = fs;
                }
                gridHeaderRect.setAttribute('height', maxY + fontSize + 4);
            }
        }
        gridHeaderRect.setAttribute('fill', '#ffffff');
        // opacity 명시적으로 1 설정 (투명도로 인해 bar content가 비치는 문제 방지)
        gridHeaderRect.setAttribute('opacity', '1');
    }

    // rect.grid-header 단독 + g.date를 SVG의 마지막 자식으로 이동 (z-order 최상위)
    // 순서: rect 먼저, date layer 나중 → date layer가 rect 위에서 보임
    if (gridHeaderRect) {
        svg.appendChild(gridHeaderRect);
    }
    svg.appendChild(dateLayer);

    // 론치일/오늘 마커를 SVG 최말단으로 재이동 (sticky header 위에 렌더링되도록 z-order 보장)
    var deadlineMarkers = Array.from(svg.querySelectorAll('.gantt-deadline-marker-group'));
    deadlineMarkers.forEach(function(m) { svg.appendChild(m); });
    var todayMarkers = Array.from(svg.querySelectorAll('.gantt-today-marker-group'));
    todayMarkers.forEach(function(m) { svg.appendChild(m); });

    // 이전 스크롤 리스너 제거 (재렌더링 시 중복 방지)
    if (scrollContainer._ganttStickyScrollHandler) {
        scrollContainer.removeEventListener('scroll', scrollContainer._ganttStickyScrollHandler);
    }

    // requestAnimationFrame 기반 throttle
    var rafPending = false;
    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function() {
            rafPending = false;
            var scrollTop = scrollContainer.scrollTop;
            if (gridHeaderRect) {
                gridHeaderRect.setAttribute('y', scrollTop);
                // 스크롤 시 SVG 전체 폭에 맞춰 width 재설정 (주말 제거 후 폭 변화 반영)
                var svgWidth = parseFloat(svg.getAttribute('width') || svg.getBoundingClientRect().width || 1000);
                gridHeaderRect.setAttribute('width', svgWidth);
            }
            if (dateLayer) {
                dateLayer.setAttribute('transform', 'translate(0,' + scrollTop + ')');
            }
        });
    }

    scrollContainer._ganttStickyScrollHandler = onScroll;
    scrollContainer.addEventListener('scroll', onScroll);
    // 초기 호출
    onScroll();
}

/**
 * 간트차트 주말(토,일) 열 제거 — Day 모드에서만 동작
 * SVG 후처리로 주말 열을 제거하고 모든 요소 위치를 재조정
 */
function removeGanttWeekends(bizDaysMap) {
    ganttWeekendsRemoved = false;
    if (!ganttInstance || currentViewMode !== 'Day') return;

    var svg = document.querySelector('#gantt-chart svg');
    if (!svg) return;

    var dates = ganttInstance.dates;
    if (!dates || dates.length < 2) return;

    // 열 너비 계산 (lower-text 간격에서)
    var lowerTexts = Array.from(svg.querySelectorAll('.lower-text'));
    if (lowerTexts.length < 2) return;
    var colWidth = parseFloat(lowerTexts[1].getAttribute('x')) - parseFloat(lowerTexts[0].getAttribute('x'));
    if (!colWidth || colWidth <= 0) return;

    var gridOffsetX = parseFloat(lowerTexts[0].getAttribute('x')) - colWidth / 2;

    // 주말 식별
    var isWeekend = [];
    var weekendCount = 0;
    for (var i = 0; i < dates.length; i++) {
        var day = dates[i].getDay();
        var isWE = (day === 0 || day === 6);
        isWeekend.push(isWE);
        if (isWE) weekendCount++;
    }
    if (weekendCount === 0) return;

    // 누적 오프셋: offset[i] = 0열~i열까지 주말 제거 폭 합계
    var offset = [];
    var cumul = 0;
    for (var i = 0; i < dates.length; i++) {
        if (isWeekend[i]) cumul += colWidth;
        offset.push(cumul);
    }
    var totalRemoved = cumul;

    // col열 좌측 엣지의 이동량
    function shiftForCol(col) {
        if (col <= 0) return 0;
        return offset[Math.min(col - 1, dates.length - 1)];
    }

    // 임의 x 좌표의 이동량
    function shiftForX(x) {
        var col = Math.floor((x - gridOffsetX) / colWidth);
        return shiftForCol(Math.max(0, col));
    }

    // 1. 날짜 헤더(lower-text): 주말 제거, 평일 이동
    for (var i = 0; i < lowerTexts.length && i < dates.length; i++) {
        if (isWeekend[i]) {
            lowerTexts[i].remove();
        } else {
            var x = parseFloat(lowerTexts[i].getAttribute('x'));
            lowerTexts[i].setAttribute('x', x - shiftForCol(i));
        }
    }

    // 2. 월 헤더(upper-text)
    svg.querySelectorAll('.upper-text').forEach(function(text) {
        var x = parseFloat(text.getAttribute('x'));
        text.setAttribute('x', x - shiftForX(x));
    });

    // 3. 그리드 세로선(tick)
    svg.querySelectorAll('.tick').forEach(function(tick) {
        var x = parseFloat(tick.getAttribute('x1'));
        var newX = x - shiftForX(x);
        tick.setAttribute('x1', newX);
        tick.setAttribute('x2', newX);
    });

    // 4. 오늘 하이라이트
    var todayHL = svg.querySelector('.today-highlight');
    if (todayHL) {
        var x = parseFloat(todayHL.getAttribute('x'));
        todayHL.setAttribute('x', x - shiftForX(x));
    }

    // 5. 바(bar-wrapper)
    svg.querySelectorAll('.bar-wrapper').forEach(function(wrapper) {
        var bar = wrapper.querySelector('.bar');
        var progress = wrapper.querySelector('.bar-progress');
        var label = wrapper.querySelector('.bar-label');

        if (bar) {
            var origX = parseFloat(bar.getAttribute('x'));
            var origW = parseFloat(bar.getAttribute('width'));
            var newX = origX - shiftForX(origX);
            var newW;

            var taskId = wrapper.getAttribute('data-id');
            if (bizDaysMap && taskId && bizDaysMap[taskId]) {
                newW = bizDaysMap[taskId] * colWidth;
            } else {
                var newRight = (origX + origW) - shiftForX(origX + origW);
                newW = Math.max(newRight - newX, colWidth * 0.5);
            }

            bar.setAttribute('x', newX);
            bar.setAttribute('width', newW);

            if (progress) {
                var pW = parseFloat(progress.getAttribute('width'));
                var ratio = origW > 0 ? pW / origW : 0;
                progress.setAttribute('x', newX);
                progress.setAttribute('width', newW * ratio);
            }

            if (label) {
                if (label.classList.contains('big')) {
                    label.setAttribute('x', newX + newW + 5);
                } else {
                    label.setAttribute('x', newX + newW / 2);
                }
            }
        }
    });

    // 6. 그리드 행/헤더 폭 축소
    svg.querySelectorAll('.grid-row').forEach(function(row) {
        var w = parseFloat(row.getAttribute('width'));
        if (w) row.setAttribute('width', w - totalRemoved);
    });
    var gridHeader = svg.querySelector('.grid-header');
    if (gridHeader) {
        var w = parseFloat(gridHeader.getAttribute('width'));
        if (w) gridHeader.setAttribute('width', w - totalRemoved);
    }

    // 7. SVG 전체 폭 축소
    var svgWidth = parseFloat(svg.getAttribute('width'));
    if (svgWidth) svg.setAttribute('width', svgWidth - totalRemoved);

    ganttWeekendsRemoved = true;
}

var ganttWarningsVisible = true;
var ganttWarningsCount = 0;

/**
 * 간트차트 경고 표시/숨기기 토글
 */
function toggleGanttWarnings() {
    ganttWarningsVisible = !ganttWarningsVisible;
    var warningsEl = document.getElementById('gantt-warnings');
    var btn = document.getElementById('gantt-toggle-warnings-btn');
    if (ganttWarningsVisible) {
        warningsEl.style.display = '';
        btn.classList.remove('btn-outline-warning');
        btn.classList.add('btn-warning');
    } else {
        warningsEl.style.display = 'none';
        btn.classList.remove('btn-warning');
        btn.classList.add('btn-outline-warning');
    }
    updateGanttWarningsBtn();
}

function updateGanttWarningsBtn() {
    var btn = document.getElementById('gantt-toggle-warnings-btn');
    if (ganttWarningsCount > 0) {
        var icon = ganttWarningsVisible ? 'bi-eye-slash' : 'bi-exclamation-triangle';
        btn.innerHTML = '<i class="bi ' + icon + '"></i> 경고 ' + ganttWarningsCount + '건';
        btn.style.display = '';
    } else {
        btn.style.display = 'none';
    }
}

// ---- 마일스톤 관리 ----

function showMilestonesModal() {
    // 간트차트에서 호출 시 프로젝트 상세의 마일스톤 탭으로 이동
    if (!currentProjectId || currentProjectId === 'all') return;
    showProjectDetail(currentProjectId, 'milestones');
}

function getMilestoneColor(name) {
    var n = name.toLowerCase();
    if (n.indexOf('개발') !== -1 || n === 'dev') return '#42A5F5';
    if (n.indexOf('qa') !== -1 || n === 'test') return '#66BB6A';
    if (n.indexOf('배포') !== -1 || n === 'deploy') return '#FFA726';
    if (n.indexOf('론치') !== -1 || n === 'launch') return '#EF5350';
    return '#78909C';
}

var _milestoneTypeLabels = { ANALYSIS: '분석', DESIGN: '설계', DEVELOPMENT: '개발', DEV_TEST: '개발자테스트', QA: 'QA' };
var _milestoneTypeOptions = '<option value="">-</option><option value="ANALYSIS">분석</option><option value="DESIGN">설계</option><option value="DEVELOPMENT">개발</option><option value="DEV_TEST">개발자테스트</option><option value="QA">QA</option>';

async function loadProjectMilestones() {
    var projectId = currentDetailProjectId;
    if (!projectId) return;
    var tbody = document.getElementById('project-milestones-table');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">로딩 중...</td></tr>';
    try {
        await loadHolidayDatesCache();
        var res = await apiCall('/api/v1/projects/' + projectId + '/milestones');
        var milestones = (res.success && res.data) ? res.data : [];
        if (milestones.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">등록된 마일스톤이 없습니다.</td></tr>';
            return;
        }
        var html = '';
        milestones.forEach(function(ms) {
            html += '<tr data-milestone-id="' + ms.id + '">';
            html += '<td class="drag-handle" style="cursor:grab; text-align:center; color:#aaa;"><i class="bi bi-grip-vertical"></i></td>';
            // 유형
            var typeOpts = _milestoneTypeOptions.replace('value="' + (ms.type || '') + '"', 'value="' + (ms.type || '') + '" selected');
            html += '<td><select class="form-select form-select-sm" onchange="updateProjectMilestone(' + ms.id + ', \'type\', this.value)" style="width:110px; font-size:0.8rem;">' + typeOpts + '</select></td>';
            // 이름
            html += '<td><input type="text" class="form-control form-control-sm" value="' + escapeHtml(ms.name) + '" onchange="updateProjectMilestone(' + ms.id + ', \'name\', this.value)" style="width:200px;"></td>';
            // 일수: DB에 days가 있으면 그 값(편집 가능), 없으면 시작~종료 working days 자동 계산 표시
            var msCalcDays = (ms.startDate && ms.endDate) ? calcWorkingDays(ms.startDate, ms.endDate) : null;
            var msDisplayDays = ms.days != null ? ms.days : (msCalcDays != null ? msCalcDays : '');
            html += '<td><div class="d-flex align-items-center gap-1">'
                + '<input type="number" class="form-control form-control-sm" value="' + (ms.days != null ? ms.days : '') + '" onchange="updateProjectMilestone(' + ms.id + ', \'days\', this.value ? parseInt(this.value) : null)" style="width:60px;" min="1" placeholder="' + (msCalcDays != null ? msCalcDays : '') + '">'
                + (ms.days == null && msCalcDays != null ? '<small class="text-muted text-nowrap">' + msCalcDays + 'd</small>' : '')
                + '</div></td>';
            // 시작일
            html += '<td><div class="d-flex align-items-center gap-1"><input type="date" class="form-control form-control-sm" value="' + (ms.startDate || '') + '" onchange="updateProjectMilestone(' + ms.id + ', \'startDate\', this.value)" style="width:140px;"><small class="text-muted text-nowrap">' + formatDayOnly(ms.startDate) + '</small></div></td>';
            // 종료일
            html += '<td><div class="d-flex align-items-center gap-1"><input type="date" class="form-control form-control-sm" value="' + (ms.endDate || '') + '" onchange="updateProjectMilestone(' + ms.id + ', \'endDate\', this.value)" style="width:140px;"><small class="text-muted text-nowrap">' + formatDayOnly(ms.endDate) + '</small></div></td>';
            html += '<td class="text-center"><button class="btn btn-outline-danger btn-sm" onclick="deleteProjectMilestone(' + ms.id + ')"><i class="bi bi-trash"></i></button></td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
        initMilestoneDragDrop();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">로드 실패</td></tr>';
    }
}

function initMilestoneDragDrop() {
    var tbody = document.getElementById('project-milestones-table');
    if (!tbody) return;
    if (tbody._sortable) tbody._sortable.destroy();
    tbody._sortable = new Sortable(tbody, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: function() { saveMilestoneOrder(); }
    });
}

async function saveMilestoneOrder() {
    var rows = document.querySelectorAll('#project-milestones-table tr[data-milestone-id]');
    var projectId = currentDetailProjectId;
    var promises = [];
    rows.forEach(function(row, idx) {
        var msId = parseInt(row.getAttribute('data-milestone-id'));
        promises.push(apiCall('/api/v1/projects/' + projectId + '/milestones/' + msId, 'PUT', { sortOrder: idx + 1 }));
    });
    try {
        await Promise.all(promises);
        showToast('마일스톤 순서가 변경되었습니다.', 'success');
    } catch (e) { showToast('순서 변경에 실패했습니다.', 'error'); }
}

async function addProjectMilestone() {
    var projectId = currentDetailProjectId;
    var type = document.getElementById('proj-ms-type').value;
    var name = document.getElementById('proj-ms-name').value.trim();
    var days = document.getElementById('proj-ms-days').value;
    var startDate = document.getElementById('proj-ms-start').value;
    var endDate = document.getElementById('proj-ms-end').value;
    if (!name && !type) { showToast('유형 또는 이름을 입력해주세요.', 'warning'); return; }
    if (!name && type) name = _milestoneTypeLabels[type] || type;
    var body = { name: name, sortOrder: null };
    if (type) body.type = type;
    if (days) body.days = parseInt(days);
    if (startDate) body.startDate = startDate;
    if (endDate) body.endDate = endDate;
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/milestones', 'POST', body);
        if (res.success) {
            showToast('마일스톤이 추가되었습니다.', 'success');
            document.getElementById('proj-ms-type').value = '';
            document.getElementById('proj-ms-name').value = '';
            document.getElementById('proj-ms-days').value = '';
            document.getElementById('proj-ms-start').value = '';
            document.getElementById('proj-ms-end').value = '';
            await loadProjectMilestones();
        }
    } catch (e) { showToast('마일스톤 추가에 실패했습니다.', 'error'); }
}

function formatDayOnly(dateStr) {
    if (!dateStr) return '';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    var parts = dateStr.split('-');
    if (parts.length !== 3) return '';
    var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return '(' + days[d.getDay()] + ')';
}

async function updateProjectMilestone(milestoneId, field, value) {
    var projectId = currentDetailProjectId;
    var body = {};
    body[field] = value;
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/milestones/' + milestoneId, 'PUT', body);
        if (res.success) {
            showToast('마일스톤이 수정되었습니다.', 'success');
            await loadProjectMilestones();
        }
    } catch (e) { showToast('마일스톤 수정에 실패했습니다.', 'error'); }
}

async function deleteProjectMilestone(milestoneId) {
    if (!confirmAction('이 마일스톤을 삭제하시겠습니까?')) return;
    var projectId = currentDetailProjectId;
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/milestones/' + milestoneId, 'DELETE');
        if (res.success) {
            showToast('마일스톤이 삭제되었습니다.', 'success');
            await loadProjectMilestones();
        }
    } catch (e) { showToast('마일스톤 삭제에 실패했습니다.', 'error'); }
}

/**
 * 간트차트 프로젝트 경고 로드
 */
async function loadGanttWarnings(projectId) {
    var warningsEl = document.getElementById('gantt-warnings');
    var btn = document.getElementById('gantt-toggle-warnings-btn');
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/warnings');
        if (res.success && res.data && res.data.warnings && res.data.warnings.length > 0) {
            var warnings = res.data.warnings;
            ganttWarningsCount = warnings.length;
            var html = '<div class="card border-warning">';
            html += '<div class="card-header bg-warning bg-opacity-10 py-2 px-3">';
            html += '<strong><i class="bi bi-exclamation-triangle"></i> 경고 (' + warnings.length + '건)</strong>';
            html += '</div>';
            html += '<div class="card-body py-2 px-3">';
            html += '<ul class="mb-0" style="font-size:0.8rem;">';
            warnings.forEach(function(w) {
                var icon = getWarningIcon(w.type);
                var label = getWarningTypeLabel(w.type);
                html += '<li>' + icon + ' <strong>' + label + '</strong>: ' + escapeHtml(w.message);
                if (w.type === 'UNAVAILABLE_DATE' && w.assigneeId && w.assigneeName) {
                    html += ' <a href="#" onclick="event.preventDefault(); showUnavailableDatesPopup(' + w.assigneeId + ', \'' + escapeJsString(escapeHtml(w.assigneeName)) + '\')" style="font-size:0.75rem;"><i class="bi bi-calendar-x"></i> 비가용일 확인</a>';
                }
                html += '</li>';
            });
            html += '</ul>';
            html += '</div></div>';
            warningsEl.innerHTML = html;
            warningsEl.style.display = ganttWarningsVisible ? '' : 'none';
            btn.classList.remove('btn-outline-warning', 'btn-warning');
            btn.classList.add(ganttWarningsVisible ? 'btn-warning' : 'btn-outline-warning');
            updateGanttWarningsBtn();
        } else {
            ganttWarningsCount = 0;
            warningsEl.style.display = 'none';
            updateGanttWarningsBtn();
        }
    } catch (e) {
        ganttWarningsCount = 0;
        warningsEl.style.display = 'none';
        updateGanttWarningsBtn();
    }
}

/**
 * 경고 유형별 아이콘
 */
function getWarningTypeLabel(type) {
    switch (type) {
        case 'UNORDERED_TASK': return '순서 미지정';
        case 'MISSING_START_DATE': return '시작일 누락';
        case 'SCHEDULE_CONFLICT': return '일정 충돌';
        case 'DEPENDENCY_ISSUE': return '의존성 문제';
        case 'DEADLINE_EXCEEDED': return '마감 지연';
        case 'ORPHAN_TASK': return '멤버 미지정';
        case 'DEPENDENCY_REMOVED': return '의존성 비활성';
        case 'UNAVAILABLE_DATE': return '비가용일 충돌';
        default: return type;
    }
}

function getWarningIcon(type) {
    switch (type) {
        case 'UNORDERED_TASK': return '<i class="bi bi-sort-numeric-down text-warning"></i>';
        case 'MISSING_START_DATE': return '<i class="bi bi-calendar-x text-danger"></i>';
        case 'SCHEDULE_CONFLICT': return '<i class="bi bi-exclamation-triangle text-danger"></i>';
        case 'DEPENDENCY_ISSUE': return '<i class="bi bi-link-45deg text-warning"></i>';
        case 'DEADLINE_EXCEEDED': return '<i class="bi bi-alarm text-danger"></i>';
        case 'ORPHAN_TASK': return '<i class="bi bi-person-x text-warning"></i>';
        case 'DEPENDENCY_REMOVED': return '<i class="bi bi-trash text-secondary"></i>';
        case 'UNAVAILABLE_DATE': return '<i class="bi bi-calendar-event text-info"></i>';
        default: return '<i class="bi bi-info-circle text-secondary"></i>';
    }
}

function changeGanttViewMode(mode) {
    currentViewMode = mode;

    // 간트차트 섹션 내부의 뷰 모드 버튼만 갱신
    var buttons = document.querySelectorAll('#gantt-section .section-header .btn-group .btn');
    buttons.forEach(function(btn) {
        btn.classList.remove('active');
        if (btn.textContent.trim() === mode) {
            btn.classList.add('active');
        }
    });

    // 전체 프로젝트 모드이면 전체 다시 렌더링
    if (currentProjectId === 'all') {
        loadAllProjectsGantt();
        return;
    }

    // 뷰 모드 변경 시 간트차트 완전 재렌더링 (주말 제거 등 후처리 필요)
    if (currentProjectId && currentGanttData) {
        renderGantt(currentGanttData);
    } else if (ganttInstance) {
        ganttInstance.change_view_mode(mode);
    }
}

/**
 * 태스크 바 드래그로 일정 변경 이벤트
 */
async function onTaskDateChange(task, start, end) {
    var taskId = task._taskId;
    if (!taskId) return;

    // 날짜 포맷 변환
    var startStr = formatDateObj(start);
    var endStr = formatDateObj(end);

    try {
        // 기존 태스크 정보 조회
        var taskRes = await apiCall('/api/v1/tasks/' + taskId);
        if (taskRes.success && taskRes.data) {
            var taskData = taskRes.data;
            var execMode = taskData.executionMode || 'SEQUENTIAL';
            var body = {
                name: taskData.name,
                domainSystemId: taskData.domainSystem ? taskData.domainSystem.id : null,
                assigneeId: taskData.assignee ? taskData.assignee.id : null,
                manDays: taskData.manDays,
                status: taskData.status,
                description: taskData.description,
                executionMode: execMode,
                priority: taskData.priority || null,
                type: taskData.type || null,
                actualEndDate: taskData.actualEndDate || null
            };

            if (execMode === 'SEQUENTIAL') {
                // SEQUENTIAL 모드: 드래그된 startDate를 첫 번째 태스크처럼 전달,
                // endDate는 서버에서 재계산
                body.startDate = startStr;
                body.endDate = null;
            } else {
                body.startDate = startStr;
                body.endDate = endStr;
            }

            var res = await apiCall('/api/v1/tasks/' + taskId, 'PUT', body);
            if (res.success) {
                showToast('태스크 일정이 변경되었습니다.', 'success');
                // SEQUENTIAL 모드에서는 연쇄 재계산이 발생하므로 전체 새로고침
                if (execMode === 'SEQUENTIAL') {
                    await loadGanttData(currentProjectId);
                }
            } else {
                showToast(res.message || '일정 변경에 실패했습니다.', 'error');
                // 실패 시 간트차트 새로고침
                await loadGanttData(currentProjectId);
            }
        }
    } catch (e) {
        console.error('태스크 일정 변경 실패:', e);
        showToast('태스크 일정 변경에 실패했습니다.', 'error');
        await loadGanttData(currentProjectId);
    }
}

/**
 * Date 객체를 YYYY-MM-DD 문자열로 변환
 */
function formatDateObj(date) {
    var d = new Date(date);
    var year = d.getFullYear();
    var month = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return year + '-' + month + '-' + day;
}

// ========================================
// Tasks
// ========================================

/**
 * 태스크 상세 팝업
 * options: { readOnly, projectId }
 */
async function showTaskDetail(taskId, options) {
    var opts = options || {};
    try {
        var res = await apiCall('/api/v1/tasks/' + taskId);
        if (!res.success || !res.data) {
            showToast('태스크 정보를 불러오는데 실패했습니다.', 'error');
            return;
        }

        var task = res.data;
        var html = '';
        html += '<table class="table table-bordered mb-0">';
        html += '<tr><th style="width:30%">태스크명</th><td>' + escapeHtml(task.name) + '</td></tr>';
        html += '<tr><th>상태</th><td>' + statusBadge(task.status) + '</td></tr>';
        var assigneeCell = task.assignee ? escapeHtml(task.assignee.name) + ' (' + escapeHtml(task.assignee.role) + ') <button class="btn btn-outline-secondary btn-sm ms-1" style="padding:0 4px; font-size:0.7rem;" onclick="showUnavailableDatesPopup(' + task.assignee.id + ', \'' + escapeJsString(escapeHtml(task.assignee.name)) + '\')" title="비가용일 조회"><i class="bi bi-calendar-x"></i></button>' : '-';
        html += '<tr><th>담당자</th><td>' + assigneeCell + '</td></tr>';
        html += '<tr><th>프로젝트</th><td>' + escapeHtml(task.project ? task.project.name : '-') + '</td></tr>';
        html += '<tr><th>도메인 시스템</th><td>' + (task.domainSystem ? escapeHtml(task.domainSystem.name) : '-') + '</td></tr>';
        html += '<tr><th>공수 (MD)</th><td>' + (task.manDays || '-') + '</td></tr>';
        html += '<tr><th>시작일</th><td>' + formatDateWithDay(task.startDate) + '</td></tr>';
        html += '<tr><th>종료일</th><td>' + formatDateWithDay(task.endDate) + '</td></tr>';
        html += '<tr><th>실행 모드</th><td>' + (task.executionMode || 'SEQUENTIAL') + '</td></tr>';
        html += '<tr><th>우선순위</th><td>' + (task.priority ? priorityBadge(task.priority) : '-') + '</td></tr>';
        html += '<tr><th>태스크 유형</th><td>' + (task.type ? taskTypeBadge(task.type) : '-') + '</td></tr>';
        html += '<tr><th>실제 완료일</th><td>' + formatDate(task.actualEndDate) + '</td></tr>';
        // Jira 티켓 링크
        if (task.jiraKey) {
            var jiraLinkHtml = '<code>' + escapeHtml(task.jiraKey) + '</code>';
            if (cachedJiraBaseUrl && isSafeUrl(cachedJiraBaseUrl)) {
                jiraLinkHtml = '<a href="' + escapeHtml(cachedJiraBaseUrl) + '/browse/' + escapeHtml(task.jiraKey) + '" target="_blank" rel="noopener noreferrer">'
                    + '<i class="bi bi-link-45deg"></i> ' + escapeHtml(task.jiraKey) + '</a>';
            }
            html += '<tr><th>Jira 티켓</th><td>' + jiraLinkHtml + '</td></tr>';
        }
        html += '<tr><th style="vertical-align:top;">설명</th><td>' + renderDescription(task.description) + '</td></tr>';
        if (task.dependencyTasks && task.dependencyTasks.length > 0) {
            var depNames = task.dependencyTasks.map(function(d) { return escapeHtml(d.name); }).join(', ');
            html += '<tr><th>선행 태스크</th><td>' + depNames + '</td></tr>';
        }
        // 링크 표시
        if (task.links && task.links.length > 0) {
            html += '<tr><th>링크</th><td>';
            task.links.forEach(function(link) {
                if (isSafeUrl(link.url)) {
                    html += '<div class="mb-1"><a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer">';
                    html += '<i class="bi bi-link-45deg"></i> ' + escapeHtml(link.label);
                    html += '</a></div>';
                } else {
                    html += '<div class="mb-1"><i class="bi bi-link-45deg"></i> ' + escapeHtml(link.label) + ' <span class="text-muted">(' + escapeHtml(link.url) + ')</span></div>';
                }
            });
            html += '</td></tr>';
        }
        html += '</table>';

        document.getElementById('task-detail-content').innerHTML = html;

        var deleteBtn = document.getElementById('task-detail-delete-btn');
        var editBtn = document.getElementById('task-detail-edit-btn');

        deleteBtn.style.display = '';
        editBtn.style.display = '';

        var detailProjectId = opts.projectId || null;

        // 삭제 버튼 이벤트
        deleteBtn.onclick = function() {
            bootstrap.Modal.getInstance(document.getElementById('taskDetailModal')).hide();
            deleteTask(task.id);
        };
        // 수정 버튼 이벤트
        editBtn.onclick = function() {
            bootstrap.Modal.getInstance(document.getElementById('taskDetailModal')).hide();
            showTaskModal(task.id, detailProjectId);
        };

        var modal = new bootstrap.Modal(document.getElementById('taskDetailModal'));
        modal.show();
    } catch (e) {
        console.error('태스크 상세 로드 실패:', e);
        showToast('태스크 정보를 불러오는데 실패했습니다.', 'error');
    }
}

/**
 * 태스크 생성/수정 모달
 * @param {number|string} taskId - 수정 시 태스크 ID, 신규 시 null/undefined
 * @param {number|string} projectId - Team Board 컨텍스트에서 명시적 프로젝트 ID
 */
async function showTaskModal(taskId, projectId) {
    // 프로젝트 ID 결정: 명시적 전달 > 간트차트 전역
    var resolvedProjectId = projectId || currentProjectId;
    currentModalProjectId = resolvedProjectId;

    // 공휴일 캐시 로드 + flatpickr 초기화 (담당자 미정이므로 개인 휴가 없이)
    await loadHolidayDatesCache();
    initTaskStartDatePicker({});

    // 초기화
    document.getElementById('task-id').value = '';
    document.getElementById('task-name').value = '';
    document.getElementById('task-domain-system').value = '';
    document.getElementById('task-assignee').value = '';
    if (taskStartDatePicker) taskStartDatePicker.clear();
    document.getElementById('task-end-date').value = '';
    document.getElementById('task-man-days').value = '';
    document.getElementById('task-status').value = 'TODO';
    document.getElementById('task-execution-mode').value = 'SEQUENTIAL';
    document.getElementById('task-priority').value = '';
    document.getElementById('task-type').value = '';
    document.getElementById('task-actual-end-date').value = '';
    document.getElementById('task-jira-key').value = '';
    document.getElementById('task-description').value = '';

    // 충돌 경고 초기화
    var warningEl = document.getElementById('task-assignee-conflict-warning');
    warningEl.style.display = 'none';
    warningEl.innerHTML = '';

    // 자동 계산 안내 초기화
    document.getElementById('task-auto-date-info').style.display = 'none';

    // 첫 번째 태스크 플래그 초기화
    isFirstTask = true;

    // 링크 컨테이너 초기화
    document.getElementById('task-links-container').innerHTML = '';
    updateAddLinkBtnState();

    // 프로젝트 드롭다운 로드
    var projectSelect = document.getElementById('task-modal-project-id');
    var projOptHtml = '<option value="">선택하세요</option>';
    try {
        var projRes = await apiCall('/api/v1/projects');
        if (projRes.success && projRes.data) {
            projRes.data.forEach(function(p) {
                projOptHtml += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
            });
        }
    } catch (e) { /* ignore */ }
    projectSelect.innerHTML = projOptHtml;
    projectSelect.value = resolvedProjectId || '';

    // 담당자 드롭다운 — loadTaskModalProjectData에서 프로젝트 멤버 기반으로 갱신
    var assigneeSelect = document.getElementById('task-assignee');
    assigneeSelect.innerHTML = '<option value="">선택하세요</option>';

    // 프로젝트 선택 시 도메인 시스템 & 담당자 & 의존관계 갱신
    projectSelect.onchange = function() {
        currentModalProjectId = this.value ? parseInt(this.value) : null;
        loadTaskModalProjectData(currentModalProjectId, null, []);
    };

    // 도메인 시스템 로드 (현재 프로젝트)
    await loadTaskModalProjectData(resolvedProjectId, null, []);

    var currentDependencies = [];

    if (taskId) {
        document.getElementById('taskModalTitle').textContent = '태스크 수정';
        try {
            var res = await apiCall('/api/v1/tasks/' + taskId);
            if (res.success && res.data) {
                var t = res.data;
                document.getElementById('task-id').value = t.id;
                document.getElementById('task-name').value = t.name || '';
                if (t.project) {
                    projectSelect.value = t.project.id;
                    currentModalProjectId = t.project.id;
                }
                document.getElementById('task-assignee').value = t.assignee ? t.assignee.id : '';
                if (taskStartDatePicker) {
                    taskStartDatePicker.setDate(t.startDate || '', false);
                } else {
                    document.getElementById('task-start-date').value = t.startDate || '';
                }
                document.getElementById('task-end-date').value = t.endDate || '';
                document.getElementById('task-man-days').value = t.manDays || '';
                document.getElementById('task-status').value = t.status || 'TODO';
                document.getElementById('task-execution-mode').value = t.executionMode || 'SEQUENTIAL';
                document.getElementById('task-priority').value = t.priority || '';
                document.getElementById('task-type').value = t.type || '';
                document.getElementById('task-actual-end-date').value = t.actualEndDate || '';
                document.getElementById('task-jira-key').value = t.jiraKey || '';
                document.getElementById('task-description').value = t.description || '';
                currentDependencies = t.dependencies || [];

                // 기존 링크 렌더링
                if (t.links && t.links.length > 0) {
                    t.links.forEach(function(link) {
                        addTaskLinkRow(link.label, link.url);
                    });
                }

                // 프로젝트 변경 시 도메인 시스템 & 의존관계 재로드
                await loadTaskModalProjectData(t.project ? t.project.id : null, taskId, currentDependencies);
                document.getElementById('task-domain-system').value = t.domainSystem ? t.domainSystem.id : '';

                // 담당자가 있으면 개인 휴가 반영하여 flatpickr 재초기화
                if (t.assignee && t.assignee.id) {
                    var memberLeaves = await loadMemberLeaveDatesCache(t.assignee.id);
                    initTaskStartDatePicker(memberLeaves);
                    if (t.startDate) {
                        taskStartDatePicker.setDate(t.startDate, false);
                    }
                }
            }
        } catch (e) {
            showToast('태스크 정보를 불러오는데 실패했습니다.', 'error');
            return;
        }
    } else {
        document.getElementById('taskModalTitle').textContent = '태스크 추가';
    }

    // 날짜 필드 표시 모드 설정 (실행 모드에 따라)
    updateTaskDateFieldsVisibility();

    // 기존 태스크 수정 시 프리뷰 호출 (담당자가 이미 선택된 경우)
    if (taskId && document.getElementById('task-assignee').value && document.getElementById('task-execution-mode').value === 'SEQUENTIAL') {
        triggerDatePreview();
    }

    // 삭제 버튼 표시/숨김 (수정 모드에서만 표시)
    var deleteModalBtn = document.getElementById('task-modal-delete-btn');
    if (taskId) {
        deleteModalBtn.style.display = '';
        deleteModalBtn.onclick = function() {
            showConfirmDialog('이 태스크를 삭제하시겠습니까?', function() {
                bootstrap.Modal.getInstance(document.getElementById('taskModal')).hide();
                deleteTask(taskId, true);
            });
        };
    } else {
        deleteModalBtn.style.display = 'none';
        deleteModalBtn.onclick = null;
    }

    // FR-006-C: 선행 태스크 검색 입력창 초기화 및 이벤트 바인딩 (1회만)
    var depSearchEl = document.getElementById('task-dep-search');
    if (depSearchEl) {
        depSearchEl.value = '';
        // 모든 항목 표시 상태로 복원
        var allItems = document.querySelectorAll('#task-dependencies-checklist .form-check');
        allItems.forEach(function(item) { item.style.display = ''; });

        if (!taskDepSearchBound) {
            depSearchEl.addEventListener('input', function() {
                var keyword = this.value.trim().toLowerCase();
                var items = document.querySelectorAll('#task-dependencies-checklist .form-check');
                items.forEach(function(item) {
                    var label = item.querySelector('label');
                    if (!label) return;
                    var text = label.textContent.toLowerCase();
                    item.style.display = (keyword === '' || text.includes(keyword)) ? '' : 'none';
                });
            });
            taskDepSearchBound = true;
        }
    }

    var modal = new bootstrap.Modal(document.getElementById('taskModal'));
    modal.show();
}

/**
 * 멤버별 태스크(일정관리) 화면에서 태스크 추가 래퍼 함수 (FR-005-B)
 * showTaskModal 완료 후 담당자를 자동 선택한다.
 */
async function showTaskModalForScheduleMember() {
    await showTaskModal(null, null);
    if (currentScheduleMemberId) {
        var assigneeSelect = document.getElementById('task-assignee');
        if (assigneeSelect) assigneeSelect.value = currentScheduleMemberId;
    }
}

/**
 * 태스크 모달 내 프로젝트 변경 시 도메인 시스템 & 의존관계 로드
 */
async function loadTaskModalProjectData(projectId, taskId, currentDependencies) {
    // 도메인 시스템 드롭다운
    var dsSelect = document.getElementById('task-domain-system');
    var dsOptHtml = '<option value="">선택하세요</option>';

    // 의존관계 섹션
    var depsSection = document.getElementById('task-dependencies-section');
    var depsContainer = document.getElementById('task-dependencies-checklist');
    depsContainer.innerHTML = '';
    depsSection.style.display = '';

    // 담당자 드롭다운
    var assigneeSelect = document.getElementById('task-assignee');
    var prevAssignee = assigneeSelect.value;
    var assigneeOptHtml = '<option value="">선택하세요</option>';

    if (!projectId) {
        dsSelect.innerHTML = dsOptHtml;
        assigneeSelect.innerHTML = assigneeOptHtml;
        currentProjectMembers = [];
        depsContainer.innerHTML = '<span class="text-muted">프로젝트를 선택하세요.</span>';
        return;
    }

    // 프로젝트 상세에서 도메인 시스템 + 멤버 로드
    try {
        var projectRes = await apiCall('/api/v1/projects/' + projectId);
        if (projectRes.success && projectRes.data) {
            if (projectRes.data.domainSystems) {
                projectRes.data.domainSystems.forEach(function(ds) {
                    dsOptHtml += '<option value="' + ds.id + '">' + escapeHtml(ds.name) + '</option>';
                });
            }
            // 담당자: 프로젝트 참여 멤버만 표시
            if (projectRes.data.members) {
                currentProjectMembers = projectRes.data.members;
                projectRes.data.members.forEach(function(m) {
                    assigneeOptHtml += '<option value="' + m.id + '">' + escapeHtml(m.name) + ' (' + m.role + ')</option>';
                });
            }
        }
    } catch (e) { /* ignore */ }
    dsSelect.innerHTML = dsOptHtml;
    assigneeSelect.innerHTML = assigneeOptHtml;
    // 이전 선택값 복원 (프로젝트 멤버에 포함된 경우)
    if (prevAssignee) assigneeSelect.value = prevAssignee;

    // 의존관계 체크리스트 렌더링
    var ganttData = (currentGanttData && currentGanttData.project && currentGanttData.project.id === parseInt(projectId))
        ? currentGanttData : null;
    if (!ganttData) {
        try {
            var ganttRes = await apiCall('/api/v1/projects/' + projectId + '/tasks');
            if (ganttRes.success && ganttRes.data) {
                ganttData = ganttRes.data;
            }
        } catch (e) { /* ignore */ }
    }
    if (ganttData && ganttData.domainSystems) {
        var depsHtml = '';
        ganttData.domainSystems.forEach(function(ds) {
            if (ds.tasks) {
                ds.tasks.forEach(function(task) {
                    if (taskId && task.id === parseInt(taskId)) return;
                    var checked = (currentDependencies || []).indexOf(task.id) >= 0 ? 'checked' : '';
                    depsHtml += '<div class="form-check">';
                    depsHtml += '<input class="form-check-input task-dep-checkbox" type="checkbox" value="' + task.id + '" id="dep-' + task.id + '" ' + checked + '>';
                    depsHtml += '<label class="form-check-label" for="dep-' + task.id + '">[' + escapeHtml(ds.name) + '] ' + escapeHtml(task.name) + '</label>';
                    depsHtml += '</div>';
                });
            }
        });
        depsContainer.innerHTML = depsHtml || '<span class="text-muted">의존 가능한 태스크가 없습니다.</span>';
    } else {
        depsContainer.innerHTML = '<span class="text-muted">의존 가능한 태스크가 없습니다.</span>';
    }
}

async function saveTask() {
    var id = document.getElementById('task-id').value;
    var name = document.getElementById('task-name').value.trim();
    var domainSystemId = document.getElementById('task-domain-system').value;
    var assigneeId = document.getElementById('task-assignee').value;
    var startDate = document.getElementById('task-start-date').value;
    var endDate = document.getElementById('task-end-date').value;
    var manDays = document.getElementById('task-man-days').value;
    var status = document.getElementById('task-status').value;
    var executionMode = document.getElementById('task-execution-mode').value;
    var description = document.getElementById('task-description').value.trim();

    var selectedProjectId = document.getElementById('task-modal-project-id').value;
    if (!selectedProjectId) {
        showToast('프로젝트를 선택해주세요.', 'warning');
        return;
    }
    currentModalProjectId = parseInt(selectedProjectId);

    if (!name) {
        showToast('태스크명을 입력해주세요.', 'warning');
        return;
    }
    if (executionMode === 'SEQUENTIAL') {
        // 첫 번째 태스크인 경우 시작일 필수
        if (isFirstTask && !startDate) {
            showToast('선행 태스크가 없으므로 시작일을 입력해주세요.', 'warning');
            return;
        }
    } else {
        // PARALLEL 모드: 시작일, 종료일 필수
        if (!startDate || !endDate) {
            showToast('PARALLEL 모드에서는 시작일과 종료일을 입력해주세요.', 'warning');
            return;
        }
    }

    // 링크 수집
    var links = [];
    var linkRows = document.querySelectorAll('#task-links-container .task-link-row');
    linkRows.forEach(function(row) {
        var label = row.querySelector('.task-link-label').value.trim();
        var url = row.querySelector('.task-link-url').value.trim();
        if (url) {
            links.push({ label: label, url: url });
        }
    });

    var resolvedProjectId = currentModalProjectId || currentProjectId;

    var priority = document.getElementById('task-priority').value;
    var taskType = document.getElementById('task-type').value;
    var actualEndDate = document.getElementById('task-actual-end-date').value;

    var jiraKey = document.getElementById('task-jira-key').value.trim();

    var body = {
        name: name,
        projectId: currentModalProjectId,
        domainSystemId: domainSystemId ? parseInt(domainSystemId) : null,
        assigneeId: assigneeId ? parseInt(assigneeId) : null,
        manDays: manDays ? parseFloat(manDays) : null,
        status: status,
        executionMode: executionMode,
        priority: priority || null,
        type: taskType || null,
        actualEndDate: actualEndDate || null,
        jiraKey: jiraKey || null,
        description: description,
        links: links
    };

    if (executionMode === 'SEQUENTIAL') {
        // SEQUENTIAL 모드: 첫 번째 태스크면 startDate 포함, 후속이면 null
        // endDate는 항상 null (서버에서 자동 계산)
        body.startDate = isFirstTask ? startDate : null;
        body.endDate = null;
    } else {
        // PARALLEL 모드: 기존 방식
        body.startDate = startDate;
        body.endDate = endDate;
    }

    try {
        var res;
        if (id) {
            res = await apiCall('/api/v1/tasks/' + id, 'PUT', body);
        } else {
            res = await apiCall('/api/v1/projects/' + resolvedProjectId + '/tasks', 'POST', body);
        }

        if (res.success) {
            // 의존관계 업데이트 (간트차트 컨텍스트에서만)
            var savedTaskId = id || (res.data ? res.data.id : null);
            if (savedTaskId && currentSection === 'gantt') {
                await updateTaskDependencies(savedTaskId);
            }

            showToast(id ? '태스크가 수정되었습니다.' : '태스크가 추가되었습니다.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('taskModal')).hide();

            // currentSection에 따라 새로고침 분기
            if (currentSection === 'assignee-schedule') {
                if (currentScheduleMemberId) {
                    await selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
                }
            } else if (currentSection === 'projects' && currentDetailProjectId) {
                await loadProjectTasks(currentDetailProjectId);
            } else if (currentSection === 'gantt' && currentProjectId) {
                await loadGanttData(currentProjectId);
            } else if (currentProjectId) {
                await loadGanttData(currentProjectId);
            }
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('태스크 저장 실패:', e);
        showToast('태스크 저장에 실패했습니다.', 'error');
    }
}

/**
 * 태스크 의존관계 업데이트
 */
async function updateTaskDependencies(taskId) {
    // 현재 의존관계 조회
    var taskRes = await apiCall('/api/v1/tasks/' + taskId);
    var currentDeps = [];
    if (taskRes.success && taskRes.data && taskRes.data.dependencies) {
        currentDeps = taskRes.data.dependencies;
    }

    // 체크된 의존관계 ID 수집
    var selectedDeps = [];
    var checkboxes = document.querySelectorAll('#task-dependencies-checklist input[type="checkbox"]:checked');
    checkboxes.forEach(function(cb) {
        selectedDeps.push(parseInt(cb.value));
    });

    // 추가
    for (var i = 0; i < selectedDeps.length; i++) {
        if (currentDeps.indexOf(selectedDeps[i]) < 0) {
            await apiCall('/api/v1/tasks/' + taskId + '/dependencies', 'POST', { dependsOnTaskId: selectedDeps[i] });
        }
    }

    // 제거
    for (var j = 0; j < currentDeps.length; j++) {
        if (selectedDeps.indexOf(currentDeps[j]) < 0) {
            await apiCall('/api/v1/tasks/' + taskId + '/dependencies/' + currentDeps[j], 'DELETE');
        }
    }
}

async function deleteTask(id, skipConfirm) {
    if (!skipConfirm && !confirmAction('이 태스크를 삭제하시겠습니까?')) return;

    try {
        var res = await apiCall('/api/v1/tasks/' + id, 'DELETE');
        if (res.success) {
            showToast('태스크가 삭제되었습니다.', 'success');
            // currentSection에 따라 새로고침 분기
            if (currentSection === 'assignee-schedule') {
                if (currentScheduleMemberId) {
                    await selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
                }
            } else if (currentSection === 'projects' && currentDetailProjectId) {
                await loadProjectTasks(currentDetailProjectId);
            } else if (currentProjectId) {
                await loadGanttData(currentProjectId);
            }
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('태스크 삭제 실패:', e);
        showToast('태스크 삭제에 실패했습니다.', 'error');
    }
}

// ========================================
// AI Parser
// ========================================

/**
 * AI 파서 화면 - 프로젝트 목록 로드
 */
async function loadAiParserProjects() {
    try {
        var res = await apiCall('/api/v1/projects');
        var projects = (res.success && res.data) ? res.data : [];
        var select = document.getElementById('ai-project-select');
        var aiOptHtml = '<option value="">프로젝트를 선택하세요</option>';
        projects.forEach(function(p) {
            aiOptHtml += '<option value="' + p.id + '">' + escapeHtml(p.name) + ' (' + p.status + ')</option>';
        });
        select.innerHTML = aiOptHtml;
    } catch (e) {
        console.error('AI Parser 프로젝트 목록 로드 실패:', e);
    }
}

/**
 * AI free-text 파싱 호출
 */
async function parseFreeText() {
    var projectId = document.getElementById('ai-project-select').value;
    var text = document.getElementById('ai-text-input').value.trim();

    if (!projectId) {
        showToast('프로젝트를 선택해주세요.', 'warning');
        return;
    }
    if (!text) {
        showToast('파싱할 텍스트를 입력해주세요.', 'warning');
        return;
    }

    var btn = document.getElementById('ai-parse-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> 분석 중...';

    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/tasks/parse', 'POST', { text: text });

        if (res.success && res.data && res.data.parsed) {
            parsedTaskData = { domainSystems: res.data.parsed };
            showParseResult(res.data.parsed);
        } else {
            showToast(res.message || 'AI 분석에 실패했습니다.', 'error');
            document.getElementById('ai-result').style.display = 'none';
        }
    } catch (e) {
        console.error('AI 파싱 실패:', e);
        showToast('AI 분석에 실패했습니다.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cpu"></i> AI 분석';
    }
}

/**
 * 파싱 결과 테이블 표시
 */
function showParseResult(parsed) {
    var contentEl = document.getElementById('ai-result-content');
    var html = '';

    parsed.forEach(function(ds) {
        html += '<div class="ai-result-domain">';
        html += '<h6>';
        html += escapeHtml(ds.name);
        if (ds.domainSystemMatched) {
            html += ' <span class="badge bg-success matched-badge">매칭됨</span>';
        } else {
            html += ' <span class="badge bg-danger matched-badge">미매칭</span>';
        }
        html += '</h6>';

        if (ds.tasks && ds.tasks.length > 0) {
            html += '<table class="table table-sm table-bordered">';
            html += '<thead><tr><th>태스크명</th><th>멤버</th><th>공수(MD)</th><th>선행 태스크</th></tr></thead>';
            html += '<tbody>';
            ds.tasks.forEach(function(task) {
                html += '<tr>';
                html += '<td>' + escapeHtml(task.name) + '</td>';
                html += '<td>' + escapeHtml(task.assigneeName || '-');
                if (task.assigneeMatched) {
                    html += ' <span class="badge bg-success matched-badge">매칭</span>';
                } else if (task.assigneeName) {
                    html += ' <span class="badge bg-danger matched-badge">미매칭</span>';
                }
                html += '</td>';
                html += '<td>' + (task.manDays || '-') + '</td>';
                html += '<td>' + (task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.map(function(d) { return escapeHtml(d); }).join(', ') : '-') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';
    });

    contentEl.innerHTML = html;
    document.getElementById('ai-result').style.display = 'block';
}

/**
 * 파싱된 태스크 저장
 */
async function saveParsedTasks() {
    var projectId = document.getElementById('ai-project-select').value;

    if (!projectId) {
        showToast('프로젝트를 선택해주세요.', 'warning');
        return;
    }
    if (!parsedTaskData) {
        showToast('저장할 파싱 데이터가 없습니다.', 'warning');
        return;
    }

    if (!confirmAction('분석 결과를 저장하시겠습니까?\n선택한 프로젝트에 태스크가 추가됩니다.')) return;

    var btn = document.getElementById('ai-save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> 저장 중...';

    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/tasks/parse/save', 'POST', parsedTaskData);

        if (res.success) {
            var count = (res.data && res.data.savedTaskIds) ? res.data.savedTaskIds.length : 0;
            showToast(count + '개의 태스크가 저장되었습니다.', 'success');
            parsedTaskData = null;
            document.getElementById('ai-result').style.display = 'none';
            document.getElementById('ai-text-input').value = '';
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('파싱 결과 저장 실패:', e);
        showToast('저장에 실패했습니다.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-save"></i> 저장';
    }
}

// ========================================
// 태스크 섹션 (전체 태스크 테이블)
// ========================================

// ========================================
// 멤버별 태스크 (3패널 레이아웃)
// ========================================

var _scheduleMemberSortField = 'name';
var _scheduleMembersCache = [];

/**
 * 멤버별 태스크 초기 로드
 */
function initSchedulePanelResize() {
    var handle = document.getElementById('schedule-panel-resize-handle');
    var panel = document.getElementById('schedule-member-panel');
    if (!handle || !panel) return;
    var startX, startW;
    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        startX = e.clientX;
        startW = panel.offsetWidth;
        handle.classList.add('dragging');
        function onMove(e) {
            var w = startW + (e.clientX - startX);
            if (w >= 100 && w <= 400) {
                panel.style.width = w + 'px';
            }
        }
        function onUp() {
            handle.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

async function loadAssigneeSchedule() {
    initSchedulePanelResize();
    try {
        var res = await apiCall('/api/v1/members');
        _scheduleMembersCache = (res.success && res.data) ? res.data : [];
        renderScheduleMemberList();

        // 이전 선택이 있으면 큐 재로드
        if (currentScheduleMemberId) {
            var listEl = document.getElementById('schedule-member-list');
            var matchEl = listEl.querySelector('[data-member-id="' + currentScheduleMemberId + '"]');
            var mname = matchEl ? matchEl.getAttribute('data-member-name') : '';
            await selectScheduleMember(currentScheduleMemberId, mname);
        }
    } catch (e) {
        console.error('멤버 목록 로드 실패:', e);
    }
}

function renderScheduleMemberList() {
    var listEl = document.getElementById('schedule-member-list');
    var members = _scheduleMembersCache.slice();

    if (members.length === 0) {
        listEl.innerHTML = '<div class="text-center text-muted p-3">등록된 멤버가 없습니다.</div>';
        return;
    }

    var roleOrder = { PM: 0, EM: 1, BE: 2, FE: 3, QA: 4, PLACEHOLDER: 5 };
    members.sort(function(a, b) {
        if (_scheduleMemberSortField === 'role') {
            var ra = roleOrder[a.role] != null ? roleOrder[a.role] : 99;
            var rb = roleOrder[b.role] != null ? roleOrder[b.role] : 99;
            if (ra !== rb) return ra - rb;
            return (a.name || '').localeCompare(b.name || '');
        } else if (_scheduleMemberSortField === 'team') {
            var ta = (a.team || '').toLowerCase();
            var tb = (b.team || '').toLowerCase();
            if (ta !== tb) return ta.localeCompare(tb);
            return (a.name || '').localeCompare(b.name || '');
        }
        return (a.name || '').localeCompare(b.name || '');
    });

    var html = '';
    members.forEach(function(m) {
        var activeClass = (currentScheduleMemberId === m.id) ? ' active' : '';
        html += '<div class="schedule-member-item' + activeClass + '" data-member-id="' + m.id + '" data-member-name="' + escapeHtml(m.name) + '">';
        html += '<strong>' + escapeHtml(m.name) + '</strong> ';
        html += '<span class="text-muted" style="font-size:0.8rem;">' + m.role + (m.team ? ' · ' + escapeHtml(m.team) : '') + '</span>';
        html += '</div>';
    });
    listEl.innerHTML = html;

    // 이벤트 위임으로 클릭 바인딩
    listEl.querySelectorAll('.schedule-member-item').forEach(function(el) {
        el.addEventListener('click', function() {
            var mid = parseInt(this.getAttribute('data-member-id'));
            var mname = this.getAttribute('data-member-name');
            selectScheduleMember(mid, mname);
        });
    });
}

function sortScheduleMembers(field) {
    _scheduleMemberSortField = field;
    // 버튼 active 상태 갱신
    var btns = document.querySelectorAll('#schedule-member-sort-group .btn');
    btns.forEach(function(btn) {
        btn.classList.remove('active');
        if (btn.textContent.trim() === (field === 'name' ? '이름' : field === 'role' ? '역할' : '팀')) {
            btn.classList.add('active');
        }
    });
    renderScheduleMemberList();
}

/**
 * 담당자 선택 시 큐 로드
 */
async function selectScheduleMember(memberId, name) {
    currentScheduleMemberId = memberId;
    currentScheduleMemberName = name;

    // hash 업데이트
    _isNavigating = true;
    if (window.location.hash !== '#assignee-schedule/' + memberId) {
        window.location.hash = 'assignee-schedule/' + memberId;
    }
    _isNavigating = false;

    // 멤버 리스트 active 상태 업데이트 (data-member-id 기반)
    var items = document.querySelectorAll('#schedule-member-list .schedule-member-item');
    items.forEach(function(item) {
        item.classList.remove('active');
        if (parseInt(item.getAttribute('data-member-id')) === memberId) {
            item.classList.add('active');
        }
    });

    document.getElementById('schedule-member-name').innerHTML = '<strong>' + escapeHtml(name) + '</strong> 태스크 큐 <button class="btn btn-sm btn-outline-secondary ms-2" onclick="showUnavailableDatesPopup(' + memberId + ', \'' + escapeJsString(escapeHtml(name)) + '\')" style="padding:1px 5px; font-size:0.75rem;" title="비가용일 조회"><i class="bi bi-calendar-x"></i></button><span id="schedule-md-summary" class="text-muted ms-auto" style="font-size:0.8rem;"></span>';

    // 태스크 착수일 표시
    var queueStartDateRow = document.getElementById('schedule-queue-start-date-row');
    queueStartDateRow.style.display = 'flex';
    try {
        var memberRes = await apiCall('/api/v1/members/' + memberId);
        if (memberRes.success && memberRes.data) {
            // flatpickr 초기화 (공휴일 + 개인 휴가 비활성화)
            await loadHolidayDatesCache();
            var memberLeaves = await loadMemberLeaveDatesCache(memberId);
            var holidays = cachedHolidayDates || {};
            var queueDateEl = document.getElementById('schedule-queue-start-date');
            if (queueDateEl._flatpickr) queueDateEl._flatpickr.destroy();
            flatpickr(queueDateEl, {
                dateFormat: 'Y-m-d',
                locale: 'ko',
                allowInput: true,
                disable: [
                    function(date) {
                        var day = date.getDay();
                        if (day === 0 || day === 6) return true;
                        var y = date.getFullYear();
                        var m = String(date.getMonth() + 1).padStart(2, '0');
                        var d = String(date.getDate()).padStart(2, '0');
                        var dateStr = y + '-' + m + '-' + d;
                        if (holidays[dateStr]) return true;
                        if (memberLeaves[dateStr]) return true;
                        return false;
                    }
                ],
                onChange: async function(selectedDates, dateStr) {
                    try {
                        var res = await apiCall('/api/v1/members/' + memberId + '/queue-start-date', 'PATCH',
                            { queueStartDate: dateStr || null });
                        if (res.success) {
                            showToast('착수일이 저장되었습니다.', 'success');
                            // selectScheduleMember 대신 ordered-tasks만 재조회하여 큐 갱신
                            var orderedRes = await apiCall('/api/v1/members/' + memberId + '/ordered-tasks');
                            if (orderedRes.success && orderedRes.data) {
                                renderScheduleQueue(orderedRes.data);
                            }
                        } else {
                            showToast(res.message || '착수일 저장에 실패했습니다.', 'error');
                        }
                    } catch (e) {
                        console.error('태스크 착수일 자동 저장 실패:', e);
                        showToast('착수일 저장에 실패했습니다.', 'error');
                    }
                }
            });
            if (memberRes.data.queueStartDate) {
                queueDateEl._flatpickr.setDate(memberRes.data.queueStartDate, false);
            }
        }
    } catch (e) {
        console.error('멤버 정보 로드 실패:', e);
    }

    // 일정 최적화 버튼 이벤트 바인딩
    var recalcBtn = document.getElementById('schedule-queue-start-date-recalculate');
    var newRecalcBtn = recalcBtn.cloneNode(true);
    recalcBtn.parentNode.replaceChild(newRecalcBtn, recalcBtn);
    newRecalcBtn.addEventListener('click', async function() {
        try {
            var res = await apiCall('/api/v1/members/' + memberId + '/recalculate-queue', 'POST');
            if (res.success) {
                showToast('TODO 태스크 일정이 최적화되었습니다.', 'success');
                await selectScheduleMember(memberId, name);
            } else {
                showToast(res.message || '최적화에 실패했습니다.', 'error');
            }
        } catch (e) {
            console.error('일정 최적화 실패:', e);
            showToast('일정 최적화에 실패했습니다.', 'error');
        }
    });

    // 태스크 추가 버튼 표시
    var scheduleAddBtn = document.getElementById('schedule-add-task-btn');
    if (scheduleAddBtn) scheduleAddBtn.style.display = '';

    // 상태 필터 버튼 표시
    var sfRow = document.getElementById('schedule-status-filter-row');
    sfRow.style.display = 'flex';
    var sfGroup = document.getElementById('schedule-status-filter-group');
    var sf = scheduleTaskStatusFilter;
    var sfAll = sf.length === 0;
    sfGroup.innerHTML = ''
        + '<button type="button" class="btn btn-sm ' + (sfAll ? 'btn-dark' : 'btn-outline-dark') + '" onclick="clearScheduleStatusFilter()">전체</button>'
        + '<button type="button" class="btn btn-sm ' + (sf.indexOf('TODO') !== -1 ? 'btn-warning' : 'btn-outline-warning') + '" onclick="toggleScheduleStatusFilter(\'TODO\')">TODO</button>'
        + '<button type="button" class="btn btn-sm ' + (sf.indexOf('IN_PROGRESS') !== -1 ? 'btn-primary' : 'btn-outline-primary') + '" onclick="toggleScheduleStatusFilter(\'IN_PROGRESS\')">진행중</button>'
        + '<button type="button" class="btn btn-sm ' + (sf.indexOf('COMPLETED') !== -1 ? 'btn-success' : 'btn-outline-success') + '" onclick="toggleScheduleStatusFilter(\'COMPLETED\')">완료</button>'
        + '<button type="button" class="btn btn-sm ' + (sf.indexOf('HOLD') !== -1 ? 'btn-secondary' : 'btn-outline-secondary') + '" onclick="toggleScheduleStatusFilter(\'HOLD\')">홀드</button>'
        + '<button type="button" class="btn btn-sm ' + (sf.indexOf('CANCELLED') !== -1 ? 'btn-danger' : 'btn-outline-danger') + '" onclick="toggleScheduleStatusFilter(\'CANCELLED\')">취소</button>';

    // 배치 삭제 툴바 표시 및 이벤트 바인딩
    var batchToolbar = document.getElementById('schedule-batch-delete-toolbar');
    batchToolbar.style.display = 'flex';
    var selectAllCb = document.getElementById('schedule-select-all');
    selectAllCb.checked = false;
    var newSelectAllCb = selectAllCb.cloneNode(true);
    selectAllCb.parentNode.replaceChild(newSelectAllCb, selectAllCb);
    newSelectAllCb.addEventListener('change', function() {
        var cbs = document.querySelectorAll('#schedule-queue-panel .schedule-task-checkbox');
        cbs.forEach(function(cb) { cb.checked = newSelectAllCb.checked; });
        updateScheduleSelectedCount();
    });
    var batchDeleteBtn = document.getElementById('schedule-batch-delete-btn');
    var newBatchDeleteBtn = batchDeleteBtn.cloneNode(true);
    batchDeleteBtn.parentNode.replaceChild(newBatchDeleteBtn, batchDeleteBtn);
    newBatchDeleteBtn.addEventListener('click', function() {
        batchDeleteSelectedTasks(memberId);
    });

    // 상세 패널 초기화
    document.getElementById('schedule-task-detail-content').innerHTML = '<div class="text-center text-muted">태스크를 클릭하세요.</div>';

    try {
        var res = await apiCall('/api/v1/members/' + memberId + '/ordered-tasks');
        if (res.success && res.data) {
            renderScheduleQueue(res.data);
            initScheduleDragDrop(memberId);
        } else {
            document.getElementById('schedule-ordered-tasks').innerHTML = '<div class="text-center text-muted p-3">태스크가 없습니다.</div>';
            document.getElementById('schedule-unordered-tasks').innerHTML = '';
        }
    } catch (e) {
        console.error('멤버 태스크 로드 실패:', e);
        document.getElementById('schedule-ordered-tasks').innerHTML = '<div class="text-center text-muted p-3">로드 실패</div>';
    }
}

/**
 * 스케줄 큐 렌더링
 */
function renderScheduleQueue(tasks) {
    var orderedEl = document.getElementById('schedule-ordered-tasks');
    var unorderedEl = document.getElementById('schedule-unordered-tasks');

    // 상태 필터 적용: ALL이면 전체, 그 외는 해당 status만
    var filteredTasks = applyScheduleStatusFilter(tasks);

    var ordered = [];
    var unordered = [];
    var parallelTasks = [];
    var inactiveTasks = [];

    // 필터가 HOLD/CANCELLED인 경우: filteredTasks에 해당 status만 들어있음
    // 필터가 TODO/IN_PROGRESS/COMPLETED인 경우: filteredTasks에 active만 들어있음
    // 필터가 ALL인 경우: 전체 tasks
    filteredTasks.forEach(function(t) {
        if (t.status === 'HOLD' || t.status === 'CANCELLED') {
            inactiveTasks.push(t);
        } else if (t.executionMode === 'PARALLEL') {
            parallelTasks.push(t);
        } else if (t.assigneeOrder != null && t.assigneeOrder > 0) {
            ordered.push(t);
        } else {
            unordered.push(t);
        }
    });

    // MD 합계 표시
    var schTotalMd = tasks.reduce(function(s, t) { return s + (t.status !== 'CANCELLED' && t.manDays ? parseFloat(t.manDays) : 0); }, 0);
    var schRemainMd = tasks.reduce(function(s, t) { return s + (t.status !== 'CANCELLED' && t.status !== 'COMPLETED' && t.manDays ? parseFloat(t.manDays) : 0); }, 0);
    var mdSummaryEl = document.getElementById('schedule-md-summary');
    if (mdSummaryEl) {
        mdSummaryEl.textContent = schRemainMd + '/' + schTotalMd + ' MD';
    }

    // 순서 있는 SEQUENTIAL 태스크 + PARALLEL 태스크를 시작일 기준으로 병합
    ordered.sort(function(a, b) { return (a.assigneeOrder || 0) - (b.assigneeOrder || 0); });
    parallelTasks.sort(function(a, b) { return (a.startDate || '').localeCompare(b.startDate || ''); });

    // 병합: ordered 태스크와 parallel 태스크를 시작일 기준으로 인터리브
    var merged = [];
    var oi = 0, pi = 0;
    while (oi < ordered.length || pi < parallelTasks.length) {
        if (oi < ordered.length && pi < parallelTasks.length) {
            var seqDate = ordered[oi].startDate || '';
            var parDate = parallelTasks[pi].startDate || '';
            if (seqDate <= parDate) {
                merged.push(ordered[oi++]);
            } else {
                merged.push(parallelTasks[pi++]);
            }
        } else if (oi < ordered.length) {
            merged.push(ordered[oi++]);
        } else {
            merged.push(parallelTasks[pi++]);
        }
    }

    // 순서 있는 태스크 + PARALLEL 태스크
    if (merged.length > 0) {
        var html = '';
        var seqIdx = 0;
        merged.forEach(function(t) {
            var isParallel = t.executionMode === 'PARALLEL';
            html += '<div class="schedule-task-item d-flex align-items-center" data-task-id="' + t.id + '" data-start-date="' + (t.startDate || '') + '" onclick="showScheduleTaskDetail(' + t.id + ')"';
            if (isParallel) {
                html += ' style="border-left:3px solid #0dcaf0;"';
            }
            html += '>';
            // 체크박스 (다중 선택 삭제용)
            html += '<input type="checkbox" class="schedule-task-checkbox me-1" value="' + t.id + '" onclick="event.stopPropagation(); updateScheduleSelectedCount();">';
            if (isParallel) {
                html += '<i class="bi bi-arrows-expand me-2 text-info" title="PARALLEL — 독립 일정"></i>';
                html += '<span class="schedule-task-order text-info" style="font-size:0.7rem;">P</span>';
            } else {
                html += '<i class="bi bi-grip-vertical drag-handle cursor-pointer me-2" title="드래그하여 순서 변경"></i>';
                seqIdx++;
                html += '<span class="schedule-task-order">' + seqIdx + '</span>';
            }
            html += '<div class="flex-grow-1">';
            html += '<div><strong>' + escapeHtml(t.name) + '</strong>';
            if (isParallel) html += ' <span class="badge bg-info" style="font-size:0.65rem;">PARALLEL</span>';
            if (t.jiraKey) {
                if (cachedJiraBaseUrl && isSafeUrl(cachedJiraBaseUrl)) {
                    html += ' <a href="' + escapeHtml(cachedJiraBaseUrl) + '/browse/' + escapeHtml(t.jiraKey) + '" target="_blank" rel="noopener noreferrer"'
                        + ' class="badge bg-info text-decoration-none" style="font-size:0.65rem;" title="Jira 티켓 보기"'
                        + ' onclick="event.stopPropagation();">'
                        + '<i class="bi bi-link-45deg"></i> ' + escapeHtml(t.jiraKey) + '</a>';
                } else {
                    html += ' <span class="badge bg-info" style="font-size:0.65rem;"><i class="bi bi-link-45deg"></i> ' + escapeHtml(t.jiraKey) + '</span>';
                }
            }
            html += '</div>';
            html += '<div class="text-muted" style="font-size:0.78rem;">';
            html += escapeHtml(t.project ? t.project.name : (t.projectName || '')) + ' | ' + formatDateWithDay(t.startDate) + ' ~ ' + formatDateWithDay(t.endDate) + ' | ' + (t.manDays || 0) + ' MD';
            html += '</div>';
            html += '</div>';
            html += '<div class="ms-2">' + statusBadge(t.status) + '</div>';
            html += '</div>';
        });
        orderedEl.innerHTML = html;
    } else {
        orderedEl.innerHTML = '<div class="text-center text-muted p-3" style="font-size:0.85rem;">아래 미지정 태스크를 여기로 드래그하세요.</div>';
    }

    // 순서 미지정 SEQUENTIAL 태스크
    if (unordered.length > 0) {
        var uHtml = '<div class="mt-3 mb-2"><strong class="text-warning" style="font-size:0.85rem;"><i class="bi bi-exclamation-circle"></i> 순서 미지정 (' + unordered.length + '건) — 위로 드래그하여 순서 지정</strong></div>';
        uHtml += '<div id="schedule-unordered-items">';
        unordered.forEach(function(t) {
            uHtml += '<div class="schedule-task-item d-flex align-items-center" data-task-id="' + t.id + '" data-start-date="' + (t.startDate || '') + '" onclick="showScheduleTaskDetail(' + t.id + ')" style="border-left:3px solid #ffc107;">';
            uHtml += '<input type="checkbox" class="schedule-task-checkbox me-1" value="' + t.id + '" onclick="event.stopPropagation(); updateScheduleSelectedCount();">';
            uHtml += '<i class="bi bi-grip-vertical drag-handle cursor-pointer me-2" title="드래그하여 순서 지정"></i>';
            uHtml += '<div class="flex-grow-1">';
            uHtml += '<div><strong>' + escapeHtml(t.name) + '</strong>';
            if (t.jiraKey) {
                if (cachedJiraBaseUrl && isSafeUrl(cachedJiraBaseUrl)) {
                    uHtml += ' <a href="' + escapeHtml(cachedJiraBaseUrl) + '/browse/' + escapeHtml(t.jiraKey) + '" target="_blank" rel="noopener noreferrer"'
                        + ' class="badge bg-info text-decoration-none" style="font-size:0.65rem;" title="Jira 티켓 보기"'
                        + ' onclick="event.stopPropagation();">'
                        + '<i class="bi bi-link-45deg"></i> ' + escapeHtml(t.jiraKey) + '</a>';
                } else {
                    uHtml += ' <span class="badge bg-info" style="font-size:0.65rem;"><i class="bi bi-link-45deg"></i> ' + escapeHtml(t.jiraKey) + '</span>';
                }
            }
            uHtml += '</div>';
            uHtml += '<div class="text-muted" style="font-size:0.78rem;">';
            uHtml += escapeHtml(t.project ? t.project.name : (t.projectName || '')) + ' | ' + (t.manDays || 0) + ' MD | ' + statusBadge(t.status);
            uHtml += '</div>';
            uHtml += '</div>';
            uHtml += '</div>';
        });
        uHtml += '</div>';
        unorderedEl.innerHTML = uHtml;
    } else {
        unorderedEl.innerHTML = '';
    }

    // 기존 비활성 태스크 영역 제거
    var existingInactive = document.getElementById('schedule-inactive-tasks');
    if (existingInactive) existingInactive.remove();

    // HOLD/CANCELLED 비활성 태스크 별도 표시
    if (inactiveTasks.length > 0) {
        var iHtml = '<div class="mt-3 mb-2"><strong class="text-secondary" style="font-size:0.85rem;"><i class="bi bi-pause-circle"></i> 비활성 태스크 (' + inactiveTasks.length + '건)</strong></div>';
        inactiveTasks.forEach(function(t) {
            iHtml += '<div class="schedule-task-item d-flex align-items-center" data-task-id="' + t.id + '" onclick="showScheduleTaskDetail(' + t.id + ')" style="border-left:3px solid #adb5bd; opacity:0.7;">';
            iHtml += '<input type="checkbox" class="schedule-task-checkbox me-1" value="' + t.id + '" onclick="event.stopPropagation(); updateScheduleSelectedCount();">';
            iHtml += '<div class="flex-grow-1 ms-3">';
            iHtml += '<div><strong>' + escapeHtml(t.name) + '</strong></div>';
            iHtml += '<div class="text-muted" style="font-size:0.78rem;">';
            iHtml += escapeHtml(t.project ? t.project.name : (t.projectName || '')) + ' | ' + formatDateWithDay(t.startDate) + ' ~ ' + formatDateWithDay(t.endDate) + ' | ' + (t.manDays || 0) + ' MD';
            iHtml += '</div>';
            iHtml += '</div>';
            iHtml += '<div class="ms-2">' + statusBadge(t.status) + '</div>';
            iHtml += '</div>';
        });
        unorderedEl.insertAdjacentHTML('afterend', '<div id="schedule-inactive-tasks">' + iHtml + '</div>');
    }
}

/**
 * 스케줄 태스크 상세 표시 (우측 패널)
 */
async function showScheduleTaskDetail(taskId) {
    var contentEl = document.getElementById('schedule-task-detail-content');
    try {
        var res = await apiCall('/api/v1/tasks/' + taskId);
        if (!res.success || !res.data) {
            contentEl.innerHTML = '<div class="text-center text-muted">정보를 불러올 수 없습니다.</div>';
            return;
        }

        // 큐 아이템 active 표시
        var items = document.querySelectorAll('#schedule-ordered-tasks .schedule-task-item');
        items.forEach(function(el) { el.classList.remove('active'); });
        items.forEach(function(el) {
            if (el.getAttribute('data-task-id') == taskId) el.classList.add('active');
        });

        var task = res.data;
        var html = '';
        html += '<h6 class="fw-bold mb-3">' + escapeHtml(task.name) + '</h6>';
        html += '<table class="table table-sm table-bordered mb-3" style="font-size:0.85rem;">';
        html += '<tr><th style="width:35%">상태</th><td>' + statusBadge(task.status) + '</td></tr>';
        var schedAssigneeCell = task.assignee ? escapeHtml(task.assignee.name) + ' (' + escapeHtml(task.assignee.role) + ') <button class="btn btn-outline-secondary btn-sm ms-1" style="padding:0 4px; font-size:0.7rem;" onclick="showUnavailableDatesPopup(' + task.assignee.id + ', \'' + escapeJsString(escapeHtml(task.assignee.name)) + '\')" title="비가용일 조회"><i class="bi bi-calendar-x"></i></button>' : '-';
        html += '<tr><th>담당자</th><td>' + schedAssigneeCell + '</td></tr>';
        html += '<tr><th>공수</th><td>' + (task.manDays || '-') + ' MD</td></tr>';
        html += '<tr><th>시작일</th><td>' + formatDateWithDay(task.startDate) + '</td></tr>';
        html += '<tr><th>종료일</th><td>' + formatDateWithDay(task.endDate) + '</td></tr>';
        html += '<tr><th>실행모드</th><td>' + (task.executionMode || 'SEQUENTIAL') + '</td></tr>';
        if (task.dependencyTasks && task.dependencyTasks.length > 0) {
            var depNames = task.dependencyTasks.map(function(d) { return escapeHtml(d.name); }).join(', ');
            html += '<tr><th>선행 태스크</th><td>' + depNames + '</td></tr>';
        }
        // Jira 티켓 링크
        if (task.jiraKey) {
            var schedJiraHtml = '<code>' + escapeHtml(task.jiraKey) + '</code>';
            if (cachedJiraBaseUrl && isSafeUrl(cachedJiraBaseUrl)) {
                schedJiraHtml = '<a href="' + escapeHtml(cachedJiraBaseUrl) + '/browse/' + escapeHtml(task.jiraKey) + '" target="_blank" rel="noopener noreferrer">'
                    + '<i class="bi bi-link-45deg"></i> ' + escapeHtml(task.jiraKey) + '</a>';
            }
            html += '<tr><th>Jira</th><td>' + schedJiraHtml + '</td></tr>';
        }
        html += '<tr><th style="vertical-align:top;">설명</th><td>' + renderDescription(task.description) + '</td></tr>';
        html += '</table>';

        // 링크 표시
        if (task.links && task.links.length > 0) {
            html += '<h6 class="fw-bold mb-2" style="font-size:0.85rem;">링크</h6>';
            task.links.forEach(function(link) {
                if (isSafeUrl(link.url)) {
                    html += '<div class="mb-1"><a href="' + escapeHtml(link.url) + '" target="_blank" rel="noopener noreferrer"><i class="bi bi-link-45deg"></i> ' + escapeHtml(link.label) + '</a></div>';
                } else {
                    html += '<div class="mb-1"><i class="bi bi-link-45deg"></i> ' + escapeHtml(link.label) + '</div>';
                }
            });
        }

        var projectId = task.project ? task.project.id : null;
        html += '<div class="mt-3 d-flex gap-2">';
        html += '<button class="btn btn-outline-primary btn-sm" onclick="showTaskModal(' + task.id + (projectId ? ', ' + projectId : '') + ')"><i class="bi bi-pencil"></i> 수정</button>';
        html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteTask(' + task.id + ')"><i class="bi bi-trash"></i> 삭제</button>';
        html += '</div>';

        contentEl.innerHTML = html;
    } catch (e) {
        console.error('태스크 상세 로드 실패:', e);
        contentEl.innerHTML = '<div class="text-center text-muted">정보를 불러올 수 없습니다.</div>';
    }
}

/**
 * 스케줄 드래그 & 드롭 초기화
 */
var _scheduleSortableOrdered = null;
var _scheduleSortableUnordered = null;

function initScheduleDragDrop(memberId) {
    if (typeof Sortable === 'undefined') return;

    // 기존 Sortable 인스턴스 파괴
    if (_scheduleSortableOrdered) { _scheduleSortableOrdered.destroy(); _scheduleSortableOrdered = null; }
    if (_scheduleSortableUnordered) { _scheduleSortableUnordered.destroy(); _scheduleSortableUnordered = null; }

    var orderedContainer = document.getElementById('schedule-ordered-tasks');
    var unorderedContainer = document.getElementById('schedule-unordered-items');

    // 순서 변경 완료 시 호출되는 공통 핸들러 (PARALLEL 태스크 제외)
    function onDragEnd() {
        var items = orderedContainer.querySelectorAll('.schedule-task-item[data-task-id]');
        var taskIds = [];
        items.forEach(function(item) {
            // PARALLEL 태스크는 drag-handle이 없으므로 제외
            if (!item.querySelector('.drag-handle')) return;
            taskIds.push(parseInt(item.getAttribute('data-task-id')));
        });
        if (taskIds.length === 0) return;
        reorderAssigneeTasks(memberId, taskIds);
    }

    // 순서 지정 리스트 (드래그 정렬 + 미지정 리스트에서 받기)
    if (orderedContainer) {
        _scheduleSortableOrdered = new Sortable(orderedContainer, {
            group: 'schedule-queue',
            handle: '.drag-handle',
            draggable: '.schedule-task-item',
            filter: 'input[type="checkbox"]',
            preventOnFilter: false,
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            forceFallback: true,
            onEnd: onDragEnd
        });
    }

    // 순서 미지정 리스트 (순서 지정 리스트로 보내기)
    if (unorderedContainer) {
        _scheduleSortableUnordered = new Sortable(unorderedContainer, {
            group: 'schedule-queue',
            handle: '.drag-handle',
            draggable: '.schedule-task-item',
            filter: 'input[type="checkbox"]',
            preventOnFilter: false,
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            forceFallback: true,
            onEnd: onDragEnd
        });
    }
}

/**
 * 스케줄 큐 선택 개수 업데이트
 */
function updateScheduleSelectedCount() {
    var checked = document.querySelectorAll('#schedule-queue-panel .schedule-task-checkbox:checked');
    var countEl = document.getElementById('schedule-selected-count');
    var deleteBtn = document.getElementById('schedule-batch-delete-btn');
    if (countEl) countEl.textContent = checked.length;
    if (deleteBtn) deleteBtn.disabled = (checked.length === 0);
    // 전체 선택 체크박스 상태 동기화
    var allCbs = document.querySelectorAll('#schedule-queue-panel .schedule-task-checkbox');
    var selectAllCb = document.getElementById('schedule-select-all');
    if (selectAllCb) {
        selectAllCb.checked = allCbs.length > 0 && checked.length === allCbs.length;
    }
}

/**
 * 선택된 태스크 일괄 삭제
 */
var batchDeleteInProgress = false;
async function batchDeleteSelectedTasks(memberId) {
    if (batchDeleteInProgress) return;
    var checked = document.querySelectorAll('#schedule-queue-panel .schedule-task-checkbox:checked');
    if (checked.length === 0) return;
    if (!confirmAction(checked.length + '개 태스크를 삭제하시겠습니까?')) return;

    batchDeleteInProgress = true;
    var taskIds = Array.from(checked).map(function(cb) { return parseInt(cb.value); });
    try {
        var res = await apiCall('/api/v1/tasks/batch-delete', 'POST', { taskIds: taskIds });
        if (res.success) {
            showToast(res.deleted + '개 태스크가 삭제되었습니다.', 'success');
            await selectScheduleMember(memberId, currentScheduleMemberName);
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('배치 삭제 실패:', e);
        showToast('태스크 삭제에 실패했습니다.', 'error');
    } finally {
        batchDeleteInProgress = false;
    }
}

// ========================================
// 태스크 모달 담당자 충돌 미리보기
// ========================================

/**
 * 담당자 충돌 사전 경고 체크
 * - 담당자, 시작일, 종료일이 모두 입력된 경우 해당 멤버의 기존 배정 태스크를 조회
 * - 날짜가 겹치는 태스크가 있으면 경고 표시
 * - PARALLEL 모드에서는 경고를 건너뜀
 */
async function checkAssigneeConflict() {
    var assigneeId = document.getElementById('task-assignee').value;
    var startDate = document.getElementById('task-start-date').value;
    var endDate = document.getElementById('task-end-date').value;
    var currentTaskId = document.getElementById('task-id').value;
    var executionMode = document.getElementById('task-execution-mode').value;
    var warningEl = document.getElementById('task-assignee-conflict-warning');

    // SEQUENTIAL 모드에서는 날짜가 자동 계산되므로 충돌 경고 비활성화
    // PARALLEL 모드에서는 다른 태스크와 충돌 검증 안 함
    if (executionMode === 'SEQUENTIAL' || executionMode === 'PARALLEL') {
        warningEl.style.display = 'none';
        warningEl.innerHTML = '';
        return;
    }

    // 필수 값이 모두 입력되지 않은 경우 경고 숨김
    if (!assigneeId || !startDate || !endDate) {
        warningEl.style.display = 'none';
        warningEl.innerHTML = '';
        return;
    }

    try {
        var res = await apiCall('/api/v1/members/' + assigneeId + '/tasks');
        if (!res.success || !res.data) {
            warningEl.style.display = 'none';
            return;
        }

        var tasks = res.data;
        var conflicts = [];

        tasks.forEach(function(task) {
            // 자기 자신 제외 (수정 시)
            if (currentTaskId && task.id === parseInt(currentTaskId)) return;

            // PARALLEL 모드 태스크는 충돌 대상에서 제외
            if (task.executionMode === 'PARALLEL') return;

            // 날짜 겹침 검사: task.startDate <= endDate AND task.endDate >= startDate
            if (task.startDate <= endDate && task.endDate >= startDate) {
                conflicts.push(task);
            }
        });

        if (conflicts.length > 0) {
            // 담당자 이름 가져오기
            var assigneeSelect = document.getElementById('task-assignee');
            var assigneeName = assigneeSelect.options[assigneeSelect.selectedIndex].text.split(' (')[0];

            var html = '<div class="alert alert-warning mb-0 py-2 px-3" style="font-size:0.85rem;">';
            html += '<i class="bi bi-exclamation-triangle-fill"></i> <strong>배정 충돌 경고</strong><br>';
            conflicts.forEach(function(task) {
                var sDate = task.startDate ? task.startDate.substring(5).replace('-', '/') : '';
                var eDate = task.endDate ? task.endDate.substring(5).replace('-', '/') : '';
                html += escapeHtml(assigneeName) + '님은 [' + escapeHtml(task.projectName) + '] \'' + escapeHtml(task.name) + '\' (' + sDate + ' ~ ' + eDate + ') 태스크가 이미 배정되어 있습니다.<br>';
            });
            html += '</div>';
            warningEl.innerHTML = html;
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
            warningEl.innerHTML = '';
        }
    } catch (e) {
        console.error('담당자 충돌 확인 실패:', e);
        warningEl.style.display = 'none';
    }
}

/**
 * 태스크 모달 충돌 미리보기 이벤트 바인딩
 */
function initAssigneeConflictCheck() {
    var assigneeSelect = document.getElementById('task-assignee');
    var startDateInput = document.getElementById('task-start-date');
    var endDateInput = document.getElementById('task-end-date');
    var executionModeSelect = document.getElementById('task-execution-mode');
    var manDaysInput = document.getElementById('task-man-days');

    if (assigneeSelect) {
        assigneeSelect.addEventListener('change', async function() {
            checkAssigneeConflict();
            updateTaskDateFieldsVisibility();
            triggerDatePreview();
            // 담당자 변경 시 개인 휴가 반영하여 flatpickr 재초기화
            var selectedAssigneeId = this.value;
            if (selectedAssigneeId) {
                var memberLeaves = await loadMemberLeaveDatesCache(parseInt(selectedAssigneeId));
                initTaskStartDatePicker(memberLeaves);
            } else {
                initTaskStartDatePicker({});
            }
        });
    }
    if (startDateInput) {
        startDateInput.addEventListener('change', function() {
            checkAssigneeConflict();
            triggerDatePreview();
        });
    }
    if (endDateInput) {
        endDateInput.addEventListener('change', checkAssigneeConflict);
    }
    if (executionModeSelect) {
        executionModeSelect.addEventListener('change', function() {
            checkAssigneeConflict();
            updateTaskDateFieldsVisibility();
            triggerDatePreview();
        });
    }
    if (manDaysInput) {
        manDaysInput.addEventListener('input', function() {
            triggerDatePreview();
        });
    }

    // 의존관계 체크박스 변경 시 프리뷰 (이벤트 위임)
    var depsContainer = document.getElementById('task-dependencies-checklist');
    if (depsContainer) {
        depsContainer.addEventListener('change', function(e) {
            if (e.target && e.target.classList.contains('task-dep-checkbox')) {
                triggerDatePreview();
            }
        });
    }
}

/**
 * 실행 모드에 따른 날짜 필드 표시/숨김 처리
 */
function updateTaskDateFieldsVisibility() {
    var executionMode = document.getElementById('task-execution-mode').value;
    var assigneeId = document.getElementById('task-assignee').value;
    var startDateGroup = document.getElementById('task-start-date-group');
    var endDateGroup = document.getElementById('task-end-date-group');
    var startDateInput = document.getElementById('task-start-date');
    var endDateInput = document.getElementById('task-end-date');
    var autoDateInfo = document.getElementById('task-auto-date-info');
    var autoDateMsg = document.getElementById('task-auto-date-message');

    // 시작일은 항상 편집 가능
    startDateGroup.style.display = '';
    endDateGroup.style.display = '';

    if (executionMode === 'PARALLEL') {
        // PARALLEL 모드: 시작일/종료일 직접 입력
        endDateInput.readOnly = false;
        startDateInput.required = true;
        endDateInput.required = true;
        autoDateInfo.style.display = 'none';
        isFirstTask = true;
    } else {
        // SEQUENTIAL 모드: 종료일은 항상 읽기 전용
        endDateInput.readOnly = true;
        endDateInput.required = false;

        if (!assigneeId) {
            startDateInput.required = true;
            autoDateInfo.style.display = 'none';
            isFirstTask = true;
        } else if (isFirstTask) {
            startDateInput.required = true;
            autoDateInfo.style.display = 'block';
            autoDateMsg.textContent = '시작일을 입력하면 종료일이 공수 기반으로 자동 계산됩니다.';
        } else {
            startDateInput.required = false;
            autoDateInfo.style.display = 'block';
            autoDateMsg.textContent = '시작일 미입력 시 선행 태스크 기준으로 자동 계산됩니다.';
        }
    }
}

/**
 * 날짜 프리뷰 API 호출 (디바운스 500ms)
 */
function triggerDatePreview() {
    if (previewDebounceTimer) {
        clearTimeout(previewDebounceTimer);
    }
    previewDebounceTimer = setTimeout(function() {
        fetchDatePreview();
    }, 500);
}

/**
 * 날짜 프리뷰 API 실제 호출
 */
async function fetchDatePreview() {
    var executionMode = document.getElementById('task-execution-mode').value;
    var assigneeId = document.getElementById('task-assignee').value;
    var manDaysVal = document.getElementById('task-man-days').value;
    var manDays = manDaysVal ? parseFloat(manDaysVal) : null;

    // 비가용일 캐시 보장
    await loadHolidayDatesCache();
    if (assigneeId) {
        await loadMemberLeaveDatesCache(parseInt(assigneeId));
    }

    // PARALLEL 모드: 시작일 + 공수로 종료일 클라이언��� 측 계산
    if (executionMode === 'PARALLEL') {
        var startDate = document.getElementById('task-start-date').value;
        if (startDate && manDays && manDays > 0) {
            var capacity = getSelectedAssigneeCapacity();
            document.getElementById('task-end-date').value = calculateEndDateClient(startDate, manDays, capacity);
        }
        return;
    }

    // SEQUENTIAL 모드: 서버 측 프리뷰 API 호출
    if (!assigneeId) return;

    var resolvedProjectId = currentModalProjectId || currentProjectId;
    if (!resolvedProjectId) return;

    var excludeTaskId = document.getElementById('task-id').value;

    // 의존관계 체크박스에서 선택된 ID 수집
    var dependsOnTaskIds = [];
    var depCheckboxes = document.querySelectorAll('#task-dependencies-checklist .task-dep-checkbox:checked');
    depCheckboxes.forEach(function(cb) {
        dependsOnTaskIds.push(parseInt(cb.value));
    });

    var body = {
        assigneeId: parseInt(assigneeId),
        manDays: manDays,
        dependsOnTaskIds: dependsOnTaskIds,
        excludeTaskId: excludeTaskId ? parseInt(excludeTaskId) : null
    };

    try {
        var res = await apiCall('/api/v1/projects/' + resolvedProjectId + '/tasks/preview-dates', 'POST', body);
        if (res.success && res.data) {
            isFirstTask = res.data.firstTask;

            // UI 업데이트
            updateTaskDateFieldsVisibility();

            // 프리뷰 날짜 표시
            if (!isFirstTask && res.data.startDate && !document.getElementById('task-start-date').value) {
                if (taskStartDatePicker) {
                    taskStartDatePicker.setDate(res.data.startDate, false);
                } else {
                    document.getElementById('task-start-date').value = res.data.startDate;
                }
            }
            // 종료일 계산
            var userStartDate = document.getElementById('task-start-date').value;
            if (manDays && manDays > 0) {
                // 사용자가 시작일을 수동 입력한 경우 → 클라이언트 측 계산 (시작일 기준)
                if (userStartDate) {
                    var capacity = getSelectedAssigneeCapacity();
                    document.getElementById('task-end-date').value = calculateEndDateClient(userStartDate, manDays, capacity);
                } else if (res.data.endDate) {
                    // 시작일 미입력 → 서버 계산 결과 사용
                    document.getElementById('task-end-date').value = res.data.endDate;
                }
            } else if (res.data.endDate) {
                document.getElementById('task-end-date').value = res.data.endDate;
            }
        }
    } catch (e) {
        console.error('날짜 프리뷰 실패:', e);
    }
}

/**
 * 선택된 담당자의 capacity 조회
 * @returns {number} capacity (기본값 1.0)
 */
function getSelectedAssigneeCapacity() {
    var assigneeId = document.getElementById('task-assignee').value;
    if (!assigneeId) return 1.0;
    var id = parseInt(assigneeId);
    for (var i = 0; i < currentProjectMembers.length; i++) {
        if (currentProjectMembers[i].id === id) {
            return currentProjectMembers[i].capacity != null ? currentProjectMembers[i].capacity : 1.0;
        }
    }
    return 1.0;
}

/**
 * 클라이언트 측 종료일 간이 계산 (프리뷰용)
 * - 공수 기반 영업일 계산 (주말 제외)
 * - capacity 반영: actual_duration = ceil(MD / capacity)
 */
function calculateEndDateClient(startDateStr, manDays, capacity) {
    var effectiveCapacity = (capacity && capacity > 0) ? capacity : 1.0;
    var actualDuration = Math.ceil(manDays / effectiveCapacity);
    var businessDays = actualDuration;
    if (businessDays <= 0) {
        if (manDays > 0) {
            businessDays = 1;
        } else {
            return startDateStr;
        }
    }

    // 비가용일 캐시 참조 (공휴일 + 멤버 개인 휴무)
    var holidays = cachedHolidayDates || {};
    var assigneeId = document.getElementById('task-assignee').value;
    var memberLeaves = assigneeId ? (cachedMemberLeaveDates[parseInt(assigneeId)] || {}) : {};

    var d = new Date(startDateStr + 'T00:00:00');

    // 시작일이 비가용일이면 다음 가용일로 보정
    while (true) {
        var dow = d.getDay();
        if (dow === 0 || dow === 6) { d.setDate(d.getDate() + 1); continue; }
        var ds = formatDateObj(d);
        if (holidays[ds] || memberLeaves[ds]) { d.setDate(d.getDate() + 1); continue; }
        break;
    }

    var daysAdded = 1;

    while (daysAdded < businessDays) {
        d.setDate(d.getDate() + 1);
        var dow = d.getDay();
        if (dow === 0 || dow === 6) continue;
        var ds = formatDateObj(d);
        if (holidays[ds] || memberLeaves[ds]) continue;
        daysAdded++;
    }

    return formatDateObj(d);
}

// ========================================
// HTML 이스케이프 유틸
// ========================================

function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

/**
 * inline onclick 속성 내 JS 문자열 리터럴 이스케이프
 * escapeHtml 후 사용: escapeJsString(escapeHtml(name))
 * 백슬래시와 싱글쿼트를 이스케이프하여 XSS 방지
 */
function escapeJsString(text) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * URL 안전성 검증 (XSS 방지)
 * http:// 또는 https://로 시작하는 URL만 안전한 것으로 판단
 */
function isSafeUrl(url) {
    if (!url) return false;
    var lower = url.trim().toLowerCase();
    return lower.startsWith('http://') || lower.startsWith('https://');
}

/**
 * CSS 색상 값 검증 (XSS 방지)
 * 허용: #RGB, #RRGGBB, 영문 색상명
 */
function sanitizeColor(color) {
    if (!color) return '#ccc';
    if (/^#[0-9a-fA-F]{3,6}$/.test(color)) return color;
    if (/^[a-zA-Z]+$/.test(color)) return color;
    return '#ccc';
}

// ========================================
// 태스크 링크 관리 (동적 행 추가/삭제)
// ========================================

/**
 * 태스크 링크 행 추가
 * @param {string} label - 기존 라벨 값 (수정 시)
 * @param {string} url - 기존 URL 값 (수정 시)
 */
function addTaskLinkRow(label, url) {
    var container = document.getElementById('task-links-container');
    var currentCount = container.querySelectorAll('.task-link-row').length;

    if (currentCount >= 10) {
        showToast('링크는 최대 10개까지 추가할 수 있습니다.', 'warning');
        return;
    }

    var row = document.createElement('div');
    row.className = 'task-link-row d-flex gap-2 mb-2 align-items-center';
    var visitBtnHtml = url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="btn btn-outline-secondary btn-sm task-link-visit-btn" title="링크 열기"><i class="bi bi-box-arrow-up-right"></i></a>' : '<a class="btn btn-outline-secondary btn-sm task-link-visit-btn disabled" title="링크 열기"><i class="bi bi-box-arrow-up-right"></i></a>';
    row.innerHTML = '<input type="text" class="form-control form-control-sm task-link-label" placeholder="라벨" style="width:30%;" value="' + escapeHtml(label || '') + '">'
        + '<input type="url" class="form-control form-control-sm task-link-url" placeholder="URL (https://...)" style="flex:1;" value="' + escapeHtml(url || '') + '">'
        + visitBtnHtml
        + '<button type="button" class="btn btn-outline-danger btn-sm" onclick="removeTaskLinkRow(this)" title="삭제"><i class="bi bi-x-lg"></i></button>';

    // URL 입력 변경 시 방문 버튼 업데이트
    var urlInput = row.querySelector('.task-link-url');
    urlInput.addEventListener('input', function() {
        var visitBtn = row.querySelector('.task-link-visit-btn');
        var val = urlInput.value.trim();
        if (val && isSafeUrl(val)) {
            visitBtn.href = val;
            visitBtn.target = '_blank';
            visitBtn.rel = 'noopener noreferrer';
            visitBtn.classList.remove('disabled');
        } else {
            visitBtn.removeAttribute('href');
            visitBtn.removeAttribute('target');
            visitBtn.classList.add('disabled');
        }
    });

    container.appendChild(row);
    updateAddLinkBtnState();
}

/**
 * 태스크 링크 행 삭제
 */
function removeTaskLinkRow(btn) {
    btn.closest('.task-link-row').remove();
    updateAddLinkBtnState();
}

/**
 * 링크 추가 버튼 상태 업데이트 (10개 제한)
 */
function updateAddLinkBtnState() {
    var container = document.getElementById('task-links-container');
    var addBtn = document.getElementById('task-add-link-btn');
    if (!container || !addBtn) return;
    var currentCount = container.querySelectorAll('.task-link-row').length;
    addBtn.disabled = currentCount >= 10;
}

// ========================================
// 색상 피커 이벤트
// ========================================

function initColorPicker() {
    var colorInput = document.getElementById('ds-color');
    if (colorInput) {
        colorInput.addEventListener('input', function() {
            document.getElementById('ds-color-label').textContent = this.value;
        });
    }
}

// ========================================
// 담당자 태스크 순서 변경 API
// ========================================

/**
 * 담당자 태스크 순서 변경 API 호출
 */
async function reorderAssigneeTasks(assigneeId, taskIds) {
    try {
        var body = {
            assigneeId: assigneeId,
            taskIds: taskIds
        };
        var res = await apiCall('/api/v1/tasks/assignee-order', 'PATCH', body);

        if (res.success) {
            showToast('태스크 순서가 변경되었습니다.', 'success');
            // 멤버별 태스크 새로고침
            if (currentScheduleMemberId) {
                await selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
            }
        } else {
            showToast(res.message || '순서 변경에 실패했습니다.', 'error');
            if (currentScheduleMemberId) {
                await selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
            }
        }
    } catch (e) {
        console.error('태스크 순서 변경 실패:', e);
        showToast('태스크 순서 변경에 실패했습니다.', 'error');
        if (currentScheduleMemberId) {
            await selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
        }
    }
}

// ========================================
// Dashboard 경고 요약
// ========================================

/**
 * 대시보드 경고 요약 렌더링
 * @param {object} data - 이미 로드된 경고 데이터 (없으면 API 호출)
 */
/**
 * 경고 배지 갱신 (상단 바 + 사이드바)
 */
function updateWarningBadges(data) {
    var total = data ? (data.totalWarnings || 0) : 0;

    var topbarBadge = document.getElementById('topbar-warning-badge');
    var sidebarBadge = document.getElementById('sidebar-warning-count');

    if (total > 0) {
        if (topbarBadge) {
            topbarBadge.textContent = total;
            topbarBadge.style.display = '';
        }
        if (sidebarBadge) {
            sidebarBadge.textContent = total;
            sidebarBadge.style.display = '';
        }
    } else {
        if (topbarBadge) topbarBadge.style.display = 'none';
        if (sidebarBadge) sidebarBadge.style.display = 'none';
    }
}

// ========================================
// 경고 센터
// ========================================

/**
 * 경고 센터 로드
 */
async function loadWarningCenter() {
    try {
        var results = await Promise.all([
            apiCall('/api/v1/warnings/summary'),
            apiCall('/api/v1/projects')
        ]);
        var warningsRes = results[0];
        var projectsRes = results[1];

        var data = (warningsRes.success && warningsRes.data) ? warningsRes.data : {};
        var projects = (projectsRes.success && projectsRes.data) ? projectsRes.data : [];

        allWarningsData = data.warnings || [];

        // 경고 배지 갱신
        updateWarningBadges(data);

        // 프로젝트 필터 드롭다운
        var projectSelect = document.getElementById('wc-filter-project');
        var wcOptHtml = '<option value="">전체 프로젝트</option>';
        projects.forEach(function(p) {
            wcOptHtml += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
        });
        projectSelect.innerHTML = wcOptHtml;

        // 요약 카드
        var summaryEl = document.getElementById('warning-summary-cards');
        var summaryItems = [
            { label: '순서 미지정', count: data.unorderedCount || 0, icon: 'bi-sort-numeric-down', color: 'warning' },
            { label: '시작일 누락', count: data.missingStartDateCount || 0, icon: 'bi-calendar-x', color: 'danger' },
            { label: '일정 충돌', count: data.scheduleConflictCount || 0, icon: 'bi-exclamation-triangle', color: 'danger' },
            { label: '마감 초과', count: data.deadlineExceededCount || 0, icon: 'bi-alarm', color: 'danger' },
            { label: '의존성 문제', count: data.dependencyIssueCount || 0, icon: 'bi-link-45deg', color: 'warning' },
            { label: '고아 태스크', count: data.orphanTaskCount || 0, icon: 'bi-person-x', color: 'warning' },
            { label: '의존성 비활성', count: data.dependencyRemovedCount || 0, icon: 'bi-trash', color: 'secondary' },
            { label: '비가용일', count: data.unavailableDateCount || 0, icon: 'bi-calendar-event', color: 'info' }
        ];
        var sHtml = '';
        summaryItems.forEach(function(item) {
            sHtml += '<div class="col-md-3 mb-2">';
            sHtml += '<div class="card"><div class="card-body py-2 px-3 d-flex align-items-center gap-2">';
            sHtml += '<i class="bi ' + item.icon + ' text-' + item.color + '"></i>';
            sHtml += '<span style="font-size:0.85rem;">' + item.label + '</span>';
            sHtml += '<span class="badge bg-' + item.color + ' ms-auto">' + item.count + '</span>';
            sHtml += '</div></div>';
            sHtml += '</div>';
        });
        summaryEl.innerHTML = sHtml;

        // 경고 목록 렌더링
        renderWarningList(allWarningsData);

    } catch (e) {
        console.error('경고 센터 로드 실패:', e);
        showToast('경고 센터를 불러오는데 실패했습니다.', 'error');
    }
}

/**
 * 경고 목록 렌더링
 */
function renderWarningList(warnings) {
    var contentEl = document.getElementById('warning-list-content');

    if (!warnings || warnings.length === 0) {
        contentEl.innerHTML = '<div class="empty-state"><i class="bi bi-check-circle"></i><p>경고가 없습니다.</p></div>';
        return;
    }

    var html = '';
    warnings.forEach(function(w) {
        var severity = 'medium';
        if (w.type === 'SCHEDULE_CONFLICT' || w.type === 'DEADLINE_EXCEEDED' || w.type === 'MISSING_START_DATE') {
            severity = 'high';
        } else if (w.type === 'DEPENDENCY_REMOVED' || w.type === 'UNAVAILABLE_DATE') {
            severity = 'low';
        }

        html += '<div class="warning-item severity-' + severity + '">';
        html += '<div class="d-flex justify-content-between align-items-start">';
        html += '<div>';
        html += '<div>' + getWarningIcon(w.type) + ' <strong style="font-size:0.85rem;">' + getWarningTypeLabel(w.type) + '</strong></div>';
        html += '<div style="font-size:0.85rem;">' + escapeHtml(w.message);
        if (w.type === 'UNAVAILABLE_DATE' && w.assigneeId && w.assigneeName) {
            html += ' <a href="#" onclick="event.preventDefault(); showUnavailableDatesPopup(' + w.assigneeId + ', \'' + escapeJsString(escapeHtml(w.assigneeName)) + '\')" style="font-size:0.8rem;"><i class="bi bi-calendar-x"></i> 비가용일 확인</a>';
        }
        html += '</div>';
        html += '<div class="text-muted" style="font-size:0.78rem;">';
        if (w.projectName) html += '<i class="bi bi-folder"></i> ' + escapeHtml(w.projectName);
        if (w.taskName) html += ' | <i class="bi bi-list-task"></i> ' + escapeHtml(w.taskName);
        html += '</div>';
        html += '</div>';
        html += '<button class="btn btn-outline-primary btn-sm" onclick="resolveWarning(\'' + escapeHtml(w.type) + '\', ' + (w.taskId != null ? w.taskId : 'null') + ', ' + (w.projectId != null ? w.projectId : 'null') + ')" style="white-space:nowrap;">';
        html += '<i class="bi bi-arrow-right"></i> 해결';
        html += '</button>';
        html += '</div>';
        html += '</div>';
    });

    contentEl.innerHTML = html;
}

/**
 * 경고 해결 버튼 클릭
 */
function resolveWarning(type, taskId, projectId) {
    switch (type) {
        case 'UNORDERED_TASK':
        case 'MISSING_START_DATE':
        case 'SCHEDULE_CONFLICT':
            showSection('assignee-schedule');
            break;
        case 'DEPENDENCY_ISSUE':
        case 'ORPHAN_TASK':
        case 'DEPENDENCY_REMOVED':
            if (taskId && projectId) {
                showTaskModal(taskId, projectId);
            }
            break;
        case 'DEADLINE_EXCEEDED':
            if (projectId) {
                showProjectDetail(projectId, 'tasks');
            }
            break;
        case 'UNAVAILABLE_DATE':
            if (taskId && projectId) {
                showTaskModal(taskId, projectId);
            }
            break;
        default:
            if (taskId && projectId) {
                showTaskDetail(taskId, { projectId: projectId });
            }
            break;
    }
}

/**
 * 경고 목록 필터
 */
function filterWarningList() {
    if (!allWarningsData) return;

    var projectFilter = document.getElementById('wc-filter-project').value;
    var typeFilter = document.getElementById('wc-filter-type').value;

    var filtered = allWarningsData.filter(function(w) {
        if (projectFilter && String(w.projectId) !== String(projectFilter)) return false;
        if (typeFilter && w.type !== typeFilter) return false;
        return true;
    });

    renderWarningList(filtered);
}

// ========================================
// Holidays (공휴일/회사휴무) 관리
// ========================================

/**
 * 설정 섹션 초기 로드 (공휴일 + 멤버 드롭다운)
 */
async function loadSettingsSection() {
    // 연도 필터 초기화
    var yearSelect = document.getElementById('holiday-filter-year');
    var currentYear = new Date().getFullYear();
    yearSelect.innerHTML = '';
    for (var y = currentYear - 1; y <= currentYear + 2; y++) {
        var selected = (y === currentYear) ? 'selected' : '';
        yearSelect.innerHTML += '<option value="' + y + '" ' + selected + '>' + y + '년</option>';
    }

    // 멤버 드롭다운 로드
    try {
        var res = await apiCall('/api/v1/members');
        var members = (res.success && res.data) ? res.data : [];
        var select = document.getElementById('leave-member-select');
        var leaveOptHtml = '<option value="">멤버를 선택하세요</option>';
        members.forEach(function(m) {
            leaveOptHtml += '<option value="' + m.id + '">' + escapeHtml(m.name) + ' (' + m.role + ')</option>';
        });
        select.innerHTML = leaveOptHtml;
    } catch (e) {
        console.error('멤버 목록 로드 실패:', e);
    }

    await loadMembers();

    // Jira 설정 로드 (cachedJiraBaseUrl 초기화)
    await loadJiraConfig();
}

// ========================================
// 데이터 내보내기/가져오기 (Export/Import)
// ========================================

/**
 * Export: 전체 DB 데이터를 JSON 파일로 다운로드
 */
async function exportData() {
    try {
        var response = await fetch('/api/v1/data/export');
        if (!response.ok) throw new Error('Export 실패');
        var blob = await response.blob();
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'timeline-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        window.URL.revokeObjectURL(url);
        showToast('데이터 내보내기가 완료되었습니다.', 'success');
    } catch (e) {
        showToast('내보내기에 실패했습니다.', 'error');
    }
}

/**
 * Import 파일 선택 시 미리보기 (파일명 표시, 확인 모달 오픈)
 */
function onImportFileSelected(event) {
    var file = event.target.files[0];
    if (!file) return;
    // 파일 확장자 검증
    if (!file.name.toLowerCase().endsWith('.json')) {
        showToast('JSON 파일만 업로드할 수 있습니다.', 'warning');
        event.target.value = '';
        return;
    }
    // 파일 크기 검증 (50MB)
    if (file.size > 50 * 1024 * 1024) {
        showToast('파일 크기가 50MB를 초과합니다.', 'warning');
        event.target.value = '';
        return;
    }
    pendingImportFile = file;
    document.getElementById('import-file-name').textContent = '선택된 파일: ' + file.name;
    var sizeText = file.size >= 1024 * 1024
        ? (file.size / (1024 * 1024)).toFixed(1) + ' MB'
        : (file.size / 1024).toFixed(1) + ' KB';
    document.getElementById('import-preview-info').textContent =
        '파일: ' + file.name + ' (' + sizeText + ')';
    var modal = new bootstrap.Modal(document.getElementById('importConfirmModal'));
    modal.show();
    // 파일 input 초기화 (같은 파일 재선택 허용)
    event.target.value = '';
}

/**
 * Import 확인 모달에서 "가져오기 실행" 클릭
 */
var importInProgress = false;
async function confirmImport() {
    if (!pendingImportFile || importInProgress) return;
    importInProgress = true;
    var formData = new FormData();
    formData.append('file', pendingImportFile);
    bootstrap.Modal.getInstance(document.getElementById('importConfirmModal')).hide();
    showToast('데이터를 가져오는 중입니다...', 'info');
    try {
        var response = await fetch('/api/v1/data/import', { method: 'POST', body: formData });
        if (!response.ok) {
            var res = null;
            try { res = await response.json(); } catch (ignored) {}
            var msg = (res && res.message) ? res.message : '서버 오류 (HTTP ' + response.status + ')';
            showToast('Import 실패: ' + msg, 'error');
            return;
        }
        var res = await response.json();
        if (res.success) {
            showToast('Import 완료: ' + res.message, 'success');
            setTimeout(function() { location.reload(); }, 800);
        } else {
            showToast('Import 실패: ' + (res.message || '알 수 없는 오류'), 'error');
        }
    } catch (e) {
        showToast('Import 중 오류가 발생했습니다.', 'error');
    } finally {
        importInProgress = false;
        pendingImportFile = null;
        document.getElementById('import-file-name').textContent = '';
    }
}

// ========================================
// Jira 연동 설정 및 Import
// ========================================

/**
 * Jira 설정 로드: GET /api/v1/jira/config
 * cachedJiraBaseUrl 전역 변수도 설정
 */
async function loadJiraConfig() {
    try {
        var res = await apiCall('/api/v1/jira/config');
        if (res.success && res.data) {
            var cfg = res.data;
            cachedJiraBaseUrl = cfg.baseUrl || null;
            document.getElementById('jira-base-url').value = cfg.baseUrl || '';
            document.getElementById('jira-email').value = cfg.email || '';
            document.getElementById('jira-api-token').value = '';
            document.getElementById('jira-api-token').placeholder = cfg.apiTokenMasked || 'ATATT3xFfGF0...';
            document.getElementById('jira-delete-btn').style.display = '';
            // 현재 설정 요약
            var summaryEl = document.getElementById('jira-config-summary');
            var html = '<table class="table table-sm mb-0">';
            html += '<tr><th style="width:30%">URL</th><td>' + escapeHtml(cfg.baseUrl || '-') + '</td></tr>';
            html += '<tr><th>이메일</th><td>' + escapeHtml(cfg.email || '-') + '</td></tr>';
            html += '<tr><th>API Token</th><td>' + escapeHtml(cfg.apiTokenMasked || '-') + '</td></tr>';
            html += '</table>';
            summaryEl.innerHTML = html;
        } else {
            cachedJiraBaseUrl = null;
            document.getElementById('jira-delete-btn').style.display = 'none';
            document.getElementById('jira-config-summary').innerHTML = '<p class="text-muted">설정이 없습니다.</p>';
        }
    } catch (e) {
        console.error('Jira 설정 로드 실패:', e);
        cachedJiraBaseUrl = null;
    }
}

/**
 * Jira 설정 저장: PUT /api/v1/jira/config
 */
async function saveJiraConfig() {
    var baseUrl = document.getElementById('jira-base-url').value.trim();
    var email = document.getElementById('jira-email').value.trim();
    var apiToken = document.getElementById('jira-api-token').value.trim();

    if (!baseUrl || !email) {
        showToast('Jira URL과 이메일은 필수입니다.', 'warning');
        return;
    }

    var body = { baseUrl: baseUrl, email: email };
    if (apiToken) {
        body.apiToken = apiToken;
    }

    try {
        var res = await apiCall('/api/v1/jira/config', 'PUT', body);
        if (res.success) {
            showToast('Jira 설정이 저장되었습니다.', 'success');
            await loadJiraConfig();
        } else {
            showToast('저장 실패: ' + (res.message || '알 수 없는 오류'), 'error');
        }
    } catch (e) {
        showToast('Jira 설정 저장 중 오류가 발생했습니다.', 'error');
    }
}

/**
 * Jira 연결 테스트: POST /api/v1/jira/config/test
 */
async function testJiraConnection() {
    var resultEl = document.getElementById('jira-test-result');
    var testBtn = document.getElementById('jira-test-btn');

    var baseUrl = document.getElementById('jira-base-url').value.trim();
    var email = document.getElementById('jira-email').value.trim();
    var apiToken = document.getElementById('jira-api-token').value.trim();

    if (!baseUrl || !email) {
        showToast('Jira URL과 이메일을 입력해주세요.', 'warning');
        return;
    }

    testBtn.disabled = true;
    resultEl.style.display = '';
    resultEl.innerHTML = '<span class="text-muted"><i class="bi bi-hourglass-split"></i> 연결 테스트 중...</span>';

    try {
        var body = { baseUrl: baseUrl, email: email };
        if (apiToken) {
            body.apiToken = apiToken;
        }
        var res = await apiCall('/api/v1/jira/config/test', 'POST', body);
        if (res.success) {
            var msg = res.data && res.data.message ? res.data.message : '연결 성공';
            resultEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill"></i> ' + escapeHtml(msg) + '</span>';
        } else {
            resultEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle-fill"></i> 연결 실패: ' + escapeHtml(res.message || '알 수 없는 오류') + '</span>';
        }
    } catch (e) {
        resultEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle-fill"></i> 연결 테스트 중 오류가 발생했습니다.</span>';
    } finally {
        testBtn.disabled = false;
    }
}

/**
 * Jira 설정 삭제: DELETE /api/v1/jira/config
 */
async function deleteJiraConfig() {
    if (!confirmAction('Jira 연동 설정을 삭제하시겠습니까?')) return;
    try {
        var res = await apiCall('/api/v1/jira/config', 'DELETE');
        if (res.success) {
            showToast('Jira 설정이 삭제되었습니다.', 'success');
            cachedJiraBaseUrl = null;
            document.getElementById('jira-base-url').value = '';
            document.getElementById('jira-email').value = '';
            document.getElementById('jira-api-token').value = '';
            document.getElementById('jira-api-token').placeholder = 'ATATT3xFfGF0...';
            document.getElementById('jira-delete-btn').style.display = 'none';
            document.getElementById('jira-config-summary').innerHTML = '<p class="text-muted">설정이 없습니다.</p>';
            document.getElementById('jira-test-result').style.display = 'none';
        } else {
            showToast('삭제 실패: ' + (res.message || '알 수 없는 오류'), 'error');
        }
    } catch (e) {
        showToast('Jira 설정 삭제 중 오류가 발생했습니다.', 'error');
    }
}

/**
 * Jira Import 모달 열기: 필터 설정 화면만 표시 (API 호출 없음)
 */
var _jiraImportProjects = []; // 프로젝트 목록 캐시 (import 모달용)

// ---- Jira Space Import ----

async function showJiraSpaceImportModal() {
    document.getElementById('jira-space-filter').style.display = '';
    document.getElementById('jira-space-loading').style.display = 'none';
    document.getElementById('jira-space-preview').style.display = 'none';
    document.getElementById('jira-space-result').style.display = 'none';
    document.getElementById('jira-space-error-msg').style.display = 'none';
    var execBtn = document.getElementById('jira-space-exec-btn');
    execBtn.style.display = 'none';
    execBtn.disabled = false;
    execBtn.innerHTML = '<i class="bi bi-cloud-download"></i> 가져오기 실행';
    document.getElementById('jira-space-project-key').value = '';
    document.getElementById('jira-space-created-after').value = '';
    document.getElementById('jira-space-status-todo').checked = true;
    document.getElementById('jira-space-status-inprogress').checked = false;
    document.getElementById('jira-space-status-done').checked = false;
    document.getElementById('jira-space-status-all').checked = false;

    // 프로젝트 목록
    try {
        var res = await apiCall('/api/v1/projects');
        var allProj = (res.success && res.data) ? res.data : [];
        _jiraImportProjects = allProj.filter(function(p) { return p.status === 'PLANNING' || p.status === 'IN_PROGRESS'; });
        var sel = document.getElementById('jira-space-default-project');
        sel.innerHTML = '<option value="">선택...</option>';
        _jiraImportProjects.forEach(function(p) {
            sel.innerHTML += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
        });
    } catch (e) { _jiraImportProjects = []; }

    new bootstrap.Modal(document.getElementById('jiraSpaceImportModal')).show();
}

async function startJiraSpacePreview() {
    var isEpic = document.getElementById('jira-space-source-epic').checked;
    var projectKey = document.getElementById('jira-space-project-key').value.trim();
    var epicKey = document.getElementById('jira-space-epic-key').value.trim();
    var createdAfter = document.getElementById('jira-space-created-after').value;
    if (!isEpic && !projectKey) { showToast('Jira 프로젝트 키를 입력하세요.', 'warning'); return; }
    if (isEpic && !epicKey) { showToast('Epic 키를 입력하세요.', 'warning'); return; }
    if (!createdAfter) { showToast('생성일자 필터를 입력하세요.', 'warning'); return; }

    var statusFilter = [];
    if (!document.getElementById('jira-space-status-all').checked) {
        document.querySelectorAll('.jira-space-status-cb:checked').forEach(function(cb) { statusFilter.push(cb.value); });
    }

    document.getElementById('jira-space-filter').style.display = 'none';
    document.getElementById('jira-space-loading').style.display = '';

    try {
        var body = {
            createdAfter: createdAfter,
            statusFilter: statusFilter.length > 0 ? statusFilter : null
        };
        if (isEpic) body.jiraEpicKey = epicKey;
        else body.jiraProjectKey = projectKey;
        var res = await apiCall('/api/v1/jira/space/preview', 'POST', body);
        document.getElementById('jira-space-loading').style.display = 'none';

        if (!res.success) {
            document.getElementById('jira-space-filter').style.display = '';
            document.getElementById('jira-space-error-msg').style.display = '';
            document.getElementById('jira-space-error-msg').textContent = res.message || '미리보기 실패';
            return;
        }

        var preview = res.data;
        document.getElementById('jira-space-create').textContent = preview.toCreate || 0;
        document.getElementById('jira-space-update').textContent = preview.toUpdate || 0;
        document.getElementById('jira-space-total').textContent = preview.totalIssues || 0;

        // 프로젝트 옵션 (빈 값 포함)
        var projectOptionsWithEmpty = '<option value="">-- 선택 --</option>';
        var projectOptionsMap = {};
        _jiraImportProjects.forEach(function(p) {
            projectOptionsWithEmpty += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
            projectOptionsMap[p.id] = true;
        });

        var tbody = document.getElementById('jira-space-table');
        var html = '';
        var issues = preview.issues || [];
        if (issues.length > 0) {
            issues.forEach(function(item) {
                var badge = item.action === 'CREATE' ? '<span class="badge bg-success">생성</span>'
                    : item.action === 'UPDATE' ? '<span class="badge bg-warning text-dark">업데이트</span>'
                    : '<span class="badge bg-secondary">스킵</span>';
                var importable = (item.action === 'CREATE' || item.action === 'UPDATE');
                var key = escapeHtml(item.jiraKey || '');
                html += '<tr>';
                html += '<td><input type="checkbox" class="jira-sp-cb" value="' + key + '"' + (importable ? ' checked' : ' disabled') + ' onchange="updateJiraSpaceSelectedCount()"></td>';
                html += '<td><code>' + key + '</code></td>';
                html += '<td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + escapeHtml(item.summary || '') + '">' + escapeHtml(item.summary || '') + '</td>';
                html += '<td>' + badge + '</td>';
                html += '<td>' + escapeHtml(item.mappedStatus || '') + '</td>';
                html += '<td>' + escapeHtml(item.mappedAssigneeName || item.jiraAssignee || '-') + '</td>';
                html += '<td><select class="form-select form-select-sm jira-sp-project" data-jira-key="' + key + '" data-existing-pid="' + (item.existingProjectId || '') + '" style="font-size:0.75rem; padding:2px 4px; min-width:120px;">' + projectOptionsWithEmpty + '</select></td>';
                html += '</tr>';
            });
        } else {
            html = '<tr><td colspan="7" class="text-center text-muted">가져올 이슈가 없습니다.</td></tr>';
        }
        tbody.innerHTML = html;
        document.getElementById('jira-space-preview').style.display = '';
        document.getElementById('jira-space-select-all').checked = true;

        // UPDATE 이슈: 기존 프로젝트 자동 선택, CREATE 이슈: 기본 프로젝트 선택
        var defaultPid = document.getElementById('jira-space-default-project').value;
        document.querySelectorAll('.jira-sp-project').forEach(function(sel) {
            var existingPid = sel.getAttribute('data-existing-pid');
            if (existingPid && projectOptionsMap[existingPid]) {
                sel.value = existingPid;
            } else if (defaultPid) {
                sel.value = defaultPid;
            }
        });
        if ((preview.toCreate || 0) + (preview.toUpdate || 0) > 0) {
            document.getElementById('jira-space-exec-btn').style.display = '';
        }
    } catch (e) {
        document.getElementById('jira-space-loading').style.display = 'none';
        document.getElementById('jira-space-filter').style.display = '';
        document.getElementById('jira-space-error-msg').style.display = '';
        document.getElementById('jira-space-error-msg').textContent = 'Jira Space 조회 중 오류가 발생했습니다.';
    }
}

function updateJiraSpaceSelectedCount() {
    var checked = document.querySelectorAll('#jira-space-table .jira-sp-cb:checked').length;
    document.getElementById('jira-space-exec-btn').style.display = checked > 0 ? '' : 'none';
}

async function executeJiraSpaceImport() {
    var execBtn = document.getElementById('jira-space-exec-btn');
    if (execBtn.disabled) return;
    execBtn.disabled = true;
    execBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 가져오는 중...';

    var isEpic = document.getElementById('jira-space-source-epic').checked;
    var projectKey = document.getElementById('jira-space-project-key').value.trim();
    var epicKey = document.getElementById('jira-space-epic-key').value.trim();
    var createdAfter = document.getElementById('jira-space-created-after').value;
    var defaultProjVal = document.getElementById('jira-space-default-project').value;
    var defaultProjectId = defaultProjVal ? parseInt(defaultProjVal) : null;

    var statusFilter = [];
    if (!document.getElementById('jira-space-status-all').checked) {
        document.querySelectorAll('.jira-space-status-cb:checked').forEach(function(cb) { statusFilter.push(cb.value); });
    }

    var selectedKeys = [];
    var issueProjectMap = {};
    document.querySelectorAll('#jira-space-table .jira-sp-cb:checked').forEach(function(cb) {
        var key = cb.value;
        selectedKeys.push(key);
        var sel = cb.closest('tr').querySelector('.jira-sp-project');
        if (sel && sel.value) {
            var pid = parseInt(sel.value);
            if (!isNaN(pid) && pid !== defaultProjectId) issueProjectMap[key] = pid;
        }
    });

    try {
        var importBody = {
            createdAfter: createdAfter,
            statusFilter: statusFilter.length > 0 ? statusFilter : null,
            defaultProjectId: defaultProjectId,
            selectedKeys: selectedKeys,
            issueProjectMap: Object.keys(issueProjectMap).length > 0 ? issueProjectMap : null
        };
        if (isEpic) importBody.jiraEpicKey = epicKey;
        else importBody.jiraProjectKey = projectKey;
        var res = await apiCall('/api/v1/jira/space/import', 'POST', importBody);

        document.getElementById('jira-space-preview').style.display = 'none';
        execBtn.style.display = 'none';

        if (res.success && res.data) {
            var r = res.data;
            document.getElementById('jira-space-result-summary').innerHTML = '<strong>Import 완료!</strong><br>생성: ' + (r.created||0) + '건, 업데이트: ' + (r.updated||0) + '건, 스킵: ' + (r.skipped||0) + '건';
            document.getElementById('jira-space-result').style.display = '';
            if (r.errors && r.errors.length > 0) {
                var errHtml = '';
                r.errors.forEach(function(e) { errHtml += '<li><strong>' + escapeHtml(e.jiraKey||'') + '</strong>: ' + escapeHtml(e.reason||'') + '</li>'; });
                document.getElementById('jira-space-error-list').innerHTML = errHtml;
                document.getElementById('jira-space-result-errors').style.display = '';
            }
            showToast('Jira Space 이슈 가져오기 완료', 'success');
            loadProjects();
        } else {
            document.getElementById('jira-space-error-msg').style.display = '';
            document.getElementById('jira-space-error-msg').textContent = res.message || 'Import 실패';
            execBtn.style.display = '';
            execBtn.disabled = false;
            execBtn.innerHTML = '<i class="bi bi-cloud-download"></i> 가져오기 실행';
        }
    } catch (e) {
        document.getElementById('jira-space-error-msg').style.display = '';
        document.getElementById('jira-space-error-msg').textContent = 'Import 중 오류가 발생했습니다.';
        execBtn.style.display = '';
        execBtn.disabled = false;
        execBtn.innerHTML = '<i class="bi bi-cloud-download"></i> 가져오기 실행';
    }
}

function toggleJiraSpaceSource() {
    var isEpic = document.getElementById('jira-space-source-epic').checked;
    document.getElementById('jira-space-key-group').style.display = isEpic ? 'none' : '';
    document.getElementById('jira-space-epic-group').style.display = isEpic ? '' : 'none';
}

function toggleJiraImportSource() {
    var isEpic = document.getElementById('jira-import-source-epic').checked;
    document.getElementById('jira-import-epic-group').style.display = isEpic ? '' : 'none';
    document.getElementById('jira-import-board-group').style.display = isEpic ? 'none' : '';
}

// ---- Jira Board Import ----

async function showJiraImportModal(projectId) {
    if (!projectId) return;
    jiraImportProjectId = projectId;
    jiraPreviewCreatedAfter = null;
    jiraPreviewStatusFilter = [];
    jiraPreviewBoardId = null;

    // 모달 초기 상태: 필터 화면만 표시
    document.getElementById('jira-import-filter').style.display = '';
    document.getElementById('jira-import-loading').style.display = 'none';
    document.getElementById('jira-import-preview').style.display = 'none';
    document.getElementById('jira-import-result').style.display = 'none';
    document.getElementById('jira-import-error-msg').style.display = 'none';
    var execBtn = document.getElementById('jira-import-execute-btn');
    execBtn.style.display = 'none';
    execBtn.disabled = false;
    execBtn.innerHTML = '<i class="bi bi-cloud-download"></i> 가져오기 실행';
    document.getElementById('jira-filter-created-after').value = '';

    // 상태 필터 초기화: "To Do"만 체크
    document.getElementById('jira-filter-status-todo').checked = true;
    document.getElementById('jira-filter-status-inprogress').checked = false;
    document.getElementById('jira-filter-status-done').checked = false;
    document.getElementById('jira-filter-status-all').checked = false;

    // 프로젝트 목록 로드 + 현재 프로젝트의 Board ID / Epic Key 기본값 세팅
    var currentBoardId = '';
    var currentEpicKey = '';
    try {
        var projRes = await apiCall('/api/v1/projects');
        var allProj = (projRes.success && projRes.data) ? projRes.data : [];
        _jiraImportProjects = allProj.filter(function(p) { return p.status === 'PLANNING' || p.status === 'IN_PROGRESS'; });
        var currentProj = allProj.find(function(p) { return p.id === projectId; });
        if (currentProj) {
            if (currentProj.jiraBoardId) currentBoardId = currentProj.jiraBoardId;
            if (currentProj.jiraEpicKey) currentEpicKey = currentProj.jiraEpicKey;
        }
    } catch (e) { _jiraImportProjects = []; }

    // Epic Key 기본값 (프로젝트 설정값)
    document.getElementById('jira-import-epic-key').value = currentEpicKey;

    // Board ID 입력 초기화
    var boardIdInput = document.getElementById('jira-import-board-id');
    if (boardIdInput) boardIdInput.value = currentBoardId;

    // 검색 대상 라디오 초기화 (Epic 모드 기본)
    document.getElementById('jira-import-source-epic').checked = true;
    document.getElementById('jira-import-source-board').checked = false;
    toggleJiraImportSource();

    var modal = new bootstrap.Modal(document.getElementById('jiraImportModal'));
    modal.show();
}

function toggleJiraPreviewSelectAll(cb) {
    var checkboxes = document.querySelectorAll('#jira-preview-table .jira-issue-cb');
    checkboxes.forEach(function(c) { c.checked = cb.checked; });
    updateJiraPreviewSelectedCount();
}

function updateJiraPreviewSelectedCount() {
    var total = document.querySelectorAll('#jira-preview-table .jira-issue-cb').length;
    var checked = document.querySelectorAll('#jira-preview-table .jira-issue-cb:checked').length;
    var selectAll = document.getElementById('jira-preview-select-all');
    if (selectAll) selectAll.checked = (total > 0 && checked === total);
    // 실행 버튼 활성화/비활성화
    var execBtn = document.getElementById('jira-import-execute-btn');
    if (execBtn) execBtn.style.display = checked > 0 ? '' : 'none';
}

/**
 * 필터 설정 화면으로 돌아가기
 */
function showJiraFilterStep() {
    document.getElementById('jira-import-filter').style.display = '';
    document.getElementById('jira-import-preview').style.display = 'none';
    document.getElementById('jira-import-loading').style.display = 'none';
    document.getElementById('jira-import-error-msg').style.display = 'none';
    document.getElementById('jira-import-execute-btn').style.display = 'none';
}

/**
 * Jira 상태 필터: "전체" 체크박스 변경 시
 * "전체" 체크 시 다른 체크박스 모두 해제
 */
function onJiraStatusFilterAllChange(allCb) {
    if (allCb.checked) {
        document.getElementById('jira-filter-status-todo').checked = false;
        document.getElementById('jira-filter-status-inprogress').checked = false;
        document.getElementById('jira-filter-status-done').checked = false;
    }
}

/**
 * Jira 상태 필터: 개별 체크박스 변경 시
 * 개별 체크 시 "전체" 체크 해제
 */
function onJiraStatusFilterChange(cb) {
    if (cb.checked) {
        document.getElementById('jira-filter-status-all').checked = false;
    }
}

/**
 * Jira 미리보기 실행: 필터 적용 후 POST /api/v1/projects/{projectId}/jira/preview
 */
async function startJiraPreview() {
    if (!jiraImportProjectId) return;

    // 필터 값 읽기
    var createdAfterVal = document.getElementById('jira-filter-created-after').value;

    // 생성일자 필수 검증
    if (!createdAfterVal) {
        document.getElementById('jira-import-error-msg').style.display = '';
        document.getElementById('jira-import-error-msg').textContent = '생성일자를 입력해주세요.';
        return;
    }
    document.getElementById('jira-import-error-msg').style.display = 'none';

    jiraPreviewCreatedAfter = createdAfterVal || null;

    // 상태 필터 값 읽기
    var statusFilter = [];
    var allCheck = document.getElementById('jira-filter-status-all');
    if (!allCheck.checked) {
        ['jira-filter-status-todo', 'jira-filter-status-inprogress', 'jira-filter-status-done']
            .forEach(function(id) {
                var cb = document.getElementById(id);
                if (cb && cb.checked) statusFilter.push(cb.value);
            });
        // 아무것도 체크 안 하면 기본값 "To Do"
        if (statusFilter.length === 0) statusFilter = ['To Do'];
    }
    jiraPreviewStatusFilter = statusFilter; // executeJiraImport에서 재사용

    // 검색 키 값 읽기 (선택된 모드에 따라)
    var isEpicMode = document.getElementById('jira-import-source-epic').checked;
    var epicKeyVal = isEpicMode ? document.getElementById('jira-import-epic-key').value.trim() : '';
    var boardIdVal = !isEpicMode ? document.getElementById('jira-import-board-id').value.trim() : '';

    if (isEpicMode && !epicKeyVal) {
        document.getElementById('jira-import-error-msg').style.display = '';
        document.getElementById('jira-import-error-msg').textContent = 'Epic 키를 입력해주세요.';
        return;
    }
    if (!isEpicMode && !boardIdVal) {
        document.getElementById('jira-import-error-msg').style.display = '';
        document.getElementById('jira-import-error-msg').textContent = 'Board ID를 입력해주세요.';
        return;
    }

    // 재실행 시 executeJiraImport에서 재사용하도록 저장
    jiraPreviewBoardId = boardIdVal;

    // 필터 숨기고 로딩 표시
    document.getElementById('jira-import-filter').style.display = 'none';
    document.getElementById('jira-import-loading').style.display = '';
    document.getElementById('jira-import-preview').style.display = 'none';
    document.getElementById('jira-import-result').style.display = 'none';
    document.getElementById('jira-import-error-msg').style.display = 'none';
    document.getElementById('jira-import-execute-btn').style.display = 'none';

    try {
        var body = {};
        if (jiraPreviewCreatedAfter) body.createdAfter = jiraPreviewCreatedAfter;
        if (jiraPreviewStatusFilter && jiraPreviewStatusFilter.length > 0) body.statusFilter = jiraPreviewStatusFilter;
        if (isEpicMode) body.jiraEpicKey = epicKeyVal;
        else if (boardIdVal) body.jiraBoardId = boardIdVal;

        var previewUrl = isEpicMode
            ? '/api/v1/jira/space/preview'
            : '/api/v1/projects/' + jiraImportProjectId + '/jira/preview';
        var res = await apiCall(previewUrl, 'POST', body);
        document.getElementById('jira-import-loading').style.display = 'none';

        if (!res.success) {
            document.getElementById('jira-import-filter').style.display = '';
            document.getElementById('jira-import-error-msg').style.display = '';
            document.getElementById('jira-import-error-msg').textContent = res.message || 'Preview 실패';
            return;
        }

        var preview = res.data;
        document.getElementById('jira-preview-create').textContent = preview.toCreate || 0;
        document.getElementById('jira-preview-update').textContent = preview.toUpdate || 0;
        document.getElementById('jira-preview-skip').textContent = preview.toSkip || 0;
        document.getElementById('jira-preview-total').textContent = preview.totalIssues || 0;

        // 프로젝트 옵션 HTML 생성
        var projectOptions = '';
        _jiraImportProjects.forEach(function(p) {
            var selected = (p.id === jiraImportProjectId) ? ' selected' : '';
            projectOptions += '<option value="' + p.id + '"' + selected + '>' + escapeHtml(p.name) + '</option>';
        });

        // 테이블 렌더링 (체크박스 + 프로젝트 선택 포함)
        var tbody = document.getElementById('jira-preview-table');
        var html = '';
        var previewIssues = preview.issues || [];
        var hasImportable = false;
        if (previewIssues.length > 0) {
            previewIssues.forEach(function(item) {
                var actionBadge = '';
                var isImportable = (item.action === 'CREATE' || item.action === 'UPDATE');
                if (item.action === 'CREATE') actionBadge = '<span class="badge bg-success">생성</span>';
                else if (item.action === 'UPDATE') actionBadge = '<span class="badge bg-warning text-dark">업데이트</span>';
                else actionBadge = '<span class="badge bg-secondary">스킵</span>';
                if (isImportable) hasImportable = true;

                var jiraKeyVal = escapeHtml(item.jiraKey || '');
                html += '<tr>';
                html += '<td><input type="checkbox" class="jira-issue-cb" value="' + jiraKeyVal + '"'
                    + (isImportable ? ' checked' : '') + ' onchange="updateJiraPreviewSelectedCount()"'
                    + (isImportable ? '' : ' disabled') + '></td>';
                html += '<td><code style="white-space:nowrap">' + jiraKeyVal + '</code></td>';
                html += '<td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + escapeHtml(item.summary || '') + '">' + escapeHtml(item.summary || '') + '</td>';
                html += '<td>' + actionBadge + '</td>';
                html += '<td>' + escapeHtml(item.mappedStatus || '') + '</td>';
                html += '<td>' + escapeHtml(item.mappedAssigneeName || item.jiraAssignee || '-') + '</td>';
                html += '<td><select class="form-select form-select-sm jira-issue-project" data-jira-key="' + jiraKeyVal + '" style="font-size:0.75rem; padding:2px 4px; min-width:120px;">' + projectOptions + '</select></td>';
                html += '</tr>';
            });
        } else {
            html = '<tr><td colspan="7" class="text-center text-muted">가져올 이슈가 없습니다.</td></tr>';
        }
        tbody.innerHTML = html;
        document.getElementById('jira-import-preview').style.display = '';
        document.getElementById('jira-preview-select-all').checked = true;

        // 생성/업데이트 건이 있으면 실행 버튼 표시
        if (hasImportable) {
            document.getElementById('jira-import-execute-btn').style.display = '';
        }
    } catch (e) {
        document.getElementById('jira-import-loading').style.display = 'none';
        document.getElementById('jira-import-filter').style.display = '';
        document.getElementById('jira-import-error-msg').style.display = '';
        document.getElementById('jira-import-error-msg').textContent = 'Jira 이슈 조회 중 오류가 발생했습니다.';
        console.error('Jira preview 실패:', e);
    }
}

/**
 * Jira Import 실행: POST /api/v1/projects/{projectId}/jira/import
 */
async function executeJiraImport() {
    if (!jiraImportProjectId) return;
    var executeBtn = document.getElementById('jira-import-execute-btn');
    if (executeBtn.disabled) return; // 중복 클릭 방지
    executeBtn.disabled = true;
    executeBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 가져오는 중...';

    // 이전 결과/오류 초기화
    document.getElementById('jira-import-result').style.display = 'none';
    document.getElementById('jira-import-result-errors').style.display = 'none';
    document.getElementById('jira-import-error-msg').style.display = 'none';

    try {
        var importBody = {};
        if (jiraPreviewCreatedAfter) {
            importBody.createdAfter = jiraPreviewCreatedAfter;
        }
        if (jiraPreviewStatusFilter && jiraPreviewStatusFilter.length > 0) {
            importBody.statusFilter = jiraPreviewStatusFilter;
        }

        // 선택된 이슈 키 + 프로젝트 매핑 수집
        var selectedKeys = [];
        var issueProjectMap = {};
        document.querySelectorAll('#jira-preview-table .jira-issue-cb:checked').forEach(function(cb) {
            var key = cb.value;
            selectedKeys.push(key);
            var row = cb.closest('tr');
            var projectSelect = row.querySelector('.jira-issue-project');
            if (projectSelect && projectSelect.value) {
                var pid = parseInt(projectSelect.value);
                if (!isNaN(pid) && pid !== jiraImportProjectId) {
                    issueProjectMap[key] = pid;
                }
            }
        });
        importBody.selectedKeys = selectedKeys;
        if (Object.keys(issueProjectMap).length > 0) {
            importBody.issueProjectMap = issueProjectMap;
        }

        var isEpicMode = document.getElementById('jira-import-source-epic').checked;
        if (isEpicMode) {
            importBody.jiraEpicKey = document.getElementById('jira-import-epic-key').value.trim();
            importBody.defaultProjectId = jiraImportProjectId;
        } else if (jiraPreviewBoardId) {
            importBody.jiraBoardId = jiraPreviewBoardId;
        }
        var importUrl = isEpicMode
            ? '/api/v1/jira/space/import'
            : '/api/v1/projects/' + jiraImportProjectId + '/jira/import';
        var res = await apiCall(importUrl, 'POST', importBody);
        document.getElementById('jira-import-preview').style.display = 'none';
        executeBtn.style.display = 'none';

        if (res.success && res.data) {
            var result = res.data;
            var summaryHtml = '<strong>Import 완료!</strong><br>'
                + '생성: ' + (result.created || 0) + '건, '
                + '업데이트: ' + (result.updated || 0) + '건, '
                + '스킵: ' + (result.skipped || 0) + '건';
            document.getElementById('jira-import-result-summary').innerHTML = summaryHtml;
            document.getElementById('jira-import-result').style.display = '';

            // 오류 항목 표시
            if (result.errors && result.errors.length > 0) {
                var errList = document.getElementById('jira-import-error-list');
                var errHtml = '';
                result.errors.forEach(function(err) {
                    errHtml += '<li><strong>' + escapeHtml(err.jiraKey || '') + '</strong>: ' + escapeHtml(err.reason || '') + '</li>';
                });
                errList.innerHTML = errHtml;
                document.getElementById('jira-import-result-errors').style.display = '';
            }

            showToast('Jira 이슈 가져오기가 완료되었습니다.', 'success');

            // 프로젝트 태스크 목록 새로고침
            if (currentDetailProjectId) {
                loadProjectTasks(currentDetailProjectId);
            }
        } else {
            document.getElementById('jira-import-error-msg').style.display = '';
            document.getElementById('jira-import-error-msg').textContent = res.message || 'Import 실패';
            // 실패 시 버튼 복원하여 재시도 가능
            executeBtn.style.display = '';
            executeBtn.disabled = false;
            executeBtn.innerHTML = '<i class="bi bi-cloud-download"></i> 가져오기 실행';
        }
    } catch (e) {
        document.getElementById('jira-import-error-msg').style.display = '';
        document.getElementById('jira-import-error-msg').textContent = 'Import 중 오류가 발생했습니다.';
        console.error('Jira import 실패:', e);
        // 오류 시 버튼 복원하여 재시도 가능
        executeBtn.style.display = '';
        executeBtn.disabled = false;
        executeBtn.innerHTML = '<i class="bi bi-cloud-download"></i> 가져오기 실행';
    }
}

/**
 * 공휴일/회사휴무 목록 조회
 */
async function loadHolidays() {
    var year = document.getElementById('holiday-filter-year').value;
    var tbody = document.getElementById('holidays-table');

    try {
        var url = '/api/v1/holidays';
        if (year) url += '?year=' + year;
        var res = await apiCall(url);
        var holidays = (res.success && res.data) ? res.data : [];

        if (holidays.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">등록된 공휴일/회사휴무가 없습니다.</td></tr>';
            return;
        }

        var html = '';
        holidays.forEach(function(h) {
            var typeLabel = h.type === 'NATIONAL' ? '<span class="badge bg-primary">국가공휴일</span>' : '<span class="badge bg-info">회사휴무</span>';
            html += '<tr>';
            html += '<td>' + formatDate(h.date) + '</td>';
            html += '<td>' + escapeHtml(h.name) + '</td>';
            html += '<td>' + typeLabel + '</td>';
            html += '<td class="text-center">';
            html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteHoliday(' + h.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
            html += '</td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
    } catch (e) {
        console.error('공휴일 목록 로드 실패:', e);
        showToast('공휴일 목록을 불러오는데 실패했습니다.', 'error');
    }
}

/**
 * 공휴일/회사휴무 추가 모달 표시
 */
function showHolidayModal() {
    document.getElementById('holiday-date').value = '';
    document.getElementById('holiday-name').value = '';
    document.getElementById('holiday-type').value = 'NATIONAL';
    var modal = new bootstrap.Modal(document.getElementById('holidayModal'));
    modal.show();
}

/**
 * 공휴일/회사휴무 저장
 */
async function saveHoliday() {
    var date = document.getElementById('holiday-date').value;
    var name = document.getElementById('holiday-name').value.trim();
    var type = document.getElementById('holiday-type').value;

    if (!date || !name) {
        showToast('날짜와 이름을 입력해주세요.', 'warning');
        return;
    }

    try {
        var res = await apiCall('/api/v1/holidays', 'POST', { date: date, name: name, type: type });
        if (res.success) {
            showToast('공휴일/회사휴무가 추가되었습니다.', 'success');
            cachedHolidayDates = null; // 캐시 무효화
            bootstrap.Modal.getInstance(document.getElementById('holidayModal')).hide();
            loadHolidays();
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('공휴일 저장 실패:', e);
        showToast('공휴일 저장에 실패했습니다.', 'error');
    }
}

/**
 * 공휴일/회사휴무 삭제
 */
async function deleteHoliday(id) {
    if (!confirmAction('이 공휴일/회사휴무를 삭제하시겠습니까?')) return;

    try {
        var res = await apiCall('/api/v1/holidays/' + id, 'DELETE');
        if (res.success) {
            showToast('삭제되었습니다.', 'success');
            cachedHolidayDates = null; // 캐시 무효화
            loadHolidays();
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('공휴일 삭제 실패:', e);
        showToast('삭제에 실패했습니다.', 'error');
    }
}

// ========================================
// Member Leave (멤버 비가용일) 관리
// ========================================

/**
 * 멤버 비가용일 목록 조회
 */
async function loadMemberLeaves() {
    var memberId = document.getElementById('leave-member-select').value;
    var tbody = document.getElementById('member-leaves-table');
    var addBtn = document.getElementById('add-leave-btn');

    if (!memberId) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">멤버를 선택해주세요.</td></tr>';
        addBtn.disabled = true;
        return;
    }

    addBtn.disabled = false;

    try {
        var res = await apiCall('/api/v1/members/' + memberId + '/leaves');
        var leaves = (res.success && res.data) ? res.data : [];

        if (leaves.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">등록된 멤버 비가용일이 없습니다.</td></tr>';
            return;
        }

        var html = '';
        leaves.forEach(function(l) {
            html += '<tr>';
            html += '<td>' + formatDateWithDay(l.date) + '</td>';
            html += '<td>' + escapeHtml(l.reason || '-') + '</td>';
            html += '<td class="text-center">';
            html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteMemberLeave(' + memberId + ', ' + l.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
            html += '</td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
    } catch (e) {
        console.error('멤버 비가용일 목록 로드 실패:', e);
        showToast('멤버 비가용일 목록을 불러오는데 실패했습니다.', 'error');
    }
}

/**
 * 멤버 비가용일 조회 팝업
 */
async function showUnavailableDatesPopup(memberId, memberName) {
    document.getElementById('unavailableDatesModalTitle').textContent = (memberName || '멤버') + ' 비가용일';
    var contentEl = document.getElementById('unavailable-dates-content');
    contentEl.innerHTML = '<div class="text-center text-muted">로딩 중...</div>';
    var modal = new bootstrap.Modal(document.getElementById('unavailableDatesModal'));
    modal.show();

    try {
        // 공휴일 + 개인 비가용일 상세 목록을 병렬로 로드
        var results = await Promise.all([
            apiCall('/api/v1/holidays'),
            apiCall('/api/v1/members/' + memberId + '/leaves')
        ]);
        var holidayRes = results[0];
        var leaveRes = results[1];
        var holidayList = (holidayRes.success && holidayRes.data) ? holidayRes.data : [];
        var leaveList = (leaveRes.success && leaveRes.data) ? leaveRes.data : [];

        var html = '';

        // 개인 비가용일
        html += '<h6 class="fw-bold mb-2" style="font-size:0.9rem;"><i class="bi bi-person-x"></i> 개인 비가용일 (' + leaveList.length + '건)</h6>';
        if (leaveList.length > 0) {
            html += '<div class="table-responsive mb-3"><table class="table table-sm table-bordered mb-0" style="font-size:0.85rem;">';
            html += '<thead><tr><th>날짜</th><th>사유</th></tr></thead><tbody>';
            leaveList.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
            leaveList.forEach(function(l) {
                html += '<tr><td>' + formatDateWithDay(l.date) + '</td><td>' + escapeHtml(l.reason || '-') + '</td></tr>';
            });
            html += '</tbody></table></div>';
        } else {
            html += '<div class="text-muted mb-3" style="font-size:0.85rem;">등록된 비가용일이 없습니다.</div>';
        }

        // 공휴일/회사휴무 (올해 이후만)
        var thisYear = new Date().getFullYear();
        var futureHolidays = holidayList.filter(function(h) {
            return h.date && h.date.substring(0, 4) >= String(thisYear);
        });
        html += '<h6 class="fw-bold mb-2" style="font-size:0.9rem;"><i class="bi bi-calendar-x"></i> 공휴일/회사휴무 (' + futureHolidays.length + '건)</h6>';
        if (futureHolidays.length > 0) {
            html += '<div class="table-responsive"><table class="table table-sm table-bordered mb-0" style="font-size:0.85rem;">';
            html += '<thead><tr><th>날짜</th><th>이름</th><th>유형</th></tr></thead><tbody>';
            futureHolidays.forEach(function(h) {
                var typeBadge = h.type === 'COMPANY' ? '<span class="badge bg-info">회사</span>' : '<span class="badge bg-success">공휴일</span>';
                html += '<tr><td>' + formatDateWithDay(h.date) + '</td><td>' + escapeHtml(h.name || '-') + '</td><td>' + typeBadge + '</td></tr>';
            });
            html += '</tbody></table></div>';
        } else {
            html += '<div class="text-muted" style="font-size:0.85rem;">등록된 공휴일이 없습니다.</div>';
        }

        contentEl.innerHTML = html;
    } catch (e) {
        console.error('비가용일 로드 실패:', e);
        contentEl.innerHTML = '<div class="text-center text-muted">정보를 불러올 수 없습니다.</div>';
    }
}

/**
 * 멤버 비가용일 추가 모달 표시
 */
function showMemberLeaveModal() {
    document.getElementById('leave-date').value = '';
    document.getElementById('leave-reason').value = '';
    var modal = new bootstrap.Modal(document.getElementById('memberLeaveModal'));
    modal.show();
}

/**
 * 멤버 비가용일 저장
 */
async function saveMemberLeave() {
    var memberId = document.getElementById('leave-member-select').value;
    var date = document.getElementById('leave-date').value;
    var reason = document.getElementById('leave-reason').value.trim();

    if (!memberId) {
        showToast('멤버를 선택해주세요.', 'warning');
        return;
    }
    if (!date) {
        showToast('날짜를 입력해주세요.', 'warning');
        return;
    }

    try {
        var res = await apiCall('/api/v1/members/' + memberId + '/leaves', 'POST', { date: date, reason: reason });
        if (res.success) {
            showToast('멤버 비가용일이 추가되었습니다.', 'success');
            delete cachedMemberLeaveDates[parseInt(memberId)]; // 캐시 무효화
            bootstrap.Modal.getInstance(document.getElementById('memberLeaveModal')).hide();
            loadMemberLeaves();
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('멤버 비가용일 저장 실패:', e);
        showToast('멤버 비가용일 저장에 실패했습니다.', 'error');
    }
}

/**
 * 멤버 비가용일 삭제
 */
async function deleteMemberLeave(memberId, leaveId) {
    if (!confirmAction('이 멤버 비가용일을 삭제하시겠습니까?')) return;

    try {
        var res = await apiCall('/api/v1/members/' + memberId + '/leaves/' + leaveId, 'DELETE');
        if (res.success) {
            showToast('삭제되었습니다.', 'success');
            delete cachedMemberLeaveDates[parseInt(memberId)]; // 캐시 무효화
            loadMemberLeaves();
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('멤버 비가용일 삭제 실패:', e);
        showToast('삭제에 실패했습니다.', 'error');
    }
}

// ========================================
// 빠른 태스크 추가
// ========================================

/**
 * 빠른 태스크 추가 (상단 바 버튼)
 * - 프로젝트 선택이 필요하므로 현재 프로젝트 컨텍스트 사용
 */
async function showQuickAddTask() {
    // 현재 프로젝트 ID가 있으면 사용
    var projectId = currentDetailProjectId || currentProjectId;
    if (projectId) {
        showTaskModal(null, projectId);
        return;
    }
    // 없으면 첫 번째 프로젝트 사용
    try {
        var res = await apiCall('/api/v1/projects');
        if (res.success && res.data && res.data.length > 0) {
            showTaskModal(null, res.data[0].id);
        } else {
            showToast('프로젝트를 먼저 생성해주세요.', 'warning');
        }
    } catch (e) {
        showToast('프로젝트 목록을 불러올 수 없습니다.', 'error');
    }
}

// ========================================
// 초기화
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initColorPicker();
    initAssigneeConflictCheck();

    // 프로젝트 상세 탭 전환 이벤트
    var projectDetailTabs = document.getElementById('project-detail-tabs');
    if (projectDetailTabs) {
        projectDetailTabs.addEventListener('shown.bs.tab', function(e) {
            var target = e.target.getAttribute('href');
            if (!currentDetailProjectId) return;
            switch (target) {
                case '#tab-tasks':
                    loadProjectTasks(currentDetailProjectId);
                    break;
                case '#tab-members':
                    loadProjectMembers(currentDetailProjectId);
                    break;
            }
        });
    }

    // 설정 탭 전환 이벤트
    var settingsTabs = document.getElementById('settings-tabs');
    if (settingsTabs) {
        settingsTabs.addEventListener('shown.bs.tab', function(e) {
            var target = e.target.getAttribute('href');
            switch (target) {
                case '#settings-holidays':
                    loadHolidays();
                    break;
                case '#settings-members':
                    loadMembers();
                    break;
                case '#settings-domains':
                    loadDomainSystems();
                    break;
                case '#settings-jira':
                    loadJiraConfig();
                    break;
            }
        });
    }

    // 초기 경고 배지 로드
    apiCall('/api/v1/warnings/summary').then(function(res) {
        if (res.success && res.data) {
            updateWarningBadges(res.data);
        }
    }).catch(function() {});

    // Jira 설정 로드 (cachedJiraBaseUrl 초기화 - 태스크 링크 렌더링용)
    apiCall('/api/v1/jira/config').then(function(res) {
        if (res.success && res.data) {
            cachedJiraBaseUrl = res.data.baseUrl || null;
        }
    }).catch(function() {});

    // FR-002: 간트차트 토글 필터 초기화 (localStorage에서 복원)
    var storedJiraKey = localStorage.getItem('ganttShowJiraKey');
    var storedDomain = localStorage.getItem('ganttShowDomain');
    if (storedJiraKey !== null) ganttShowJiraKey = storedJiraKey === 'true';
    if (storedDomain !== null) ganttShowDomain = storedDomain === 'true';
    var jiraKeyCb = document.getElementById('gantt-show-jira-key');
    var domainCb = document.getElementById('gantt-show-domain');
    if (jiraKeyCb) jiraKeyCb.checked = ganttShowJiraKey;
    if (domainCb) domainCb.checked = ganttShowDomain;
    if (jiraKeyCb) {
        jiraKeyCb.addEventListener('change', function() {
            ganttShowJiraKey = this.checked;
            localStorage.setItem('ganttShowJiraKey', ganttShowJiraKey);
            reRenderGanttWithToggles();
        });
    }
    if (domainCb) {
        domainCb.addEventListener('change', function() {
            ganttShowDomain = this.checked;
            localStorage.setItem('ganttShowDomain', ganttShowDomain);
            reRenderGanttWithToggles();
        });
    }

    // hash 라우팅: hashchange 이벤트 리스너 등록 후 초기 화면 로드
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
});

// ---- 일정 계산 ----

async function saveProjectMdOverride(val) {
    var projectId = currentDetailProjectId;
    if (!projectId) return;
    var overrideVal = (val && parseFloat(val) > 0) ? parseFloat(val) : null;
    try {
        var projRes = await apiCall('/api/v1/projects/' + projectId);
        var p = (projRes.success && projRes.data) ? projRes.data : {};
        var body = {
            name: p.name, projectType: p.projectType, description: p.description,
            startDate: p.startDate || null, endDate: p.endDate || null,
            status: p.status, jiraBoardId: p.jiraBoardId || null,
            jiraEpicKey: p.jiraEpicKey || null,
            totalManDaysOverride: overrideVal,
            pplId: p.pplId || null, eplId: p.eplId || null,
            quarter: p.quarter || null
        };
        var res = await apiCall('/api/v1/projects/' + projectId, 'PUT', body);
        if (res.success) {
            window._currentDetailProject = res.data;
            showToast('Override MD가 저장되었습니다.', 'success');
        }
    } catch (e) { showToast('저장 실패', 'error'); }
}

function toggleAllScheduleCb(masterCb) {
    document.querySelectorAll('.proj-schedule-cb').forEach(function(cb) { cb.checked = masterCb.checked; });
    updateScheduleCalcBtn();
}

function updateScheduleCalcBtn() {
    var checked = document.querySelectorAll('.proj-schedule-cb:checked');
    var btn = document.getElementById('proj-schedule-calc-btn');
    var countEl = document.getElementById('proj-schedule-count');
    if (btn) btn.style.display = checked.length > 0 ? '' : 'none';
    if (countEl) countEl.textContent = checked.length;
    var masterCb = document.getElementById('proj-schedule-select-all');
    var total = document.querySelectorAll('.proj-schedule-cb').length;
    if (masterCb) masterCb.checked = (total > 0 && checked.length === total);
}

async function executeScheduleCalc() {
    var checkedCbs = document.querySelectorAll('.proj-schedule-cb:checked');
    if (checkedCbs.length === 0) { showToast('프로젝트를 선택해주세요.', 'warning'); return; }
    var projectIds = [];
    checkedCbs.forEach(function(cb) { projectIds.push(parseInt(cb.value)); });

    var modal = new bootstrap.Modal(document.getElementById('scheduleCalcModal'));
    document.getElementById('schedule-calc-loading').style.display = '';
    document.getElementById('schedule-calc-result').innerHTML = '';
    document.getElementById('schedule-calc-error').style.display = 'none';
    modal.show();

    try {
        var res = await apiCall('/api/v1/projects/schedule-calculate', 'POST', { projectIds: projectIds });
        document.getElementById('schedule-calc-loading').style.display = 'none';
        if (!res.success) {
            document.getElementById('schedule-calc-error').style.display = '';
            document.getElementById('schedule-calc-error').textContent = res.message || '일정 계산 실패';
            return;
        }
        renderScheduleCalcResult(res.data);
    } catch (e) {
        document.getElementById('schedule-calc-loading').style.display = 'none';
        document.getElementById('schedule-calc-error').style.display = '';
        document.getElementById('schedule-calc-error').textContent = '일정 계산 중 오류가 발생했습니다.';
    }
}

function renderScheduleCalcResult(data) {
    var html = '<table class="table table-bordered table-sm">';
    html += '<thead class="table-light"><tr>';
    html += '<th>프로젝트</th><th>시작일</th><th>개발종료</th><th>개발소요(일)</th>';
    html += '<th>QA 시작</th><th>QA 종료</th><th>QA(일)</th><th>론치일</th>';
    html += '<th>총 MD</th><th>BE</th><th>QA</th>';
    html += '</tr></thead><tbody>';
    data.forEach(function(r) {
        var rowStyle = r.fixedSchedule ? ' style="background:#f8f9fa;"' : '';
        html += '<tr' + rowStyle + '>';
        html += '<td><strong>' + escapeHtml(r.projectName) + '</strong>';
        if (r.fixedSchedule) html += ' <span class="badge bg-info" style="font-size:0.65rem;">고정</span>';
        html += '</td>';
        html += '<td>' + formatDateShort(r.startDate) + '</td>';
        html += '<td>' + formatDateShort(r.devEndDate) + '</td>';
        html += '<td class="text-center">' + (r.devDays || 0) + '</td>';
        html += '<td>' + (r.qaStartDate ? formatDateShort(r.qaStartDate) : '-') + '</td>';
        html += '<td>' + (r.qaEndDate ? formatDateShort(r.qaEndDate) : '-') + '</td>';
        html += '<td class="text-center">' + (r.qaDays || '-') + '</td>';
        html += '<td><strong>' + formatDateShort(r.launchDate) + '</strong></td>';
        html += '<td class="text-center">' + r.totalMd + '</td>';
        html += '<td class="text-center">' + r.beCount + '명';
        if (r.beMembers && r.beMembers.length > 0) {
            html += '<br><small class="text-muted">' + r.beMembers.map(function(m) { return m.name + '(' + m.capacity + ')'; }).join(', ') + '</small>';
        }
        if (r.busyMembers && r.busyMembers.length > 0) {
            html += '<br><small class="text-danger" style="font-size:0.7rem;">투입불가: ' + r.busyMembers.map(function(m) { return m.name; }).join(', ') + '</small>';
        }
        html += '</td>';
        html += '<td class="text-center">' + r.qaCount + '명';
        if (r.qaMembers && r.qaMembers.length > 0) {
            html += '<br><small class="text-muted">' + r.qaMembers.map(function(m) { return m.name; }).join(', ') + '</small>';
        }
        html += '</td>';
        html += '</tr>';
        if (r.warning) {
            var warningText = escapeHtml(r.warning).replace(/(\d{4}-\d{2}-\d{2})/g, function(m) { return formatDateShort(m); });
            html += '<tr><td colspan="11" class="text-warning" style="font-size:0.8rem; background:#fff8e1;"><i class="bi bi-exclamation-triangle-fill"></i> ' + escapeHtml(r.projectName) + ': ' + warningText + '</td></tr>';
        }
    });
    html += '</tbody></table>';

    // 요약
    if (data.length > 0) {
        var firstStart = data[0].startDate;
        var lastLaunch = data[data.length - 1].launchDate;
        html += '<div class="mt-2 p-2 bg-light rounded" style="font-size:0.85rem;">';
        html += '<strong>전체 일정:</strong> ' + formatDateShort(firstStart) + ' ~ ' + formatDateShort(lastLaunch);
        var totalMdSum = data.reduce(function(s, r) { return s + parseFloat(r.totalMd || 0); }, 0);
        html += ' | 총 공수: ' + totalMdSum + ' MD';
        html += '</div>';
    }
    document.getElementById('schedule-calc-result').innerHTML = html;
}
