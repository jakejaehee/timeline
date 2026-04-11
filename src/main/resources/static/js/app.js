// ========================================
// Timeline Application JavaScript
// Version: 20260412a
// ========================================

// ---- 전역 상태 ----
var currentSection = 'dashboard';
var currentProjectId = null;     // 간트차트에서 사용 중인 프로젝트 ID
var currentGanttData = null;     // 간트차트 원본 데이터
var ganttInstance = null;        // frappe-gantt 인스턴스
var currentViewMode = 'Week';   // 간트차트 뷰 모드
var parsedTaskData = null;       // AI 파싱 결과 임시 저장
var currentModalProjectId = null; // 태스크 모달에서 사용 중인 프로젝트 ID (Team Board 지원)
var isFirstTask = true;          // 현재 모달의 태스크가 첫 번째 태스크인지
var previewDebounceTimer = null; // 프리뷰 API 호출 디바운스 타이머
var currentProjectMembers = [];  // 태스크 모달에서 사용 중인 프로젝트 멤버 목록 (capacity 조회용)

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
 * 유형 배지 HTML
 */
function typeBadge(type) {
    return '<span class="badge-status badge-' + type + '">' + type + '</span>';
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

    // 섹션 데이터 로드
    switch (sectionName) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'projects':
            loadProjects();
            break;
        case 'members':
            loadMembers();
            break;
        case 'domain-systems':
            loadDomainSystems();
            break;
        case 'ai-parser':
            loadAiParserProjects();
            break;
        case 'team-board':
            loadTeamBoard();
            break;
    }
}

// ========================================
// Dashboard
// ========================================

async function loadDashboard() {
    try {
        // 프로젝트, 멤버 데이터를 병렬로 로드
        var results = await Promise.all([
            apiCall('/api/v1/projects'),
            apiCall('/api/v1/members')
        ]);
        var projectsRes = results[0];
        var membersRes = results[1];

        var projects = (projectsRes.success && projectsRes.data) ? projectsRes.data : [];
        var members = (membersRes.success && membersRes.data) ? membersRes.data : [];

        // 진행 중인 프로젝트 수
        var inProgressProjects = projects.filter(function(p) {
            return p.status === 'IN_PROGRESS';
        });
        document.getElementById('stat-projects').textContent = inProgressProjects.length;

        // 전체 멤버 수
        document.getElementById('stat-members').textContent = members.length;

        // 전체 태스크 수 계산 (각 프로젝트에서 태스크 병렬 로드)
        var totalTasks = 0;
        var taskPromises = projects.map(function(p) {
            return apiCall('/api/v1/projects/' + p.id + '/tasks').catch(function() {
                return { success: false };
            });
        });
        var taskResults = await Promise.all(taskPromises);
        taskResults.forEach(function(taskRes) {
            if (taskRes.success && taskRes.data && taskRes.data.domainSystems) {
                taskRes.data.domainSystems.forEach(function(ds) {
                    totalTasks += (ds.tasks ? ds.tasks.length : 0);
                });
            }
        });
        document.getElementById('stat-tasks').textContent = totalTasks;

        // 최근 프로젝트 목록
        var tbody = document.getElementById('dashboard-projects-table');
        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">등록된 프로젝트가 없습니다.</td></tr>';
        } else {
            var html = '';
            // 최근 5개만 표시
            var recentProjects = projects.slice(0, 5);
            recentProjects.forEach(function(p) {
                html += '<tr>';
                html += '<td>' + escapeHtml(p.name) + '</td>';
                html += '<td>' + typeBadge(p.type) + '</td>';
                html += '<td>' + statusBadge(p.status) + '</td>';
                html += '<td>' + formatDate(p.startDate) + ' ~ ' + formatDate(p.endDate) + '</td>';
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
    try {
        var res = await apiCall('/api/v1/projects');
        var projects = (res.success && res.data) ? res.data : [];
        var tbody = document.getElementById('projects-table');

        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">등록된 프로젝트가 없습니다.</td></tr>';
            return;
        }

        var html = '';
        projects.forEach(function(p) {
            var memberCount = (p.members && p.members.length) ? p.members.length : 0;
            var delayHtml = '';
            if (p.isDelayed === true) {
                delayHtml = '<span class="delay-indicator delayed"><i class="bi bi-exclamation-triangle-fill"></i> 지연</span>';
            } else if (p.isDelayed === false) {
                delayHtml = '<span class="delay-indicator on-track"><i class="bi bi-check-circle-fill"></i> 정상</span>';
            } else {
                delayHtml = '-';
            }
            html += '<tr>';
            html += '<td><strong>' + escapeHtml(p.name) + '</strong></td>';
            html += '<td>' + typeBadge(p.type) + '</td>';
            html += '<td>' + statusBadge(p.status) + '</td>';
            html += '<td>' + formatDate(p.startDate) + '</td>';
            html += '<td>' + formatDate(p.endDate) + '</td>';
            html += '<td>' + formatDate(p.deadline) + '</td>';
            html += '<td>' + delayHtml + '</td>';
            html += '<td>' + memberCount + '명</td>';
            html += '<td class="text-center">';
            html += '<div class="action-buttons">';
            html += '<button class="btn btn-outline-info btn-sm" onclick="showGanttChart(' + p.id + ')" title="간트차트"><i class="bi bi-bar-chart-steps"></i> 간트</button>';
            html += '<button class="btn btn-outline-primary btn-sm" onclick="showProjectModal(' + p.id + ')" title="수정"><i class="bi bi-pencil"></i></button>';
            html += '<button class="btn btn-outline-danger btn-sm" onclick="deleteProject(' + p.id + ')" title="삭제"><i class="bi bi-trash"></i></button>';
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

async function showProjectModal(projectId) {
    // 폼 초기화
    document.getElementById('project-id').value = '';
    document.getElementById('project-name').value = '';
    document.getElementById('project-type').value = 'SKU_SYSTEM';
    document.getElementById('project-description').value = '';
    document.getElementById('project-start-date').value = '';
    document.getElementById('project-end-date').value = '';
    document.getElementById('project-deadline').value = '';
    document.getElementById('project-status').value = 'PLANNING';
    document.getElementById('project-delay-warning').style.display = 'none';
    document.getElementById('project-delay-warning').innerHTML = '';

    // 멤버/도메인시스템 체크리스트 병렬 로드
    var checklistResults = await Promise.all([
        apiCall('/api/v1/members'),
        apiCall('/api/v1/domain-systems')
    ]);
    var membersRes = checklistResults[0];
    var dsRes = checklistResults[1];
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
                document.getElementById('project-type').value = p.type || 'SKU_SYSTEM';
                document.getElementById('project-description').value = p.description || '';
                document.getElementById('project-start-date').value = p.startDate || '';
                document.getElementById('project-end-date').value = p.endDate || '';
                document.getElementById('project-deadline').value = p.deadline || '';
                document.getElementById('project-status').value = p.status || 'PLANNING';
                currentMembers = p.members ? p.members.map(function(m) { return m.id; }) : [];
                currentDs = p.domainSystems ? p.domainSystems.map(function(d) { return d.id; }) : [];

                // 지연 경고 표시
                var delayWarning = document.getElementById('project-delay-warning');
                if (p.isDelayed === true) {
                    delayWarning.innerHTML = '<div class="alert alert-danger mb-0 py-2 px-3" style="font-size:0.85rem;">'
                        + '<i class="bi bi-exclamation-triangle-fill"></i> <strong>지연 경고:</strong> '
                        + '예상 종료일(' + formatDate(p.expectedEndDate) + ')이 데드라인(' + formatDate(p.deadline) + ')을 초과합니다.'
                        + '</div>';
                    delayWarning.style.display = 'block';
                } else if (p.isDelayed === false) {
                    delayWarning.innerHTML = '<div class="alert alert-success mb-0 py-2 px-3" style="font-size:0.85rem;">'
                        + '<i class="bi bi-check-circle-fill"></i> 예상 종료일(' + formatDate(p.expectedEndDate) + ')이 데드라인 내에 있습니다.'
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
    var type = document.getElementById('project-type').value;
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

    var deadline = document.getElementById('project-deadline').value;

    var body = {
        name: name,
        type: type,
        description: description,
        startDate: startDate,
        endDate: endDate,
        deadline: deadline || null,
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

async function showGanttChart(projectId) {
    currentProjectId = projectId;
    currentSection = 'gantt';

    // 섹션 전환
    var sections = document.querySelectorAll('.section');
    sections.forEach(function(section) {
        section.style.display = 'none';
    });
    document.getElementById('gantt-section').style.display = 'block';

    // 사이드바 활성화 해제 (간트 뷰는 별도)
    var navLinks = document.querySelectorAll('#sidebar .nav-link');
    navLinks.forEach(function(link) {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === 'projects') {
            link.classList.add('active');
        }
    });

    await loadGanttData(projectId);
}

async function loadGanttData(projectId) {
    try {
        var res = await apiCall('/api/v1/projects/' + projectId + '/tasks');
        if (res.success && res.data) {
            currentGanttData = res.data;
            document.getElementById('gantt-project-title').textContent = res.data.project.name + ' - 간트차트';
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

    // frappe-gantt 데이터 변환
    var tasks = [];
    var hasTasks = false;

    if (data.domainSystems) {
        data.domainSystems.forEach(function(ds) {
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
                showTaskDetail(task._taskId);
            },
            on_date_change: function(task, start, end) {
                onTaskDateChange(task, start, end);
            }
        });
    } catch (e) {
        console.error('간트차트 렌더링 실패:', e);
        chartContainer.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>간트차트 렌더링에 실패했습니다.</p></div>';
    }
}

function changeGanttViewMode(mode) {
    currentViewMode = mode;

    // 버튼 활성화 표시
    var buttons = document.querySelectorAll('.section-header .btn-group .btn');
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
    document.getElementById('task-status').value = 'PENDING';
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

    // 프로젝트의 도메인 시스템 & 멤버 로드
    var projectRes = await apiCall('/api/v1/projects/' + resolvedProjectId);
    var project = (projectRes.success && projectRes.data) ? projectRes.data : {};

    // 멤버 정보 저장 (capacity 조회용)
    currentProjectMembers = project.members || [];

    // 도메인 시스템 드롭다운
    var dsSelect = document.getElementById('task-domain-system');
    dsSelect.innerHTML = '<option value="">선택하세요</option>';
    if (project.domainSystems) {
        project.domainSystems.forEach(function(ds) {
            dsSelect.innerHTML += '<option value="' + ds.id + '">' + escapeHtml(ds.name) + '</option>';
        });
    }

    // 담당자 드롭다운
    var assigneeSelect = document.getElementById('task-assignee');
    assigneeSelect.innerHTML = '<option value="">선택하세요</option>';
    if (project.members) {
        project.members.forEach(function(m) {
            assigneeSelect.innerHTML += '<option value="' + m.id + '">' + escapeHtml(m.name) + ' (' + m.role + ')</option>';
        });
    }

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
                document.getElementById('task-status').value = t.status || 'PENDING';
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
            if (currentSection === 'team-board') {
                await applyTeamBoardFilter();
            } else {
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
            if (currentSection === 'team-board') {
                await applyTeamBoardFilter();
            } else {
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
        select.innerHTML = '<option value="">프로젝트를 선택하세요</option>';
        projects.forEach(function(p) {
            select.innerHTML += '<option value="' + p.id + '">' + escapeHtml(p.name) + ' (' + p.status + ')</option>';
        });
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
// Team Board
// ========================================

/**
 * Team Board 초기 로드
 */
async function loadTeamBoard() {
    // 프로젝트 필터 드롭다운 로드
    try {
        var res = await apiCall('/api/v1/projects');
        var projects = (res.success && res.data) ? res.data : [];
        var select = document.getElementById('tb-filter-project');
        select.innerHTML = '<option value="">전체</option>';
        projects.forEach(function(p) {
            select.innerHTML += '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
        });
    } catch (e) {
        console.error('Team Board 프로젝트 목록 로드 실패:', e);
    }

    // 데이터 로드
    await applyTeamBoardFilter();
}

/**
 * Team Board 필터 적용 및 조회
 */
async function applyTeamBoardFilter() {
    var projectId = document.getElementById('tb-filter-project').value;
    var status = document.getElementById('tb-filter-status').value;
    var startDate = document.getElementById('tb-filter-start-date').value;
    var endDate = document.getElementById('tb-filter-end-date').value;

    var params = [];
    if (projectId) params.push('projectId=' + encodeURIComponent(projectId));
    if (status) params.push('status=' + encodeURIComponent(status));
    if (startDate) params.push('startDate=' + encodeURIComponent(startDate));
    if (endDate) params.push('endDate=' + encodeURIComponent(endDate));

    var url = '/api/v1/team-board/tasks';
    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    // 로딩 표시
    var container = document.getElementById('team-board-content');
    container.innerHTML = '<div class="empty-state"><span class="loading-spinner"></span> 로딩 중...</div>';

    try {
        var res = await apiCall(url);
        if (res.success && res.data) {
            renderTeamBoard(res.data);
        } else {
            showToast(res.message || 'Team Board 로드에 실패했습니다.', 'error');
            container.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-circle"></i><p>데이터를 불러오지 못했습니다.</p></div>';
        }
    } catch (e) {
        console.error('Team Board 로드 실패:', e);
        showToast('Team Board 로드에 실패했습니다.', 'error');
        container.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-circle"></i><p>데이터를 불러오지 못했습니다.</p></div>';
    }
}

/**
 * Team Board 필터 초기화
 */
function resetTeamBoardFilter() {
    document.getElementById('tb-filter-project').value = '';
    document.getElementById('tb-filter-status').value = '';
    document.getElementById('tb-filter-start-date').value = '';
    document.getElementById('tb-filter-end-date').value = '';
    applyTeamBoardFilter();
}

/**
 * Team Board 렌더링
 */
function renderTeamBoard(data) {
    var container = document.getElementById('team-board-content');
    var html = '';

    var hasMembers = data.members && data.members.length > 0;
    var hasUnassigned = data.unassigned && data.unassigned.length > 0;

    if (!hasMembers && !hasUnassigned) {
        container.innerHTML = '<div class="empty-state"><i class="bi bi-kanban"></i><p>표시할 태스크가 없습니다.</p></div>';
        return;
    }

    // 멤버별 카드
    if (hasMembers) {
        data.members.forEach(function(member) {
            html += '<div class="card mb-3">';
            html += '<div class="card-header d-flex justify-content-between align-items-center">';
            html += '<div>';
            html += '<strong>' + escapeHtml(member.name) + '</strong> ';
            html += roleBadge(member.role);
            html += '</div>';
            html += '<span class="badge bg-secondary">' + member.tasks.length + '개 태스크</span>';
            html += '</div>';
            html += '<div class="card-body p-0">';
            html += '<div class="table-responsive">';
            html += '<table class="table table-hover mb-0">';
            html += '<thead><tr>';
            html += '<th>프로젝트</th><th>태스크명</th><th>우선순위</th><th>유형</th><th>상태</th><th>기간</th><th>공수</th><th>도메인 시스템</th>';
            html += '</tr></thead>';
            html += '<tbody>';
            member.tasks.forEach(function(task) {
                html += '<tr class="cursor-pointer" onclick="showTeamBoardTaskDetail(' + task.id + ', ' + task.projectId + ')">';
                html += '<td><span class="text-muted">' + escapeHtml(task.projectName) + '</span></td>';
                html += '<td><strong>' + escapeHtml(task.name) + '</strong></td>';
                html += '<td>' + priorityBadge(task.priority) + '</td>';
                html += '<td>' + taskTypeBadge(task.type) + '</td>';
                html += '<td>' + statusBadge(task.status) + '</td>';
                html += '<td class="text-nowrap">' + formatDate(task.startDate) + ' ~ ' + formatDate(task.endDate) + '</td>';
                html += '<td>' + (task.manDays != null ? task.manDays + ' MD' : '-') + '</td>';
                html += '<td>';
                if (task.domainSystemColor) {
                    html += '<span class="color-preview" style="background-color:' + sanitizeColor(task.domainSystemColor) + ';width:12px;height:12px;"></span>';
                }
                html += escapeHtml(task.domainSystemName || '-');
                html += '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            html += '</div></div></div>';
        });
    }

    // 미지정 태스크
    if (hasUnassigned) {
        html += '<div class="card mb-3">';
        html += '<div class="card-header d-flex justify-content-between align-items-center">';
        html += '<div>';
        html += '<strong><i class="bi bi-person-dash"></i> 담당자 미지정</strong>';
        html += '</div>';
        html += '<span class="badge bg-warning text-dark">' + data.unassigned.length + '개 태스크</span>';
        html += '</div>';
        html += '<div class="card-body p-0">';
        html += '<div class="table-responsive">';
        html += '<table class="table table-hover mb-0">';
        html += '<thead><tr>';
        html += '<th>프로젝트</th><th>태스크명</th><th>우선순위</th><th>유형</th><th>상태</th><th>기간</th><th>공수</th><th>도메인 시스템</th>';
        html += '</tr></thead>';
        html += '<tbody>';
        data.unassigned.forEach(function(task) {
            html += '<tr class="cursor-pointer" onclick="showTeamBoardTaskDetail(' + task.id + ', ' + task.projectId + ')">';
            html += '<td><span class="text-muted">' + escapeHtml(task.projectName) + '</span></td>';
            html += '<td><strong>' + escapeHtml(task.name) + '</strong></td>';
            html += '<td>' + priorityBadge(task.priority) + '</td>';
            html += '<td>' + taskTypeBadge(task.type) + '</td>';
            html += '<td>' + statusBadge(task.status) + '</td>';
            html += '<td class="text-nowrap">' + formatDate(task.startDate) + ' ~ ' + formatDate(task.endDate) + '</td>';
            html += '<td>' + (task.manDays != null ? task.manDays + ' MD' : '-') + '</td>';
            html += '<td>';
            if (task.domainSystemColor) {
                html += '<span class="color-preview" style="background-color:' + sanitizeColor(task.domainSystemColor) + ';width:12px;height:12px;"></span>';
            }
            html += escapeHtml(task.domainSystemName || '-');
            html += '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        html += '</div></div></div>';
    }

    container.innerHTML = html;
}

/**
 * Team Board 태스크 클릭 시 상세 보기
 * - projectId를 전달하여 수정 시 도메인 시스템/멤버 로드에 사용
 */
function showTeamBoardTaskDetail(taskId, projectId) {
    showTaskDetail(taskId, { projectId: projectId });
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
// 초기화
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    initColorPicker();
    initAssigneeConflictCheck();
    loadDashboard();
});
