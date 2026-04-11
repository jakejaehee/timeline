// ========================================
// Timeline Application JavaScript
// Version: 20260411d
// ========================================

// ---- 전역 상태 ----
var currentSection = 'dashboard';
var currentProjectId = null;     // 간트차트에서 사용 중인 프로젝트 ID
var currentGanttData = null;     // 간트차트 원본 데이터
var ganttInstance = null;        // frappe-gantt 인스턴스
var currentViewMode = 'Week';   // 간트차트 뷰 모드
var parsedTaskData = null;       // AI 파싱 결과 임시 저장
var currentModalProjectId = null; // 태스크 모달에서 사용 중인 프로젝트 ID
var isFirstTask = true;          // 현재 모달의 태스크가 첫 번째 태스크인지
var previewDebounceTimer = null; // 프리뷰 API 호출 디바운스 타이머
var currentProjectMembers = [];  // 태스크 모달에서 사용 중인 프로젝트 멤버 목록 (capacity 조회용)
var ganttDomainVisibility = {};  // 간트차트 도메인 시스템 표시/숨김 상태
var currentDetailProjectId = null; // 프로젝트 상세 뷰에서 사용 중인 프로젝트 ID
var currentScheduleMemberId = null; // 담당자 스케줄에서 선택된 멤버 ID
var currentScheduleMemberName = null; // 담당자 스케줄에서 선택된 멤버 이름
var projectGanttInstance = null; // 프로젝트 상세 간트 인스턴스
var allWarningsData = null;      // 경고 센터 전체 경고 캐시

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
 * confirm 다이얼로그
 */
function confirmAction(message) {
    return window.confirm(message);
}

// ========================================
// 섹션 전환
// ========================================

function showSection(sectionName, linkEl) {
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

    // 섹션 데이터 로드
    switch (sectionName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'projects':
            loadProjects();
            break;
        case 'tasks':
            loadTasks();
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
            wHtml += '<thead><tr><th>담당자</th><th>역할</th><th>활성 태스크</th></tr></thead><tbody>';
            tbData.members.forEach(function(m) {
                var activeTasks = m.tasks ? m.tasks.filter(function(t) {
                    return t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
                }).length : 0;
                wHtml += '<tr>';
                wHtml += '<td>' + escapeHtml(m.name) + '</td>';
                wHtml += '<td>' + roleBadge(m.role) + '</td>';
                wHtml += '<td><span class="badge bg-' + (activeTasks > 5 ? 'danger' : activeTasks > 3 ? 'warning' : 'success') + '">' + activeTasks + '</span></td>';
                wHtml += '</tr>';
            });
            wHtml += '</tbody></table></div>';
            workloadEl.innerHTML = wHtml;
        } else {
            workloadEl.innerHTML = '<div class="text-center text-muted">담당자 데이터가 없습니다.</div>';
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
            dlHtml += '<thead><tr><th>프로젝트</th><th>종료일</th><th>상태</th></tr></thead><tbody>';
            upcomingDeadlines.forEach(function(p) {
                dlHtml += '<tr class="cursor-pointer" onclick="showProjectDetail(' + p.id + ')">';
                dlHtml += '<td>' + escapeHtml(p.name) + '</td>';
                dlHtml += '<td>' + formatDate(p.endDate) + '</td>';
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
                html += '<td>' + formatDate(p.startDate) + ' ~ ' + formatDate(p.endDate) + '</td>';
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

    if (!name) {
        showToast('이름을 입력해주세요.', 'warning');
        return;
    }

    var body = { name: name, role: role, email: email, capacity: capacity ? parseFloat(capacity) : 1.0 };

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
            html += '<td>' + formatDate(p.startDate) + '</td>';
            html += '<td>' + formatDate(p.endDate) + '</td>';
            html += '<td>' + delayHtml + '</td>';
            html += '<td>' + memberCount + '명</td>';
            html += '<td class="text-center">';
            html += '<div class="action-buttons">';
            html += '<button class="btn btn-outline-info btn-sm" onclick="showProjectDetail(' + p.id + ', \'schedule\')" title="간트차트"><i class="bi bi-bar-chart-steps"></i></button>';
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
    loadProjects();
}

async function showProjectDetail(projectId, tabName) {
    currentDetailProjectId = projectId;
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
        var tabMap = { 'overview': '#tab-overview', 'tasks': '#tab-tasks', 'schedule': '#tab-schedule', 'members': '#tab-members' };
        var tabTarget = tabMap[tabName];
        if (tabTarget) {
            var tabEl = document.querySelector('#project-detail-tabs a[href="' + tabTarget + '"]');
            if (tabEl) {
                var bsTab = new bootstrap.Tab(tabEl);
                bsTab.show();
            }
        }
    } else {
        // 기본 개요 탭
        var overviewTab = document.querySelector('#project-detail-tabs a[href="#tab-overview"]');
        if (overviewTab) {
            var bsTab = new bootstrap.Tab(overviewTab);
            bsTab.show();
        }
    }

    await loadProjectOverview(projectId);
}

async function loadProjectOverview(projectId) {
    var contentEl = document.getElementById('project-overview-content');
    try {
        var results = await Promise.all([
            apiCall('/api/v1/projects/' + projectId),
            apiCall('/api/v1/projects/' + projectId + '/tasks')
        ]);
        var projRes = results[0];
        var tasksRes = results[1];
        var p = (projRes.success && projRes.data) ? projRes.data : {};
        document.getElementById('project-detail-title').textContent = p.name || '';

        // 진행률 계산
        var totalTasks = 0;
        var completedTasks = 0;
        if (tasksRes.success && tasksRes.data && tasksRes.data.domainSystems) {
            tasksRes.data.domainSystems.forEach(function(ds) {
                if (ds.tasks) {
                    totalTasks += ds.tasks.length;
                    ds.tasks.forEach(function(t) {
                        if (t.status === 'COMPLETED') completedTasks++;
                    });
                }
            });
        }
        var progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        var html = '<div class="row">';
        html += '<div class="col-md-6">';
        html += '<div class="card"><div class="card-body">';
        html += '<h6 class="fw-bold mb-3">프로젝트 정보</h6>';
        html += '<table class="table table-sm mb-0">';
        html += '<tr><th style="width:30%">프로젝트명</th><td>' + escapeHtml(p.name) + '</td></tr>';
        html += '<tr><th>유형</th><td>' + typeBadge(p.projectType) + '</td></tr>';
        html += '<tr><th>상태</th><td>' + statusBadge(p.status) + '</td></tr>';
        html += '<tr><th>시작일</th><td>' + formatDate(p.startDate) + '</td></tr>';
        html += '<tr><th>종료일</th><td>' + formatDate(p.endDate) + '</td></tr>';
        html += '<tr><th>설명</th><td>' + escapeHtml(p.description || '-') + '</td></tr>';
        html += '</table>';
        html += '</div></div>';
        html += '</div>';
        html += '<div class="col-md-6">';
        html += '<div class="card"><div class="card-body">';
        html += '<h6 class="fw-bold mb-3">진행률</h6>';
        html += '<div class="d-flex align-items-center gap-3 mb-3">';
        html += '<div class="progress flex-grow-1 progress-sm"><div class="progress-bar" style="width:' + progressPct + '%"></div></div>';
        html += '<strong>' + progressPct + '%</strong>';
        html += '</div>';
        html += '<div class="text-muted" style="font-size:0.85rem;">완료: ' + completedTasks + ' / 전체: ' + totalTasks + '</div>';

        // 지연 표시
        if (p.isDelayed === true) {
            html += '<div class="alert alert-danger mt-3 mb-0 py-2 px-3" style="font-size:0.85rem;">';
            html += '<i class="bi bi-exclamation-triangle-fill"></i> 예상 종료일(' + formatDate(p.expectedEndDate) + ')이 종료일(' + formatDate(p.endDate) + ')을 초과합니다.';
            html += '</div>';
        } else if (p.isDelayed === false) {
            html += '<div class="alert alert-success mt-3 mb-0 py-2 px-3" style="font-size:0.85rem;">';
            html += '<i class="bi bi-check-circle-fill"></i> 정상 진행 중';
            html += '</div>';
        }

        html += '</div></div>';
        html += '</div>';
        html += '</div>';
        contentEl.innerHTML = html;
    } catch (e) {
        console.error('프로젝트 개요 로드 실패:', e);
        contentEl.innerHTML = '<div class="text-center text-muted">프로젝트 정보를 불러올 수 없습니다.</div>';
    }
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
        if (res.data.domainSystems) {
            res.data.domainSystems.forEach(function(ds) {
                if (ds.tasks) {
                    ds.tasks.forEach(function(t) {
                        t._domainSystemName = ds.name;
                        t._domainSystemColor = ds.color;
                        allTasks.push(t);
                    });
                }
            });
        }
        if (allTasks.length === 0) {
            contentEl.innerHTML = '<div class="text-center text-muted p-3">등록된 태스크가 없습니다.</div>';
            return;
        }
        var html = '<div class="table-responsive"><table class="table table-hover table-sm mb-0">';
        html += '<thead><tr><th>태스크명</th><th>도메인</th><th>담당자</th><th>상태</th><th>기간</th><th>MD</th><th>액션</th></tr></thead>';
        html += '<tbody>';
        allTasks.forEach(function(t) {
            html += '<tr>';
            html += '<td>' + escapeHtml(t.name) + '</td>';
            html += '<td>' + escapeHtml(t._domainSystemName || '-') + '</td>';
            html += '<td>' + (t.assignee ? escapeHtml(t.assignee.name) : '-') + '</td>';
            html += '<td>' + statusBadge(t.status) + '</td>';
            html += '<td class="text-nowrap">' + formatDate(t.startDate) + ' ~ ' + formatDate(t.endDate) + '</td>';
            html += '<td>' + (t.manDays || '-') + '</td>';
            html += '<td>';
            html += '<button class="btn btn-outline-primary btn-sm" onclick="showTaskModal(' + t.id + ', ' + projectId + ')" title="수정"><i class="bi bi-pencil"></i></button> ';
            html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteTask(' + t.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
            html += '</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        contentEl.innerHTML = html;
    } catch (e) {
        console.error('프로젝트 태스크 로드 실패:', e);
        contentEl.innerHTML = '<div class="text-center text-muted">태스크를 불러올 수 없습니다.</div>';
    }
}

async function loadProjectSchedule(projectId) {
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/tasks');
        if (!res.success || !res.data) return;

        var data = res.data;
        var chartContainer = document.getElementById('project-gantt-chart');
        var tasks = [];
        var hasTasks = false;

        if (data.domainSystems) {
            data.domainSystems.forEach(function(ds) {
                if (ds.tasks && ds.tasks.length > 0) {
                    hasTasks = true;
                    ds.tasks.forEach(function(task) {
                        if (!task.startDate || !task.endDate) return;
                        var assigneeName = task.assignee ? task.assignee.name : '미정';
                        var assigneeRole = task.assignee ? task.assignee.role : 'ENGINEER';
                        var barClass = 'bar-' + assigneeRole.toLowerCase();
                        if (task.status === 'HOLD') barClass = 'bar-hold';
                        else if (task.status === 'CANCELLED') barClass = 'bar-cancelled';
                        var progress = 0;
                        if (task.status === 'COMPLETED') progress = 100;
                        else if (task.status === 'IN_PROGRESS') progress = 50;
                        tasks.push({
                            id: 'ptask-' + task.id,
                            name: '[' + ds.name + '] ' + task.name + ' (' + assigneeName + ')',
                            start: task.startDate,
                            end: task.endDate,
                            progress: progress,
                            custom_class: barClass,
                            _taskId: task.id
                        });
                    });
                }
            });
        }

        if (!hasTasks) {
            chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>태스크가 없습니다.</p></div>';
            projectGanttInstance = null;
            return;
        }

        chartContainer.innerHTML = '';
        projectGanttInstance = new Gantt('#project-gantt-chart', tasks, {
            view_mode: 'Week',
            date_format: 'YYYY-MM-DD',
            bar_height: 24,
            bar_corner_radius: 4,
            padding: 12,
            on_click: function(task) {
                showTaskDetail(task._taskId, { projectId: projectId });
            }
        });
    } catch (e) {
        console.error('프로젝트 일정 로드 실패:', e);
    }
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
                        + '예상 종료일(' + formatDate(p.expectedEndDate) + ')이 종료일(' + formatDate(p.endDate) + ')을 초과합니다.'
                        + '</div>';
                    delayWarning.style.display = 'block';
                } else if (p.isDelayed === false) {
                    delayWarning.innerHTML = '<div class="alert alert-success mb-0 py-2 px-3" style="font-size:0.85rem;">'
                        + '<i class="bi bi-check-circle-fill"></i> 예상 종료일(' + formatDate(p.expectedEndDate) + ')이 종료일 내에 있습니다.'
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
        showToast('시작일과 종료일을 입력해주세요.', 'warning');
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
            document.getElementById('gantt-add-task-btn').style.display = '';
            await loadGanttData(currentProjectId);
        }
    } catch (e) {
        console.error('간트차트 프로젝트 목록 로드 실패:', e);
    }
}

/**
 * 간트차트 프로젝트 선택 변경
 */
async function onGanttProjectChange(projectId) {
    if (!projectId) {
        currentProjectId = null;
        document.getElementById('gantt-chart').innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-steps"></i><p>프로젝트를 선택하여 간트차트를 표시하세요.</p></div>';
        document.getElementById('gantt-add-task-btn').style.display = 'none';
        document.getElementById('gantt-legend').innerHTML = '';
        document.getElementById('gantt-domain-filter').style.display = 'none';
        document.getElementById('gantt-warnings').style.display = 'none';
        ganttInstance = null;
        return;
    }
    currentProjectId = parseInt(projectId);
    document.getElementById('gantt-add-task-btn').style.display = '';
    await loadGanttData(currentProjectId);
}

/**
 * 기존 showGanttChart - 이제 프로젝트 상세 일정 탭으로 리다이렉트
 */
function showGanttChart(projectId) {
    showProjectDetail(projectId, 'schedule');
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

function renderGantt(data) {
    var chartContainer = document.getElementById('gantt-chart');

    // 범례 렌더링
    var legendHtml = '';
    if (data.domainSystems) {
        data.domainSystems.forEach(function(ds) {
            legendHtml += '<span class="legend-item">';
            legendHtml += '<span class="legend-color" style="background-color:' + sanitizeColor(ds.color) + '"></span>';
            legendHtml += escapeHtml(ds.name);
            legendHtml += '</span>';
        });
    }
    // 역할 범례 추가
    legendHtml += '<span class="legend-item"><span class="legend-color" style="background-color:#4A90D9"></span>ENGINEER</span>';
    legendHtml += '<span class="legend-item"><span class="legend-color" style="background-color:#27AE60"></span>QA</span>';
    legendHtml += '<span class="legend-item"><span class="legend-color" style="background-color:#E67E22"></span>PM</span>';
    // 상태 범례 추가
    legendHtml += '<span class="legend-item"><span class="legend-color" style="background-color:#ffc107;opacity:0.6"></span>HOLD</span>';
    legendHtml += '<span class="legend-item"><span class="legend-color" style="background-color:#dc3545;opacity:0.4"></span>CANCELLED</span>';
    document.getElementById('gantt-legend').innerHTML = legendHtml;

    // 도메인 시스템 접기/펼치기 체크박스 렌더링
    var domainFilterEl = document.getElementById('gantt-domain-filter');
    var domainCheckboxesEl = document.getElementById('gantt-domain-checkboxes');
    if (data.domainSystems && data.domainSystems.length > 0) {
        var cbHtml = '';
        data.domainSystems.forEach(function(ds, idx) {
            var dsKey = 'ds-' + ds.name;
            var checked = ganttDomainVisibility[dsKey] !== false ? 'checked' : '';
            // ID에는 안전한 인덱스 사용, value에는 escape된 이름 사용
            var cbId = 'gcb-' + idx;
            cbHtml += '<div class="form-check form-check-inline">';
            cbHtml += '<input class="form-check-input gantt-domain-cb" type="checkbox" value="' + escapeHtml(ds.name) + '" id="' + cbId + '" ' + checked + ' onchange="applyGanttDomainFilter()">';
            cbHtml += '<label class="form-check-label" for="' + cbId + '" style="font-size:0.8rem;">';
            cbHtml += '<span class="color-preview" style="background-color:' + sanitizeColor(ds.color) + ';width:10px;height:10px;"></span>';
            cbHtml += escapeHtml(ds.name);
            cbHtml += '</label>';
            cbHtml += '</div>';
        });
        domainCheckboxesEl.innerHTML = cbHtml;
        domainFilterEl.style.display = '';
    } else {
        domainFilterEl.style.display = 'none';
    }

    // frappe-gantt 데이터 변환
    var tasks = [];
    var hasTasks = false;

    if (data.domainSystems) {
        data.domainSystems.forEach(function(ds) {
            // 도메인 시스템 필터 적용 (접기/펼치기)
            var dsKey = 'ds-' + ds.name;
            if (ganttDomainVisibility[dsKey] === false) return;

            if (ds.tasks && ds.tasks.length > 0) {
                hasTasks = true;
                ds.tasks.forEach(function(task) {
                    var assigneeName = task.assignee ? task.assignee.name : '미정';
                    var assigneeRole = task.assignee ? task.assignee.role : 'ENGINEER';
                    var manDays = task.manDays || 0;
                    var deps = '';
                    if (task.dependencies && task.dependencies.length > 0) {
                        deps = task.dependencies.map(function(depId) { return 'task-' + depId; }).join(', ');
                    }

                    // 상태별 custom_class 결정: HOLD/CANCELLED > 역할별 색상
                    var barClass = 'bar-' + assigneeRole.toLowerCase();
                    if (task.status === 'HOLD') {
                        barClass = 'bar-hold';
                    } else if (task.status === 'CANCELLED') {
                        barClass = 'bar-cancelled';
                    }

                    // 바 라벨에 우선순위 표시
                    var priorityPrefix = task.priority ? '[' + task.priority + '] ' : '';

                    // startDate/endDate가 없는 태스크는 건너뜀 (미정렬 상태)
                    if (!task.startDate || !task.endDate) return;

                    // 진행률 계산
                    var progress = 0;
                    if (task.status === 'COMPLETED') progress = 100;
                    else if (task.status === 'IN_PROGRESS') progress = 50;
                    else if (task.status === 'HOLD') progress = 25;

                    tasks.push({
                        id: 'task-' + task.id,
                        name: priorityPrefix + '[' + ds.name + '] ' + task.name + ' (' + assigneeName + ', ' + manDays + 'MD)',
                        start: task.startDate,
                        end: task.endDate,
                        progress: progress,
                        dependencies: deps,
                        custom_class: barClass,
                        // 커스텀 데이터 (클릭 이벤트에서 사용)
                        _taskId: task.id,
                        _domainSystem: ds.name,
                        _domainSystemColor: ds.color
                    });
                });
            }
        });
    }

    if (!hasTasks) {
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
            bar_height: 28,
            bar_corner_radius: 4,
            padding: 14,
            on_click: function(task) {
                showTaskDetail(task._taskId, { projectId: currentProjectId });
            },
            on_date_change: function(task, start, end) {
                onTaskDateChange(task, start, end);
            }
        });
        // 오늘 날짜 수직선 및 마감선 삽입
        setTimeout(function() {
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

        // 기존 종료일 마커 제거
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
        var diffDays = Math.round((endDateDate - today) / (1000 * 60 * 60 * 24));

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
        text.textContent = '종료일 ' + project.endDate;
        g.appendChild(text);

        svg.appendChild(g);
    } catch (e) {
        console.error('종료일 마커 삽입 실패:', e);
    }
}

/**
 * 간트차트 도메인 시스템 필터 적용 (접기/펼치기)
 */
function applyGanttDomainFilter() {
    var checkboxes = document.querySelectorAll('.gantt-domain-cb');
    checkboxes.forEach(function(cb) {
        var dsKey = 'ds-' + cb.value;
        ganttDomainVisibility[dsKey] = cb.checked;
    });
    // 간트차트 재렌더링
    if (currentGanttData) {
        renderGantt(currentGanttData);
    }
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
                html += '<li>' + icon + ' ' + escapeHtml(w.message) + '</li>';
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

    if (ganttInstance) {
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
                sortOrder: taskData.sortOrder,
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
        html += '<tr><th>도메인 시스템</th><td>' + (task.domainSystem ? escapeHtml(task.domainSystem.name) : '-') + '</td></tr>';
        html += '<tr><th>담당자</th><td>' + (task.assignee ? escapeHtml(task.assignee.name) + ' (' + task.assignee.role + ')' : '-') + '</td></tr>';
        html += '<tr><th>시작일</th><td>' + formatDate(task.startDate) + '</td></tr>';
        html += '<tr><th>종료일</th><td>' + formatDate(task.endDate) + '</td></tr>';
        html += '<tr><th>실제 완료일</th><td>' + formatDate(task.actualEndDate) + '</td></tr>';
        html += '<tr><th>공수 (MD)</th><td>' + (task.manDays || '-') + '</td></tr>';
        html += '<tr><th>상태</th><td>' + statusBadge(task.status) + '</td></tr>';
        html += '<tr><th>우선순위</th><td>' + (task.priority ? priorityBadge(task.priority) : '-') + '</td></tr>';
        html += '<tr><th>태스크 유형</th><td>' + (task.type ? taskTypeBadge(task.type) : '-') + '</td></tr>';
        html += '<tr><th>실행 모드</th><td>' + (task.executionMode || 'SEQUENTIAL') + '</td></tr>';
        html += '<tr><th>정렬 순서</th><td>' + (task.sortOrder != null ? task.sortOrder : '-') + '</td></tr>';
        html += '<tr><th>설명</th><td>' + escapeHtml(task.description || '-') + '</td></tr>';
        if (task.dependencies && task.dependencies.length > 0) {
            html += '<tr><th>선행 태스크</th><td>ID: ' + task.dependencies.join(', ') + '</td></tr>';
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
    document.getElementById('task-modal-project-id').value = resolvedProjectId || '';

    // Team Board 컨텍스트 판별 (projectId가 명시적으로 전달된 경우)
    var isTeamBoardContext = !!projectId;

    // 초기화
    document.getElementById('task-id').value = '';
    document.getElementById('task-name').value = '';
    document.getElementById('task-domain-system').value = '';
    document.getElementById('task-assignee').value = '';
    document.getElementById('task-start-date').value = '';
    document.getElementById('task-end-date').value = '';
    document.getElementById('task-man-days').value = '';
    document.getElementById('task-status').value = 'TODO';
    document.getElementById('task-execution-mode').value = 'SEQUENTIAL';
    document.getElementById('task-priority').value = '';
    document.getElementById('task-type').value = '';
    document.getElementById('task-actual-end-date').value = '';
    document.getElementById('task-sort-order').value = '0';
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

    // resolvedProjectId가 없으면 에러 표시
    if (!resolvedProjectId) {
        showToast('프로젝트를 먼저 선택해주세요.', 'warning');
        return;
    }

    // 프로젝트의 도메인 시스템 & 멤버 로드
    var projectRes = await apiCall('/api/v1/projects/' + resolvedProjectId);
    var project = (projectRes.success && projectRes.data) ? projectRes.data : {};

    // 멤버 정보 저장 (capacity 조회용)
    currentProjectMembers = project.members || [];

    // 도메인 시스템 드롭다운
    var dsSelect = document.getElementById('task-domain-system');
    var dsOptHtml = '<option value="">선택하세요</option>';
    if (project.domainSystems) {
        project.domainSystems.forEach(function(ds) {
            dsOptHtml += '<option value="' + ds.id + '">' + escapeHtml(ds.name) + '</option>';
        });
    }
    dsSelect.innerHTML = dsOptHtml;

    // 담당자 드롭다운
    var assigneeSelect = document.getElementById('task-assignee');
    var assigneeOptHtml = '<option value="">선택하세요</option>';
    if (project.members) {
        project.members.forEach(function(m) {
            assigneeOptHtml += '<option value="' + m.id + '">' + escapeHtml(m.name) + ' (' + m.role + ')</option>';
        });
    }
    assigneeSelect.innerHTML = assigneeOptHtml;

    // 의존관계 섹션
    var depsSection = document.getElementById('task-dependencies-section');
    var depsContainer = document.getElementById('task-dependencies-checklist');
    depsContainer.innerHTML = '';
    var currentDependencies = [];

    if (taskId) {
        document.getElementById('taskModalTitle').textContent = '태스크 수정';
        try {
            var res = await apiCall('/api/v1/tasks/' + taskId);
            if (res.success && res.data) {
                var t = res.data;
                document.getElementById('task-id').value = t.id;
                document.getElementById('task-name').value = t.name || '';
                document.getElementById('task-domain-system').value = t.domainSystem ? t.domainSystem.id : '';
                document.getElementById('task-assignee').value = t.assignee ? t.assignee.id : '';
                document.getElementById('task-start-date').value = t.startDate || '';
                document.getElementById('task-end-date').value = t.endDate || '';
                document.getElementById('task-man-days').value = t.manDays || '';
                document.getElementById('task-status').value = t.status || 'TODO';
                document.getElementById('task-execution-mode').value = t.executionMode || 'SEQUENTIAL';
                document.getElementById('task-priority').value = t.priority || '';
                document.getElementById('task-type').value = t.type || '';
                document.getElementById('task-actual-end-date').value = t.actualEndDate || '';
                document.getElementById('task-sort-order').value = t.sortOrder != null ? t.sortOrder : '0';
                document.getElementById('task-description').value = t.description || '';
                currentDependencies = t.dependencies || [];

                // 기존 링크 렌더링
                if (t.links && t.links.length > 0) {
                    t.links.forEach(function(link) {
                        addTaskLinkRow(link.label, link.url);
                    });
                }
            }
        } catch (e) {
            showToast('태스크 정보를 불러오는데 실패했습니다.', 'error');
            return;
        }
    } else {
        document.getElementById('taskModalTitle').textContent = '태스크 추가';
    }

    // Team Board 컨텍스트에서는 의존관계 섹션 숨김
    if (isTeamBoardContext) {
        depsSection.style.display = 'none';
    } else {
        depsSection.style.display = '';
        // 의존관계 체크리스트 렌더링
        if (currentGanttData && currentGanttData.domainSystems) {
            var depsHtml = '';
            currentGanttData.domainSystems.forEach(function(ds) {
                if (ds.tasks) {
                    ds.tasks.forEach(function(task) {
                        // 자기 자신은 제외
                        if (taskId && task.id === parseInt(taskId)) return;
                        var checked = currentDependencies.indexOf(task.id) >= 0 ? 'checked' : '';
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

    // 날짜 필드 표시 모드 설정 (실행 모드에 따라)
    updateTaskDateFieldsVisibility();

    // 기존 태스크 수정 시 프리뷰 호출 (담당자가 이미 선택된 경우)
    if (taskId && document.getElementById('task-assignee').value && document.getElementById('task-execution-mode').value === 'SEQUENTIAL') {
        triggerDatePreview();
    }

    var modal = new bootstrap.Modal(document.getElementById('taskModal'));
    modal.show();
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
    var sortOrder = document.getElementById('task-sort-order').value;
    var description = document.getElementById('task-description').value.trim();

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
            showToast('첫 번째 태스크에는 시작일을 입력해주세요.', 'warning');
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
        sortOrder: parseInt(sortOrder) || 0,
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
            if (currentSection === 'tasks') {
                await applyTasksFilter();
            } else if (currentSection === 'assignee-schedule') {
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
            if (currentSection === 'tasks') {
                await applyTasksFilter();
            } else if (currentSection === 'assignee-schedule') {
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
            html += '<thead><tr><th>태스크명</th><th>담당자</th><th>공수(MD)</th><th>선행 태스크</th></tr></thead>';
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

/**
 * 태스크 섹션 초기 로드
 */
async function loadTasks() {
    try {
        var results = await Promise.all([
            apiCall('/api/v1/projects'),
            apiCall('/api/v1/members')
        ]);
        var projects = (results[0].success && results[0].data) ? results[0].data : [];
        var members = (results[1].success && results[1].data) ? results[1].data : [];

        var projectSelect = document.getElementById('task-filter-project');
        var pOptHtml = '<option value="">전체</option>';
        projects.forEach(function(p) {
            pOptHtml += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
        });
        projectSelect.innerHTML = pOptHtml;

        var assigneeSelect = document.getElementById('task-filter-assignee');
        var aOptHtml = '<option value="">전체</option>';
        members.forEach(function(m) {
            aOptHtml += '<option value="' + m.id + '">' + escapeHtml(m.name) + ' (' + m.role + ')</option>';
        });
        assigneeSelect.innerHTML = aOptHtml;
    } catch (e) {
        console.error('태스크 필터 드롭다운 로드 실패:', e);
    }

    await applyTasksFilter();
}

/**
 * 태스크 필터 적용 및 조회
 */
async function applyTasksFilter() {
    var projectId = document.getElementById('task-filter-project').value;
    var status = document.getElementById('task-filter-status').value;
    var startDate = document.getElementById('task-filter-start-date').value;
    var endDate = document.getElementById('task-filter-end-date').value;
    var assigneeId = document.getElementById('task-filter-assignee').value;
    var priority = document.getElementById('task-filter-priority').value;
    var type = document.getElementById('task-filter-type').value;
    var isDelayed = document.getElementById('task-filter-delayed').checked;
    var unordered = document.getElementById('task-filter-unordered').checked;

    var params = [];
    if (projectId) params.push('projectId=' + encodeURIComponent(projectId));
    if (status) params.push('status=' + encodeURIComponent(status));
    if (startDate) params.push('startDate=' + encodeURIComponent(startDate));
    if (endDate) params.push('endDate=' + encodeURIComponent(endDate));
    if (assigneeId) params.push('assigneeId=' + encodeURIComponent(assigneeId));
    if (priority) params.push('priority=' + encodeURIComponent(priority));
    if (type) params.push('type=' + encodeURIComponent(type));
    if (isDelayed) params.push('isDelayed=true');
    if (unordered) params.push('unordered=true');

    var url = '/api/v1/team-board/tasks';
    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    var tbody = document.getElementById('tasks-table-body');
    tbody.innerHTML = '<tr><td colspan="10" class="text-center"><span class="loading-spinner"></span> 로딩 중...</td></tr>';

    try {
        var res = await apiCall(url);
        if (res.success && res.data) {
            renderTasksTable(res.data);
        } else {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">데이터를 불러오지 못했습니다.</td></tr>';
        }
    } catch (e) {
        console.error('태스크 로드 실패:', e);
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">데이터를 불러오지 못했습니다.</td></tr>';
    }
}

/**
 * 태스크 필터 초기화
 */
function resetTasksFilter() {
    document.getElementById('task-filter-project').value = '';
    document.getElementById('task-filter-status').value = '';
    document.getElementById('task-filter-start-date').value = '';
    document.getElementById('task-filter-end-date').value = '';
    document.getElementById('task-filter-assignee').value = '';
    document.getElementById('task-filter-priority').value = '';
    document.getElementById('task-filter-type').value = '';
    document.getElementById('task-filter-delayed').checked = false;
    document.getElementById('task-filter-unordered').checked = false;
    applyTasksFilter();
}

/**
 * 태스크 테이블 렌더링
 */
function renderTasksTable(data) {
    var tbody = document.getElementById('tasks-table-body');
    var allTasks = [];

    // members 배열 flat
    if (data.members) {
        data.members.forEach(function(member) {
            if (member.tasks) {
                member.tasks.forEach(function(task) {
                    task._assigneeName = member.name;
                    task._assigneeRole = member.role;
                    allTasks.push(task);
                });
            }
        });
    }
    // 미배정 태스크
    if (data.unassigned) {
        data.unassigned.forEach(function(task) {
            task._assigneeName = '';
            allTasks.push(task);
        });
    }

    if (allTasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">표시할 태스크가 없습니다.</td></tr>';
        return;
    }

    var html = '';
    allTasks.forEach(function(task) {
        html += '<tr>';
        html += '<td><span class="text-muted">' + escapeHtml(task.projectName || '-') + '</span></td>';
        html += '<td class="cursor-pointer" onclick="showTaskDetail(' + task.id + ', {projectId:' + task.projectId + '})"><strong>' + escapeHtml(task.name) + '</strong></td>';
        html += '<td>' + taskTypeBadge(task.type) + '</td>';
        html += '<td>' + priorityBadge(task.priority) + '</td>';
        html += '<td>' + escapeHtml(task._assigneeName || '-') + '</td>';
        html += '<td class="text-nowrap">' + formatDate(task.startDate) + '</td>';
        html += '<td class="text-nowrap">' + formatDate(task.endDate) + '</td>';
        html += '<td>' + (task.manDays != null ? task.manDays : '-') + '</td>';
        html += '<td>' + statusBadge(task.status) + '</td>';
        html += '<td class="text-center">';
        html += '<div class="action-buttons">';
        html += '<button class="btn btn-outline-primary btn-sm" onclick="showTaskModal(' + task.id + ', ' + task.projectId + ')" title="수정"><i class="bi bi-pencil"></i></button>';
        html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteTask(' + task.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
        html += '</div>';
        html += '</td>';
        html += '</tr>';
    });
    tbody.innerHTML = html;
}

// ========================================
// 담당자 스케줄 (3패널 레이아웃)
// ========================================

/**
 * 담당자 스케줄 초기 로드
 */
async function loadAssigneeSchedule() {
    try {
        var res = await apiCall('/api/v1/members');
        var members = (res.success && res.data) ? res.data : [];
        var listEl = document.getElementById('schedule-member-list');

        if (members.length === 0) {
            listEl.innerHTML = '<div class="text-center text-muted p-3">등록된 담당자가 없습니다.</div>';
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

        // 이전 선택이 있으면 큐 재로드
        if (currentScheduleMemberId) {
            await selectScheduleMember(currentScheduleMemberId, currentScheduleMemberName);
        }
    } catch (e) {
        console.error('담당자 목록 로드 실패:', e);
    }
}

/**
 * 담당자 선택 시 큐 로드
 */
async function selectScheduleMember(memberId, name) {
    currentScheduleMemberId = memberId;
    currentScheduleMemberName = name;

    // 멤버 리스트 active 상태 업데이트 (data-member-id 기반)
    var items = document.querySelectorAll('#schedule-member-list .schedule-member-item');
    items.forEach(function(item) {
        item.classList.remove('active');
        if (parseInt(item.getAttribute('data-member-id')) === memberId) {
            item.classList.add('active');
        }
    });

    document.getElementById('schedule-member-name').innerHTML = '<strong>' + escapeHtml(name) + '</strong> 태스크 큐';

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
        console.error('담당자 태스크 로드 실패:', e);
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

    tasks.forEach(function(t) {
        if (t.assigneeOrder != null && t.assigneeOrder > 0) {
            ordered.push(t);
        } else {
            unordered.push(t);
        }
    });

    // 순서 있는 태스크
    if (ordered.length > 0) {
        var html = '';
        ordered.sort(function(a, b) { return (a.assigneeOrder || 0) - (b.assigneeOrder || 0); });
        ordered.forEach(function(t, idx) {
            html += '<div class="schedule-task-item d-flex align-items-center" data-task-id="' + t.id + '" onclick="showScheduleTaskDetail(' + t.id + ')">';
            html += '<i class="bi bi-grip-vertical drag-handle cursor-pointer me-2" title="드래그하여 순서 변경"></i>';
            html += '<span class="schedule-task-order">' + (idx + 1) + '</span>';
            html += '<div class="flex-grow-1">';
            html += '<div><strong>' + escapeHtml(t.name) + '</strong></div>';
            html += '<div class="text-muted" style="font-size:0.78rem;">';
            html += escapeHtml(t.projectName || '') + ' | ' + formatDate(t.startDate) + ' ~ ' + formatDate(t.endDate) + ' | ' + (t.manDays || 0) + ' MD';
            html += '</div>';
            html += '</div>';
            html += '<div class="ms-2">' + statusBadge(t.status) + '</div>';
            html += '</div>';
        });
        orderedEl.innerHTML = html;
    } else {
        orderedEl.innerHTML = '<div class="text-center text-muted p-3" style="font-size:0.85rem;">순서 지정된 태스크가 없습니다.</div>';
    }

    // 순서 미지정 태스크
    if (unordered.length > 0) {
        var uHtml = '<div class="mt-3 mb-2"><strong class="text-warning" style="font-size:0.85rem;"><i class="bi bi-exclamation-circle"></i> 순서 미지정 (' + unordered.length + '건)</strong></div>';
        unordered.forEach(function(t) {
            uHtml += '<div class="schedule-task-item" onclick="showScheduleTaskDetail(' + t.id + ')" style="border-left:3px solid #ffc107;">';
            uHtml += '<div><strong>' + escapeHtml(t.name) + '</strong></div>';
            uHtml += '<div class="text-muted" style="font-size:0.78rem;">';
            uHtml += escapeHtml(t.projectName || '') + ' | ' + (t.manDays || 0) + ' MD | ' + statusBadge(t.status);
            uHtml += '</div>';
            uHtml += '</div>';
        });
        unorderedEl.innerHTML = uHtml;
    } else {
        unorderedEl.innerHTML = '';
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
        html += '<tr><th style="width:35%">프로젝트</th><td>' + escapeHtml(task.project ? task.project.name : '-') + '</td></tr>';
        html += '<tr><th>도메인</th><td>' + (task.domainSystem ? escapeHtml(task.domainSystem.name) : '-') + '</td></tr>';
        html += '<tr><th>담당자</th><td>' + (task.assignee ? escapeHtml(task.assignee.name) + ' (' + task.assignee.role + ')' : '-') + '</td></tr>';
        html += '<tr><th>시작일</th><td>' + formatDate(task.startDate) + '</td></tr>';
        html += '<tr><th>종료일</th><td>' + formatDate(task.endDate) + '</td></tr>';
        html += '<tr><th>공수</th><td>' + (task.manDays || '-') + ' MD</td></tr>';
        html += '<tr><th>상태</th><td>' + statusBadge(task.status) + '</td></tr>';
        html += '<tr><th>우선순위</th><td>' + (task.priority ? priorityBadge(task.priority) : '-') + '</td></tr>';
        html += '<tr><th>유형</th><td>' + (task.type ? taskTypeBadge(task.type) : '-') + '</td></tr>';
        html += '<tr><th>실행모드</th><td>' + (task.executionMode || 'SEQUENTIAL') + '</td></tr>';
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

    var container = document.getElementById('schedule-ordered-tasks');
    if (!container) return;

    new Sortable(container, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: function() {
            var items = container.querySelectorAll('.schedule-task-item[data-task-id]');
            var taskIds = [];
            items.forEach(function(item) {
                taskIds.push(parseInt(item.getAttribute('data-task-id')));
            });
            if (taskIds.length > 0) {
                reorderAssigneeTasks(memberId, taskIds);
            }
        }
    });
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
    if (executionMode === 'SEQUENTIAL') {
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
        assigneeSelect.addEventListener('change', function() {
            checkAssigneeConflict();
            updateTaskDateFieldsVisibility();
            triggerDatePreview();
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

    if (executionMode === 'PARALLEL') {
        // PARALLEL 모드: 기존 방식 (시작일/종료일 직접 입력)
        startDateGroup.style.display = '';
        endDateGroup.style.display = '';
        startDateInput.readOnly = false;
        endDateInput.readOnly = false;
        startDateInput.required = true;
        endDateInput.required = true;
        autoDateInfo.style.display = 'none';
        isFirstTask = true; // PARALLEL에서는 의미 없으므로 true
    } else {
        // SEQUENTIAL 모드
        endDateInput.readOnly = true;
        endDateInput.required = false;

        if (!assigneeId) {
            // 담당자 미선택: 필드 표시하지만 비활성
            startDateGroup.style.display = '';
            endDateGroup.style.display = '';
            startDateInput.readOnly = false;
            startDateInput.required = true;
            autoDateInfo.style.display = 'none';
            isFirstTask = true;
        } else if (isFirstTask) {
            // 첫 번째 태스크: 시작일 직접 입력, 종료일 읽기 전용
            startDateGroup.style.display = '';
            endDateGroup.style.display = '';
            startDateInput.readOnly = false;
            startDateInput.required = true;
            autoDateInfo.style.display = 'block';
            autoDateMsg.textContent = '첫 번째 태스크: 시작일을 입력하면 종료일이 공수 기반으로 자동 계산됩니다.';
        } else {
            // 후속 태스크: 시작일/종료일 모두 읽기 전용
            startDateGroup.style.display = '';
            endDateGroup.style.display = '';
            startDateInput.readOnly = true;
            startDateInput.required = false;
            autoDateInfo.style.display = 'block';
            autoDateMsg.textContent = '후속 태스크: 시작일/종료일이 선행 태스크 기준으로 자동 계산됩니다. 저장 시 확정됩니다.';
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
    if (executionMode !== 'SEQUENTIAL') return;

    var assigneeId = document.getElementById('task-assignee').value;
    if (!assigneeId) return;

    var resolvedProjectId = currentModalProjectId || currentProjectId;
    if (!resolvedProjectId) return;

    var manDaysVal = document.getElementById('task-man-days').value;
    var manDays = manDaysVal ? parseFloat(manDaysVal) : null;
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
            if (!isFirstTask && res.data.startDate) {
                document.getElementById('task-start-date').value = res.data.startDate;
            }
            if (res.data.endDate) {
                document.getElementById('task-end-date').value = res.data.endDate;
            } else if (isFirstTask && manDays) {
                // 첫 번째 태스크: 시작일 + 공수로 종료일 계산 (클라이언트 측 간이 계산, capacity 반영)
                var startDate = document.getElementById('task-start-date').value;
                if (startDate) {
                    var capacity = getSelectedAssigneeCapacity();
                    document.getElementById('task-end-date').value = calculateEndDateClient(startDate, manDays, capacity);
                }
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

    var d = new Date(startDateStr + 'T00:00:00');

    // 시작일이 주말이면 다음 월요일로 보정 (서버 로직과 일치)
    var startDow = d.getDay();
    if (startDow === 0) {
        d.setDate(d.getDate() + 1); // 일요일 -> 월요일
    } else if (startDow === 6) {
        d.setDate(d.getDate() + 2); // 토요일 -> 월요일
    }

    var daysAdded = 1;

    while (daysAdded < businessDays) {
        d.setDate(d.getDate() + 1);
        var dow = d.getDay();
        if (dow !== 0 && dow !== 6) {
            daysAdded++;
        }
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
    row.innerHTML = '<input type="text" class="form-control form-control-sm task-link-label" placeholder="라벨" style="width:30%;" value="' + escapeHtml(label || '') + '">'
        + '<input type="url" class="form-control form-control-sm task-link-url" placeholder="URL (https://...)" style="flex:1;" value="' + escapeHtml(url || '') + '">'
        + '<button type="button" class="btn btn-outline-danger btn-sm" onclick="removeTaskLinkRow(this)" title="삭제"><i class="bi bi-x-lg"></i></button>';

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
        var res = await apiCall('/api/v1/tasks/assignee-order', 'PATCH', {
            assigneeId: assigneeId,
            taskIds: taskIds
        });

        if (res.success) {
            showToast('태스크 순서가 변경되었습니다. 날짜가 재계산됩니다.', 'success');
            // 담당자 스케줄 새로고침
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
                { label: '담당자 미지정', count: data.orphanTaskCount, icon: 'bi-person-x', color: 'warning' },
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
        html += '<div>' + getWarningIcon(w.type) + ' <strong style="font-size:0.85rem;">' + escapeHtml(w.type) + '</strong></div>';
        html += '<div style="font-size:0.85rem;">' + escapeHtml(w.message) + '</div>';
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
                showProjectDetail(projectId, 'overview');
            }
            break;
        case 'UNAVAILABLE_DATE':
            showSection('settings');
            // 개인휴무 탭 활성화
            setTimeout(function() {
                var tabEl = document.querySelector('#settings-tabs a[href="#settings-leaves"]');
                if (tabEl) {
                    var bsTab = new bootstrap.Tab(tabEl);
                    bsTab.show();
                }
            }, 100);
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

    await loadHolidays();
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
// Member Leave (개인 휴무) 관리
// ========================================

/**
 * 개인 휴무 목록 조회
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
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">등록된 개인 휴무가 없습니다.</td></tr>';
            return;
        }

        var html = '';
        leaves.forEach(function(l) {
            html += '<tr>';
            html += '<td>' + formatDate(l.date) + '</td>';
            html += '<td>' + escapeHtml(l.reason || '-') + '</td>';
            html += '<td class="text-center">';
            html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteMemberLeave(' + memberId + ', ' + l.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
            html += '</td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
    } catch (e) {
        console.error('개인 휴무 목록 로드 실패:', e);
        showToast('개인 휴무 목록을 불러오는데 실패했습니다.', 'error');
    }
}

/**
 * 개인 휴무 추가 모달 표시
 */
function showMemberLeaveModal() {
    document.getElementById('leave-date').value = '';
    document.getElementById('leave-reason').value = '';
    var modal = new bootstrap.Modal(document.getElementById('memberLeaveModal'));
    modal.show();
}

/**
 * 개인 휴무 저장
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
            showToast('개인 휴무가 추가되었습니다.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('memberLeaveModal')).hide();
            loadMemberLeaves();
        } else {
            showToast(res.message || '저장에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('개인 휴무 저장 실패:', e);
        showToast('개인 휴무 저장에 실패했습니다.', 'error');
    }
}

/**
 * 개인 휴무 삭제
 */
async function deleteMemberLeave(memberId, leaveId) {
    if (!confirmAction('이 개인 휴무를 삭제하시겠습니까?')) return;

    try {
        var res = await apiCall('/api/v1/members/' + memberId + '/leaves/' + leaveId, 'DELETE');
        if (res.success) {
            showToast('삭제되었습니다.', 'success');
            loadMemberLeaves();
        } else {
            showToast(res.message || '삭제에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('개인 휴무 삭제 실패:', e);
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
                case '#tab-overview':
                    loadProjectOverview(currentDetailProjectId);
                    break;
                case '#tab-tasks':
                    loadProjectTasks(currentDetailProjectId);
                    break;
                case '#tab-schedule':
                    loadProjectSchedule(currentDetailProjectId);
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

    loadDashboard();
});
