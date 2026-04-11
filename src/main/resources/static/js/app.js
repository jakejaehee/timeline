// ========================================
// Timeline Application JavaScript
// Version: 20260412b
// ========================================

// ---- 전역 상태 ----
var currentSection = 'dashboard';
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
var pendingImportFile = null;    // Import 대기 중인 파일

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
        section: parts[0] || 'dashboard',
        param: parts[1] || null
    };
}

/**
 * hash 변경 시 해당 화면으로 이동
 */
function handleHashChange() {
    if (_isNavigating) return;
    var raw = window.location.hash.replace('#', '') || 'dashboard';
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
        case 'dashboard':
        case 'projects':
        case 'warning-center':
        case 'settings':
        case 'ai-parser':
            showSection(parsed.section);
            break;
        default:
            // 잘못된 hash → 대시보드로 폴백
            showSection('dashboard');
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

/**
 * 두 날짜 간 영업일 수 계산 (주말 제외)
 */
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
        case 'dashboard':
            loadDashboard();
            break;
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
// Dashboard
// ========================================

async function loadDashboard() {
    try {
        // 프로젝트, 경고 요약, team-board 데이터를 병렬로 로드
        var results = await Promise.all([
            apiCall('/api/v1/projects'),
            apiCall('/api/v1/warnings/summary'),
            apiCall('/api/v1/team-board/tasks')
        ]);
        var projectsRes = results[0];
        var warningsRes = results[1];
        var teamBoardRes = results[2];

        var projects = (projectsRes.success && projectsRes.data) ? projectsRes.data : [];

        // 진행 중인 프로젝트 수
        var inProgressProjects = projects.filter(function(p) {
            return p.status === 'IN_PROGRESS';
        });
        document.getElementById('stat-projects').textContent = inProgressProjects.length;

        // 지연 프로젝트 수
        var delayedProjects = projects.filter(function(p) {
            return p.isDelayed === true;
        });
        document.getElementById('stat-delayed').textContent = delayedProjects.length;

        // 순서 미지정 태스크 수 (경고 데이터에서)
        var warningData = (warningsRes.success && warningsRes.data) ? warningsRes.data : {};
        document.getElementById('stat-unordered').textContent = warningData.unorderedCount || 0;

        // 일정 충돌 수
        document.getElementById('stat-conflict').textContent = warningData.scheduleConflictCount || 0;

        // 경고 요약 카드 로드
        loadDashboardWarnings(warningData);

        // 경고 배지 갱신
        updateWarningBadges(warningData);

        // 담당자 workload 카드
        var workloadEl = document.getElementById('dashboard-workload-content');
        var tbData = (teamBoardRes.success && teamBoardRes.data) ? teamBoardRes.data : {};
        if (tbData.members && tbData.members.length > 0) {
            var wHtml = '<div class="table-responsive"><table class="table table-sm mb-0">';
            wHtml += '<thead><tr><th>멤버</th><th>역할</th><th>활성 태스크</th><th>공수 합계</th></tr></thead><tbody>';
            tbData.members.forEach(function(m) {
                var activeTasks = m.tasks ? m.tasks.filter(function(t) {
                    return t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
                }) : [];
                var activeCount = activeTasks.length;
                var totalMd = activeTasks.reduce(function(sum, t) {
                    return sum + (t.manDays ? parseFloat(t.manDays) : 0);
                }, 0);
                wHtml += '<tr>';
                wHtml += '<td>' + escapeHtml(m.name) + '</td>';
                wHtml += '<td>' + roleBadge(m.role) + '</td>';
                wHtml += '<td><span class="badge bg-' + (activeCount > 5 ? 'danger' : activeCount > 3 ? 'warning' : 'success') + '">' + activeCount + '</span></td>';
                wHtml += '<td><strong>' + totalMd + '</strong> MD</td>';
                wHtml += '</tr>';
            });
            wHtml += '</tbody></table></div>';
            workloadEl.innerHTML = wHtml;
        } else {
            workloadEl.innerHTML = '<div class="text-center text-muted">멤버 데이터가 없습니다.</div>';
        }

        // 마감 임박 프로젝트 카드 (14일 이내)
        var deadlineEl = document.getElementById('dashboard-deadline-content');
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var threshold = new Date(today);
        threshold.setDate(threshold.getDate() + 14);
        var upcomingDeadlines = projects.filter(function(p) {
            if (!p.endDate) return false;
            var dl = new Date(p.endDate + 'T00:00:00');
            return dl >= today && dl <= threshold;
        });
        if (upcomingDeadlines.length > 0) {
            var dlHtml = '<div class="table-responsive"><table class="table table-sm mb-0">';
            dlHtml += '<thead><tr><th>프로젝트</th><th>론치일</th><th>상태</th></tr></thead><tbody>';
            upcomingDeadlines.forEach(function(p) {
                dlHtml += '<tr class="cursor-pointer" onclick="showProjectDetail(' + p.id + ')">';
                dlHtml += '<td>' + escapeHtml(p.name) + '</td>';
                dlHtml += '<td>' + formatDateWithDay(p.endDate) + '</td>';
                dlHtml += '<td>' + statusBadge(p.status) + '</td>';
                dlHtml += '</tr>';
            });
            dlHtml += '</tbody></table></div>';
            deadlineEl.innerHTML = dlHtml;
        } else {
            deadlineEl.innerHTML = '<div class="text-center text-muted">14일 이내 마감 프로젝트가 없습니다.</div>';
        }

        // 최근 프로젝트 목록
        var tbody = document.getElementById('dashboard-projects-table');
        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">등록된 프로젝트가 없습니다.</td></tr>';
        } else {
            var html = '';
            var recentProjects = projects.slice(0, 5);
            recentProjects.forEach(function(p) {
                var delayHtml = '';
                if (p.isDelayed === true) {
                    delayHtml = '<span class="delay-indicator delayed"><i class="bi bi-exclamation-triangle-fill"></i> 지연</span>';
                } else if (p.isDelayed === false) {
                    delayHtml = '<span class="delay-indicator on-track"><i class="bi bi-check-circle-fill"></i> 정상</span>';
                } else {
                    delayHtml = '-';
                }
                html += '<tr class="cursor-pointer" onclick="showProjectDetail(' + p.id + ')">';
                html += '<td>' + escapeHtml(p.name) + '</td>';
                html += '<td>' + typeBadge(p.projectType) + '</td>';
                html += '<td>' + statusBadge(p.status) + '</td>';
                html += '<td>' + formatDateWithDay(p.startDate) + ' ~ ' + formatDateWithDay(p.endDate) + '</td>';
                html += '<td>' + delayHtml + '</td>';
                html += '</tr>';
            });
            tbody.innerHTML = html;
        }
    } catch (e) {
        console.error('대시보드 로드 실패:', e);
        showToast('대시보드 데이터를 불러오는데 실패했습니다.', 'error');
    }
}

// ========================================
// Members
// ========================================

async function loadMembers() {
    try {
        var res = await apiCall('/api/v1/members');
        var members = (res.success && res.data) ? res.data : [];
        var tbody = document.getElementById('members-table');

        if (members.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">등록된 멤버가 없습니다.</td></tr>';
            return;
        }

        var html = '';
        members.forEach(function(m) {
            html += '<tr>';
            html += '<td>' + escapeHtml(m.name) + '</td>';
            html += '<td>' + roleBadge(m.role) + '</td>';
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
    } catch (e) {
        console.error('멤버 목록 로드 실패:', e);
        showToast('멤버 목록을 불러오는데 실패했습니다.', 'error');
    }
}

async function showMemberModal(memberId) {
    document.getElementById('member-id').value = '';
    document.getElementById('member-name').value = '';
    document.getElementById('member-role').value = 'ENGINEER';
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
                document.getElementById('member-role').value = m.role || 'ENGINEER';
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
    var email = document.getElementById('member-email').value.trim();
    var capacity = document.getElementById('member-capacity').value;
    var queueStartDate = document.getElementById('member-queue-start-date').value;

    if (!name) {
        showToast('이름을 입력해주세요.', 'warning');
        return;
    }

    var body = { name: name, role: role, email: email, capacity: capacity ? parseFloat(capacity) : 1.0, queueStartDate: queueStartDate || null };

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

async function loadProjects() {
    // 목록 뷰 표시, 상세 뷰 숨김
    document.getElementById('project-list-view').style.display = '';
    document.getElementById('project-detail-view').style.display = 'none';

    try {
        var res = await apiCall('/api/v1/projects');
        var projects = (res.success && res.data) ? res.data : [];
        var tbody = document.getElementById('projects-table');

        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">등록된 프로젝트가 없습니다.</td></tr>';
            return;
        }

        var html = '';
        projects.forEach(function(p) {
            var memberCount = p.memberCount != null ? p.memberCount : 0;
            var delayHtml = '';
            if (p.isDelayed === true) {
                delayHtml = '<span class="delay-indicator delayed"><i class="bi bi-exclamation-triangle-fill"></i> 지연</span>';
            } else if (p.isDelayed === false) {
                delayHtml = '<span class="delay-indicator on-track"><i class="bi bi-check-circle-fill"></i> 정상</span>';
            } else {
                delayHtml = '-';
            }
            html += '<tr>';
            html += '<td class="cursor-pointer" onclick="showProjectDetail(' + p.id + ')"><strong>' + escapeHtml(p.name) + '</strong></td>';
            html += '<td>' + typeBadge(p.projectType) + '</td>';
            html += '<td>' + statusBadge(p.status) + '</td>';
            html += '<td>-</td>'; // 진행률은 상세에서
            html += '<td>' + formatDateWithDay(p.startDate) + '</td>';
            html += '<td>' + formatDateWithDay(p.endDate) + '</td>';
            html += '<td>' + delayHtml + '</td>';
            html += '<td>' + memberCount + '명</td>';
            html += '<td class="text-center">';
            html += '<div class="action-buttons">';
            html += '<button class="btn btn-outline-info btn-sm" onclick="event.stopPropagation(); showGanttChart(' + p.id + ')" title="간트차트"><i class="bi bi-bar-chart-steps"></i></button>';
            html += '<button class="btn btn-outline-primary btn-sm" onclick="event.stopPropagation(); showProjectModal(' + p.id + ')" title="수정"><i class="bi bi-pencil"></i></button>';
            html += '<button class="btn btn-outline-danger btn-sm" onclick="event.stopPropagation(); deleteProject(' + p.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
            html += '</div>';
            html += '</td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
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
        var tabMap = { 'tasks': '#tab-tasks', 'members': '#tab-members' };
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
}

async function loadProjectTasks(projectId) {
    var contentEl = document.getElementById('project-tasks-content');
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
            contentEl.innerHTML = '<div class="text-center text-muted p-3">등록된 태스크가 없습니다.</div>';
            return;
        }

        // 뷰 모드 토글 버튼
        var toggleHtml = '<div class="d-flex align-items-center mb-3">';
        toggleHtml += '<div class="btn-group btn-group-sm" role="group">';
        toggleHtml += '<button type="button" class="btn ' + (projectTaskViewMode === 'grouped' ? 'btn-primary' : 'btn-outline-primary') + '" onclick="switchProjectTaskView(\'grouped\', ' + projectId + ')"><i class="bi bi-people-fill"></i> 멤버별</button>';
        toggleHtml += '<button type="button" class="btn ' + (projectTaskViewMode === 'flat' ? 'btn-primary' : 'btn-outline-primary') + '" onclick="switchProjectTaskView(\'flat\', ' + projectId + ')"><i class="bi bi-list-ul"></i> 전체</button>';
        toggleHtml += '</div>';
        var totalCount = allTasks.length + inactiveTasks.length;
        toggleHtml += '<span class="text-muted ms-2" style="font-size:0.8rem;">' + totalCount + '건' + (inactiveTasks.length > 0 ? ' (비활성 ' + inactiveTasks.length + ')' : '') + '</span>';
        toggleHtml += '</div>';

        var html = '';

        if (projectTaskViewMode === 'flat') {
            // 전체 목록: 시작일 기준 정렬
            allTasks.sort(function(a, b) {
                return (a.startDate || '9999').localeCompare(b.startDate || '9999');
            });
            allTasks.forEach(function(t) {
                html += renderProjectTaskItem(t, null, projectId, false, true);
            });
        } else {
            // 멤버별 그룹화
            var assigneeGroups = {};
            var assigneeNames = {};
            allTasks.forEach(function(t) {
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

                html += '<div class="card mb-3">';
                html += '<div class="card-header py-2">';
                html += '<div class="d-flex align-items-center gap-2">';
                html += '<i class="bi bi-person-fill"></i> <strong>' + escapeHtml(name) + '</strong>';
                if (!isUnassigned) {
                    var assigneeData = tasks[0] && tasks[0].assignee ? tasks[0].assignee : null;
                    var qsd = assigneeData && assigneeData.queueStartDate ? assigneeData.queueStartDate : '';
                    html += '<span class="text-muted ms-2" style="font-size:0.8rem;">착수일:</span>';
                    html += '<input type="text" class="form-control form-control-sm project-task-queue-start-date" data-member-id="' + key + '" value="' + escapeHtml(qsd) + '" placeholder="미지정" style="width:120px; font-size:0.8rem;">';
                    html += '<button class="btn btn-sm btn-outline-primary project-task-queue-start-save" data-member-id="' + key + '" data-member-name="' + escapeHtml(name) + '" style="padding:2px 6px;">저장</button>';
                    html += '<button class="btn btn-sm btn-outline-secondary project-task-unavailable-btn" data-member-id="' + key + '" data-member-name="' + escapeHtml(name) + '" style="padding:2px 6px;" title="비가용일 조회"><i class="bi bi-calendar-x"></i></button>';
                }
                html += '<span class="badge bg-secondary ms-auto">' + tasks.length + '건</span>';
                html += '</div>';
                html += '</div>';
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

                html += '</div></div>';
            });
        }

        // HOLD/CANCELLED 태스크 별도 표시
        if (inactiveTasks.length > 0) {
            html += '<div class="card mb-3 border-secondary" style="opacity:0.7;">';
            html += '<div class="card-header py-2 bg-light">';
            html += '<strong class="text-secondary" style="font-size:0.85rem;"><i class="bi bi-pause-circle"></i> 비활성 태스크 (' + inactiveTasks.length + '건)</strong>';
            html += '</div>';
            html += '<div class="card-body p-2">';
            inactiveTasks.forEach(function(t) {
                html += renderProjectTaskItem(t, null, projectId, false, true);
            });
            html += '</div></div>';
        }

        contentEl.innerHTML = toggleHtml + html;

        // SortableJS 초기화 (멤버별 뷰에서만)
        if (projectTaskViewMode === 'grouped') {
            initProjectTaskDragDrop(projectId);
        }

        // 담당자 태스크 착수일 flatpickr 초기화 (멤버별 뷰에서만)
        if (projectTaskViewMode === 'grouped') {
            await initProjectTaskQueueStartDates(projectId);
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
            ]
        });
    }

    // 저장 버튼 이벤트 바인딩
    var saveBtns = document.querySelectorAll('.project-task-queue-start-save');
    saveBtns.forEach(function(btn) {
        btn.addEventListener('click', async function() {
            var memberId = btn.getAttribute('data-member-id');
            var memberName = btn.getAttribute('data-member-name');
            var dateInput = document.querySelector('.project-task-queue-start-date[data-member-id="' + memberId + '"]');
            var dateVal = dateInput ? dateInput.value.trim() : '';
            // 날짜 형식 검증 (빈 값은 null로 전송하여 착수일 제거)
            if (dateVal && !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
                showToast('날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)', 'warning');
                return;
            }
            try {
                var res = await apiCall('/api/v1/members/' + memberId + '/queue-start-date', 'PATCH', { queueStartDate: dateVal || null });
                if (res.success) {
                    showToast(memberName + '님의 태스크 착수일이 저장되었습니다.', 'success');
                    await loadProjectTasks(projectId);
                } else {
                    showToast(res.message || '저장에 실패했습니다.', 'error');
                }
            } catch (e) {
                console.error('태스크 착수일 저장 실패:', e);
                showToast('태스크 착수일 저장에 실패했습니다.', 'error');
            }
        });
    });

    // 비가용일 조회 버튼 이벤트 바인딩 (XSS 방지: data-attribute + addEventListener)
    var unavailBtns = document.querySelectorAll('.project-task-unavailable-btn');
    unavailBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var memberId = parseInt(btn.getAttribute('data-member-id'));
            var memberName = btn.getAttribute('data-member-name');
            showUnavailableDatesPopup(memberId, memberName);
        });
    });
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
            showToast('태스크 순서가 변경되었습니다. 날짜가 재계산됩니다.', 'success');
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

async function loadProjectMembers(projectId) {
    var contentEl = document.getElementById('project-members-content');
    try {
        var res = await apiCall('/api/v1/projects/' + projectId);
        if (!res.success || !res.data) {
            contentEl.innerHTML = '<div class="text-center text-muted">정보를 불러올 수 없습니다.</div>';
            return;
        }
        var members = res.data.members || [];
        if (members.length === 0) {
            contentEl.innerHTML = '<div class="text-center text-muted p-3">참여자가 없습니다.</div>';
            return;
        }
        var html = '<div class="table-responsive"><table class="table table-hover table-sm mb-0">';
        html += '<thead><tr><th>이름</th><th>역할</th><th>이메일</th><th>캐파</th></tr></thead>';
        html += '<tbody>';
        members.forEach(function(m) {
            html += '<tr>';
            html += '<td>' + escapeHtml(m.name) + '</td>';
            html += '<td>' + roleBadge(m.role) + '</td>';
            html += '<td>' + escapeHtml(m.email || '-') + '</td>';
            html += '<td>' + (m.capacity != null ? m.capacity : '1.0') + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        contentEl.innerHTML = html;
    } catch (e) {
        console.error('프로젝트 참여자 로드 실패:', e);
        contentEl.innerHTML = '<div class="text-center text-muted">참여자를 불러올 수 없습니다.</div>';
    }
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
    document.getElementById('project-delay-warning').style.display = 'none';
    document.getElementById('project-delay-warning').innerHTML = '';

    // 멤버/도메인시스템/프로젝트 유형 체크리스트 병렬 로드
    var checklistResults = await Promise.all([
        apiCall('/api/v1/members'),
        apiCall('/api/v1/domain-systems'),
        apiCall('/api/v1/projects/types')
    ]);
    var membersRes = checklistResults[0];
    var dsRes = checklistResults[1];
    var typesRes = checklistResults[2];

    // datalist 채우기
    if (typesRes.success && typesRes.data) {
        var datalist = document.getElementById('project-type-list');
        datalist.innerHTML = typesRes.data.map(function(t) {
            return '<option value="' + escapeHtml(t) + '">';
        }).join('');
    }
    var allMembers = (membersRes.success && membersRes.data) ? membersRes.data : [];
    var allDs = (dsRes.success && dsRes.data) ? dsRes.data : [];

    var currentMembers = [];
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
                currentMembers = p.members ? p.members.map(function(m) { return m.id; }) : [];
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

    // 멤버 체크리스트 렌더링
    var memberHtml = '';
    allMembers.forEach(function(m) {
        var checked = currentMembers.indexOf(m.id) >= 0 ? 'checked' : '';
        memberHtml += '<div class="form-check">';
        memberHtml += '<input class="form-check-input" type="checkbox" value="' + m.id + '" id="pm-' + m.id + '" ' + checked + '>';
        memberHtml += '<label class="form-check-label" for="pm-' + m.id + '">' + escapeHtml(m.name) + ' (' + m.role + ')</label>';
        memberHtml += '</div>';
    });
    document.getElementById('project-members-checklist').innerHTML = memberHtml || '<span class="text-muted">등록된 멤버가 없습니다.</span>';

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
    if (!startDate || !endDate) {
        showToast('시작일과 론치일을 입력해주세요.', 'warning');
        return;
    }

    var body = {
        name: name,
        projectType: type,
        description: description,
        startDate: startDate,
        endDate: endDate,
        status: status
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

            // 멤버 업데이트
            if (projectId) {
                await updateProjectMembers(projectId);
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
 * 프로젝트 멤버 업데이트 (체크리스트 기반)
 */
async function updateProjectMembers(projectId) {
    // 현재 프로젝트 멤버 조회
    var projectRes = await apiCall('/api/v1/projects/' + projectId);
    var currentMembers = [];
    if (projectRes.success && projectRes.data && projectRes.data.members) {
        currentMembers = projectRes.data.members.map(function(m) { return m.id; });
    }

    // 체크된 멤버 ID 수집
    var selectedMembers = [];
    var checkboxes = document.querySelectorAll('#project-members-checklist input[type="checkbox"]:checked');
    checkboxes.forEach(function(cb) {
        selectedMembers.push(parseInt(cb.value));
    });

    // 추가할 멤버
    for (var i = 0; i < selectedMembers.length; i++) {
        if (currentMembers.indexOf(selectedMembers[i]) < 0) {
            await apiCall('/api/v1/projects/' + projectId + '/members', 'POST', { memberId: selectedMembers[i] });
        }
    }

    // 제거할 멤버
    for (var j = 0; j < currentMembers.length; j++) {
        if (selectedMembers.indexOf(currentMembers[j]) < 0) {
            await apiCall('/api/v1/projects/' + projectId + '/members/' + currentMembers[j], 'DELETE');
        }
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
                document.getElementById('gantt-add-task-btn').style.display = 'none';
                await loadAllProjectsGantt();
            } else {
                document.getElementById('gantt-add-task-btn').style.display = '';
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
        document.getElementById('gantt-add-task-btn').style.display = 'none';
        document.getElementById('gantt-warnings').style.display = 'none';
        ganttInstance = null;
        return;
    }
    if (projectId === 'all') {
        currentProjectId = 'all';
        document.getElementById('gantt-add-task-btn').style.display = 'none';
        document.getElementById('gantt-warnings').style.display = 'none';
        await loadAllProjectsGantt();
        return;
    }
    currentProjectId = parseInt(projectId);
    document.getElementById('gantt-add-task-btn').style.display = '';
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

            // 각 프로젝트의 론치일 마커 (단일 SVG에 모든 프로젝트 마커 누적)
            var svgEl = chartContainer.querySelector('svg');
            if (svgEl) {
                // 기존 마커 일괄 제거
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
        if (markerX < 0 || markerX > svgWidth) return;

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
        text.textContent = '론치일 ' + project.endDate;
        g.appendChild(text);
        svg.appendChild(g);
    } catch (e) {
        console.error('론치일 마커 삽입 실패:', e);
    }
}

/**
 * 특정 요소 내 간트차트에서 주말 열 제거
 */
function removeGanttWeekendsForElement(inst, chartEl) {
    if (!inst || currentViewMode !== 'Day') return;
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

    // lower-text 처리
    var ltIdx = 0;
    lowerTexts.forEach(function(el) {
        if (ltIdx < isWeekend.length && isWeekend[ltIdx]) {
            el.remove();
        } else {
            var cx = parseFloat(el.getAttribute('x'));
            el.setAttribute('x', cx - (ltIdx < offset.length ? offset[ltIdx] : totalRemoved));
        }
        ltIdx++;
    });

    // upper-text 이동
    var upperTexts = svg.querySelectorAll('.upper-text');
    upperTexts.forEach(function(el) {
        var cx = parseFloat(el.getAttribute('x'));
        var colIdx = Math.round((cx - gridOffsetX) / colWidth);
        var off = (colIdx >= 0 && colIdx < offset.length) ? offset[colIdx] : totalRemoved;
        el.setAttribute('x', cx - off);
    });

    // grid ticks 이동
    var ticks = svg.querySelectorAll('.tick');
    ticks.forEach(function(el) {
        var isLine = (el.tagName === 'line' || el.tagName === 'LINE');
        if (isLine) {
            var x1 = parseFloat(el.getAttribute('x1'));
            var colIdx = Math.round((x1 - gridOffsetX) / colWidth);
            var off = (colIdx >= 0 && colIdx < offset.length) ? offset[colIdx] : totalRemoved;
            el.setAttribute('x1', x1 - off);
            el.setAttribute('x2', parseFloat(el.getAttribute('x2')) - off);
        }
    });

    // today-highlight 이동
    var todayHighlight = svg.querySelector('.today-highlight');
    if (todayHighlight) {
        var thx = parseFloat(todayHighlight.getAttribute('x'));
        var colIdx = Math.round((thx + colWidth/2 - gridOffsetX) / colWidth);
        var off = (colIdx >= 0 && colIdx < offset.length) ? offset[colIdx] : totalRemoved;
        todayHighlight.setAttribute('x', thx - off);
    }

    // bar 처리
    var barWrappers = svg.querySelectorAll('.bar-wrapper');
    barWrappers.forEach(function(bw) {
        var barGroup = bw.querySelector('.bar-group');
        if (!barGroup) return;
        var bar = barGroup.querySelector('.bar');
        if (!bar) return;

        var bx = parseFloat(bar.getAttribute('x'));
        var bw2 = parseFloat(bar.getAttribute('width'));
        var bRight = bx + bw2;

        var leftColIdx = Math.round((bx - gridOffsetX) / colWidth);
        var rightColIdx = Math.round((bRight - gridOffsetX) / colWidth);
        var leftOff = (leftColIdx >= 0 && leftColIdx < offset.length) ? offset[leftColIdx] : totalRemoved;
        var rightOff = (rightColIdx >= 0 && rightColIdx < offset.length) ? offset[rightColIdx] : totalRemoved;
        var newX = bx - leftOff;
        var newWidth = Math.max(bw2 - (rightOff - leftOff), colWidth * 0.3);

        bar.setAttribute('x', newX);
        bar.setAttribute('width', newWidth);

        var progress = barGroup.querySelector('.bar-progress');
        if (progress) {
            var pw = parseFloat(progress.getAttribute('width'));
            var ratio = bw2 > 0 ? pw / bw2 : 0;
            progress.setAttribute('x', newX);
            progress.setAttribute('width', newWidth * ratio);
        }

        // 라벨
        var labels = barGroup.querySelectorAll('.bar-label');
        labels.forEach(function(label) {
            label.setAttribute('x', newX + newWidth / 2);
        });

        // handle-group 이동
        var handleGroup = bw.querySelector('.handle-group');
        if (handleGroup) {
            var handles = handleGroup.querySelectorAll('rect');
            if (handles.length >= 1) handles[0].setAttribute('x', newX - 3);
            if (handles.length >= 2) handles[1].setAttribute('x', newX + newWidth - 5);
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

function convertToGanttTasks(data, projectName) {
    var tasks = [];
    if (!data || !data.domainSystems) return tasks;
    data.domainSystems.forEach(function(ds) {
        if (!ds.tasks || ds.tasks.length === 0) return;
        ds.tasks.forEach(function(task) {
            // HOLD/CANCELLED 제외
            if (task.status === 'HOLD' || task.status === 'CANCELLED') return;
            if (!task.startDate || !task.endDate) return;

            var assigneeName = task.assignee ? task.assignee.name : '미정';
            var assigneeRole = task.assignee ? task.assignee.role : 'ENGINEER';
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
            tasks.push({
                id: 'task-' + task.id,
                name: parallelPrefix + priorityPrefix + namePrefix + '[' + ds.name + '] ' + task.name + ' (' + assigneeName + ', ' + manDays + 'MD)',
                start: task.startDate,
                end: task.endDate,
                progress: progress,
                dependencies: deps,
                custom_class: barClass,
                _taskId: task.id,
                _projectId: data.project ? data.project.id : null,
                _domainSystem: ds.name,
                _domainSystemColor: ds.color
            });
        });
    });
    return tasks;
}

function renderGantt(data) {
    var chartContainer = document.getElementById('gantt-chart');

    var tasks = convertToGanttTasks(data);

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
            bar_height: 23,
            bar_corner_radius: 3,
            padding: 11,
            on_click: function(task) {
                showTaskDetail(task._taskId, { projectId: currentProjectId });
            },
            on_date_change: function(task, start, end) {
                // 드래그 변경 무시 - 다시 렌더링
                loadGanttData(currentProjectId);
            }
        });

        // 주말 제거 + 드래그 비활성화 + 마커
        setTimeout(function() {
            // 1. 주말 열 제거 (Day 모드)
            removeGanttWeekends();

            // 2. 드래그 완전 비활성화: bar의 drag 이벤트 제거
            var bars = document.querySelectorAll('#gantt-chart .bar-wrapper');
            bars.forEach(function(bar) {
                var clone = bar.cloneNode(true);
                bar.parentNode.replaceChild(clone, bar);
                clone.addEventListener('click', function() {
                    var taskId = clone.getAttribute('data-id');
                    if (taskId && taskId.startsWith('task-')) {
                        var id = parseInt(taskId.replace('task-', ''));
                        showTaskDetail(id, { projectId: currentProjectId });
                    }
                });
                clone.style.cursor = 'pointer';
            });

            // 3. 마커 추가 (주말 제거 후 위치 보정됨)
            addGanttTodayMarker();
            if (data.project) {
                addGanttDeadlineMarker(data.project);
            }
        }, 100);
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
        if (markerX < 0 || markerX > svgWidth) return;

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
        text.textContent = '론치일 ' + project.endDate;
        g.appendChild(text);

        svg.appendChild(g);
    } catch (e) {
        console.error('론치일 마커 삽입 실패:', e);
    }
}

/**
 * 간트차트 주말(토,일) 열 제거 — Day 모드에서만 동작
 * SVG 후처리로 주말 열을 제거하고 모든 요소 위치를 재조정
 */
function removeGanttWeekends() {
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
            var newRight = (origX + origW) - shiftForX(origX + origW);
            var newW = Math.max(newRight - newX, colWidth * 0.5);

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

/**
 * 간트차트 프로젝트 경고 로드
 */
async function loadGanttWarnings(projectId) {
    var warningsEl = document.getElementById('gantt-warnings');
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/warnings');
        if (res.success && res.data && res.data.warnings && res.data.warnings.length > 0) {
            var warnings = res.data.warnings;
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
            warningsEl.style.display = '';
        } else {
            warningsEl.style.display = 'none';
        }
    } catch (e) {
        warningsEl.style.display = 'none';
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
        html += '<tr><th>설명</th><td>' + escapeHtml(task.description || '-') + '</td></tr>';
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

    var modal = new bootstrap.Modal(document.getElementById('taskModal'));
    modal.show();
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
    if (!domainSystemId) {
        showToast('도메인 시스템을 선택해주세요.', 'warning');
        return;
    }
    if (!assigneeId) {
        showToast('담당자를 선택해주세요.', 'warning');
        return;
    }

    if (executionMode === 'SEQUENTIAL') {
        // SEQUENTIAL 모드: 공수 필수
        if (!manDays) {
            showToast('SEQUENTIAL 모드에서는 공수(MD)를 입력해주세요.', 'warning');
            return;
        }
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

    var body = {
        name: name,
        domainSystemId: parseInt(domainSystemId),
        assigneeId: parseInt(assigneeId),
        manDays: manDays ? parseFloat(manDays) : null,
        status: status,
        executionMode: executionMode,
        priority: priority || null,
        type: taskType || null,
        actualEndDate: actualEndDate || null,
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

async function deleteTask(id) {
    if (!confirmAction('이 태스크를 삭제하시겠습니까?')) return;

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

/**
 * 멤버별 태스크 초기 로드
 */
async function loadAssigneeSchedule() {
    try {
        var res = await apiCall('/api/v1/members');
        var members = (res.success && res.data) ? res.data : [];
        var listEl = document.getElementById('schedule-member-list');

        if (members.length === 0) {
            listEl.innerHTML = '<div class="text-center text-muted p-3">등록된 멤버가 없습니다.</div>';
            return;
        }

        var html = '';
        members.forEach(function(m) {
            var activeClass = (currentScheduleMemberId === m.id) ? ' active' : '';
            // data-member-id/data-member-name 속성으로 전달하여 onclick 문자열 injection 방지
            html += '<div class="schedule-member-item' + activeClass + '" data-member-id="' + m.id + '" data-member-name="' + escapeHtml(m.name) + '">';
            html += '<strong>' + escapeHtml(m.name) + '</strong> ';
            html += '<span class="text-muted" style="font-size:0.8rem;">' + m.role + '</span>';
            html += '</div>';
        });
        listEl.innerHTML = html;

        // 이벤트 위임으로 클릭 바인딩 (XSS-safe)
        listEl.querySelectorAll('.schedule-member-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var mid = parseInt(this.getAttribute('data-member-id'));
                var mname = this.getAttribute('data-member-name');
                selectScheduleMember(mid, mname);
            });
        });

        // 이전 선택이 있으면 큐 재로드 (hash 라우팅 시 name이 null일 수 있으므로 DOM에서 조회)
        if (currentScheduleMemberId) {
            var matchEl = listEl.querySelector('[data-member-id="' + currentScheduleMemberId + '"]');
            var mname = matchEl ? matchEl.getAttribute('data-member-name') : '';
            await selectScheduleMember(currentScheduleMemberId, mname);
        }
    } catch (e) {
        console.error('멤버 목록 로드 실패:', e);
    }
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

    document.getElementById('schedule-member-name').innerHTML = '<strong>' + escapeHtml(name) + '</strong> 태스크 큐 <button class="btn btn-sm btn-outline-secondary ms-2" onclick="showUnavailableDatesPopup(' + memberId + ', \'' + escapeJsString(escapeHtml(name)) + '\')" style="padding:1px 5px; font-size:0.75rem;" title="비가용일 조회"><i class="bi bi-calendar-x"></i></button>';

    // 태스크 착수일 표시
    var queueStartDateRow = document.getElementById('schedule-queue-start-date-row');
    queueStartDateRow.style.cssText = 'display: flex !important;';
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
                ]
            });
            if (memberRes.data.queueStartDate) {
                queueDateEl._flatpickr.setDate(memberRes.data.queueStartDate, false);
            }
        }
    } catch (e) {
        console.error('멤버 정보 로드 실패:', e);
    }

    // 태스크 착수일 저장 버튼 이벤트 바인딩
    var saveBtn = document.getElementById('schedule-queue-start-date-save');
    var newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    newSaveBtn.addEventListener('click', async function() {
        var dateVal = document.getElementById('schedule-queue-start-date').value;
        try {
            var res = await apiCall('/api/v1/members/' + memberId + '/queue-start-date', 'PATCH', { queueStartDate: dateVal || null });
            if (res.success) {
                showToast('태스크 착수일이 저장되었습니다.', 'success');
                await selectScheduleMember(memberId, name);
            } else {
                showToast(res.message || '저장에 실패했습니다.', 'error');
            }
        } catch (e) {
            console.error('태스크 착수일 저장 실패:', e);
            showToast('태스크 착수일 저장에 실패했습니다.', 'error');
        }
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

    var ordered = [];
    var unordered = [];
    var parallelTasks = [];
    var inactiveTasks = [];

    tasks.forEach(function(t) {
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
            uHtml += '<i class="bi bi-grip-vertical drag-handle cursor-pointer me-2" title="드래그하여 순서 지정"></i>';
            uHtml += '<div class="flex-grow-1">';
            uHtml += '<div><strong>' + escapeHtml(t.name) + '</strong></div>';
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
        html += '<tr><th>프로젝트</th><td>' + escapeHtml(task.project ? task.project.name : '-') + '</td></tr>';
        html += '<tr><th>도메인</th><td>' + (task.domainSystem ? escapeHtml(task.domainSystem.name) : '-') + '</td></tr>';
        html += '<tr><th>공수</th><td>' + (task.manDays || '-') + ' MD</td></tr>';
        html += '<tr><th>시작일</th><td>' + formatDateWithDay(task.startDate) + '</td></tr>';
        html += '<tr><th>종료일</th><td>' + formatDateWithDay(task.endDate) + '</td></tr>';
        html += '<tr><th>실행모드</th><td>' + (task.executionMode || 'SEQUENTIAL') + '</td></tr>';
        html += '<tr><th>우선순위</th><td>' + (task.priority ? priorityBadge(task.priority) : '-') + '</td></tr>';
        html += '<tr><th>유형</th><td>' + (task.type ? taskTypeBadge(task.type) : '-') + '</td></tr>';
        if (task.dependencyTasks && task.dependencyTasks.length > 0) {
            var depNames = task.dependencyTasks.map(function(d) { return escapeHtml(d.name); }).join(', ');
            html += '<tr><th>선행 태스크</th><td>' + depNames + '</td></tr>';
        }
        html += '<tr><th>설명</th><td>' + escapeHtml(task.description || '-') + '</td></tr>';
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
function initScheduleDragDrop(memberId) {
    if (typeof Sortable === 'undefined') return;

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
        new Sortable(orderedContainer, {
            group: 'schedule-queue',
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: onDragEnd
        });
    }

    // 순서 미지정 리스트 (순서 지정 리스트로 보내기)
    if (unorderedContainer) {
        new Sortable(unorderedContainer, {
            group: 'schedule-queue',
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: onDragEnd
        });
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
            showToast('태스크 순서가 변경되었습니다. 날짜가 재계산됩니다.', 'success');
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
async function loadDashboardWarnings(data) {
    try {
        if (!data) {
            var res = await apiCall('/api/v1/warnings/summary');
            if (res.success && res.data) {
                data = res.data;
            } else {
                return;
            }
        }

        var card = document.getElementById('dashboard-warnings-card');
        var totalEl = document.getElementById('dashboard-warning-total');
        var contentEl = document.getElementById('dashboard-warnings-content');

        if (data.totalWarnings > 0) {
            totalEl.textContent = data.totalWarnings;
            var html = '<div class="row g-2">';
            var items = [
                { label: '순서 미지정', count: data.unorderedCount, icon: 'bi-sort-numeric-down', color: 'warning' },
                { label: '시작일 누락', count: data.missingStartDateCount, icon: 'bi-calendar-x', color: 'danger' },
                { label: '일정 충돌', count: data.scheduleConflictCount, icon: 'bi-exclamation-triangle', color: 'danger' },
                { label: '의존성 문제', count: data.dependencyIssueCount, icon: 'bi-link-45deg', color: 'warning' },
                { label: '마감 지연', count: data.deadlineExceededCount, icon: 'bi-alarm', color: 'danger' },
                { label: '멤버 미지정', count: data.orphanTaskCount, icon: 'bi-person-x', color: 'warning' },
                { label: '의존성 비활성', count: data.dependencyRemovedCount, icon: 'bi-trash', color: 'secondary' },
                { label: '비가용일 충돌', count: data.unavailableDateCount, icon: 'bi-calendar-event', color: 'info' }
            ];
            items.forEach(function(item) {
                if (item.count > 0) {
                    html += '<div class="col-md-3">';
                    html += '<div class="d-flex align-items-center gap-2 p-2 border rounded">';
                    html += '<i class="bi ' + item.icon + ' text-' + item.color + '"></i>';
                    html += '<span style="font-size:0.85rem;">' + item.label + '</span>';
                    html += '<span class="badge bg-' + item.color + ' ms-auto">' + item.count + '</span>';
                    html += '</div></div>';
                }
            });
            html += '</div>';
            contentEl.innerHTML = html;
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    } catch (e) {
        console.error('경고 요약 로드 실패:', e);
    }
}

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
            }
        });
    }

    // 초기 경고 배지 로드
    apiCall('/api/v1/warnings/summary').then(function(res) {
        if (res.success && res.data) {
            updateWarningBadges(res.data);
        }
    }).catch(function() {});

    // hash 라우팅: hashchange 이벤트 리스너 등록 후 초기 화면 로드
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange();
});
