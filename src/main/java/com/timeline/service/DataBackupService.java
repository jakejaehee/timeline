package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.repository.*;
import com.timeline.dto.BackupDto;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 전체 DB 데이터 Export/Import 서비스
 * schema.sql의 모든 데이터 테이블을 빠짐없이 백업/복원
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DataBackupService {

    private final MemberRepository memberRepository;
    private final SquadRepository squadRepository;
    private final SquadMemberRepository squadMemberRepository;
    private final ProjectRepository projectRepository;
    private final ProjectMilestoneRepository projectMilestoneRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectSquadRepository projectSquadRepository;
    private final ProjectLinkRepository projectLinkRepository;
    private final ProjectNoteRepository projectNoteRepository;
    private final HolidayRepository holidayRepository;
    private final TaskRepository taskRepository;
    private final TaskLinkRepository taskLinkRepository;
    private final TaskDependencyRepository taskDependencyRepository;
    private final MemberLeaveRepository memberLeaveRepository;
    private final JiraConfigRepository jiraConfigRepository;
    private final GoogleDriveConfigRepository googleDriveConfigRepository;

    @PersistenceContext
    private EntityManager em;

    // ========================================
    // Export
    // ========================================

    public BackupDto.Snapshot exportAll() {
        log.info("데이터 Export 시작");

        BackupDto.Snapshot snapshot = BackupDto.Snapshot.builder()
                .schemaVersion("2.0")
                .exportedAt(LocalDateTime.now())
                .members(memberRepository.findAll().stream().map(this::toMemberRow).collect(Collectors.toList()))
                .squads(squadRepository.findAll().stream().map(this::toSquadRow).collect(Collectors.toList()))
                .squadMembers(squadMemberRepository.findAll().stream().map(this::toSquadMemberRow).collect(Collectors.toList()))
                .projects(projectRepository.findAll().stream().map(this::toProjectRow).collect(Collectors.toList()))
                .projectMilestones(projectMilestoneRepository.findAll().stream().map(this::toProjectMilestoneRow).collect(Collectors.toList()))
                .projectMembers(projectMemberRepository.findAll().stream().map(this::toProjectMemberRow).collect(Collectors.toList()))
                .projectSquads(projectSquadRepository.findAll().stream().map(this::toProjectSquadRow).collect(Collectors.toList()))
                .projectLinks(projectLinkRepository.findAll().stream().map(this::toProjectLinkRow).collect(Collectors.toList()))
                .projectNotes(projectNoteRepository.findAll().stream().map(this::toProjectNoteRow).collect(Collectors.toList()))
                .holidays(holidayRepository.findAll().stream().map(this::toHolidayRow).collect(Collectors.toList()))
                .tasks(taskRepository.findAll().stream().map(this::toTaskRow).collect(Collectors.toList()))
                .taskLinks(taskLinkRepository.findAll().stream().map(this::toTaskLinkRow).collect(Collectors.toList()))
                .taskDependencies(taskDependencyRepository.findAll().stream().map(this::toTaskDependencyRow).collect(Collectors.toList()))
                .memberLeaves(memberLeaveRepository.findAll().stream().map(this::toMemberLeaveRow).collect(Collectors.toList()))
                .jiraConfigs(jiraConfigRepository.findAll().stream().map(this::toJiraConfigRow).collect(Collectors.toList()))
                .googleDriveConfigs(googleDriveConfigRepository.findAll().stream().map(this::toGoogleDriveConfigRow).collect(Collectors.toList()))
                .build();

        log.info("데이터 Export 완료: members={}, projects={}, tasks={}",
                snapshot.getMembers().size(), snapshot.getProjects().size(), snapshot.getTasks().size());

        return snapshot;
    }

    // ========================================
    // Import
    // ========================================

    @Transactional
    public BackupDto.ImportResult importAll(BackupDto.Snapshot snapshot) {
        log.info("데이터 Import 시작");
        validateSnapshot(snapshot);

        // FK 역순으로 전체 데이터 삭제
        deleteAllInOrder();

        // CHECK 제약조건 최신화 (백업 데이터의 enum 값이 현재 스키마와 맞도록)
        refreshCheckConstraints();

        int totalRows = 0;
        int totalTables = 0;

        // 삽입 순서 (FK 의존성 순서)
        totalRows += insertMembers(safe(snapshot.getMembers())); totalTables++;
        totalRows += insertSquads(safe(snapshot.getSquads())); totalTables++;
        totalRows += insertSquadMembers(safe(snapshot.getSquadMembers())); totalTables++;
        totalRows += insertHolidays(safe(snapshot.getHolidays())); totalTables++;
        totalRows += insertProjects(safe(snapshot.getProjects())); totalTables++;
        totalRows += insertProjectMilestones(safe(snapshot.getProjectMilestones())); totalTables++;
        totalRows += insertProjectMembers(safe(snapshot.getProjectMembers())); totalTables++;
        totalRows += insertProjectSquads(safe(snapshot.getProjectSquads())); totalTables++;
        totalRows += insertProjectLinks(safe(snapshot.getProjectLinks())); totalTables++;
        totalRows += insertProjectNotes(safe(snapshot.getProjectNotes())); totalTables++;
        totalRows += insertTasks(safe(snapshot.getTasks())); totalTables++;
        totalRows += insertTaskLinks(safe(snapshot.getTaskLinks())); totalTables++;
        totalRows += insertTaskDependencies(safe(snapshot.getTaskDependencies())); totalTables++;
        totalRows += insertMemberLeaves(safe(snapshot.getMemberLeaves())); totalTables++;
        totalRows += insertJiraConfigs(safe(snapshot.getJiraConfigs())); totalTables++;
        totalRows += insertGoogleDriveConfigs(safe(snapshot.getGoogleDriveConfigs())); totalTables++;

        em.flush();
        em.clear();
        resetSequences();

        BackupDto.ImportResult result = BackupDto.ImportResult.builder()
                .totalTables(totalTables)
                .totalRows(totalRows)
                .build();

        log.info("데이터 Import 완료: {}", result.toSummaryMessage());
        return result;
    }

    private void validateSnapshot(BackupDto.Snapshot snapshot) {
        if (snapshot == null) {
            throw new IllegalArgumentException("유효하지 않은 백업 파일입니다: 데이터가 비어 있습니다.");
        }
        String ver = snapshot.getSchemaVersion();
        if (ver == null || ver.isBlank()) {
            throw new IllegalArgumentException("유효하지 않은 백업 파일입니다: schemaVersion 필드가 없습니다.");
        }
        if (!"1.0".equals(ver) && !"2.0".equals(ver)) {
            throw new IllegalArgumentException("지원하지 않는 schemaVersion입니다: " + ver);
        }
    }

    // ========================================
    // 삭제 (FK 역순)
    // ========================================

    private void deleteAllInOrder() {
        log.debug("전체 데이터 삭제 시작 (FK 역순)");
        taskDependencyRepository.deleteAllInBatch();
        taskLinkRepository.deleteAllInBatch();
        taskRepository.deleteAllInBatch();
        projectLinkRepository.deleteAllInBatch();
        projectNoteRepository.deleteAllInBatch();
        projectMilestoneRepository.deleteAllInBatch();
        projectMemberRepository.deleteAllInBatch();
        projectSquadRepository.deleteAllInBatch();
        memberLeaveRepository.deleteAllInBatch();
        projectRepository.deleteAllInBatch();
        squadMemberRepository.deleteAllInBatch();
        squadRepository.deleteAllInBatch();
        holidayRepository.deleteAllInBatch();
        memberRepository.deleteAllInBatch();
        jiraConfigRepository.deleteAllInBatch();
        googleDriveConfigRepository.deleteAllInBatch();
        em.flush();
        log.debug("전체 데이터 삭제 완료");
    }

    /**
     * CHECK 제약조건을 소스코드 기준 최신 enum 값으로 갱신
     */
    private void refreshCheckConstraints() {
        try {
            em.createNativeQuery("ALTER TABLE member DROP CONSTRAINT IF EXISTS member_role_check").executeUpdate();
            em.createNativeQuery("ALTER TABLE member ADD CONSTRAINT member_role_check CHECK (role IN ('BE', 'FE', 'QA', 'PM', 'EM', 'PD'))").executeUpdate();
            em.createNativeQuery("ALTER TABLE task DROP CONSTRAINT IF EXISTS task_status_check").executeUpdate();
            em.createNativeQuery("ALTER TABLE task ADD CONSTRAINT task_status_check CHECK (status IN ('TODO', 'IN_PROGRESS', 'COMPLETED', 'DONE', 'HOLD', 'CANCELLED'))").executeUpdate();
            em.createNativeQuery("ALTER TABLE task DROP CONSTRAINT IF EXISTS task_priority_check").executeUpdate();
            em.createNativeQuery("ALTER TABLE task ADD CONSTRAINT task_priority_check CHECK (priority IN ('P0', 'P1', 'P2', 'P3'))").executeUpdate();
            em.createNativeQuery("ALTER TABLE task DROP CONSTRAINT IF EXISTS task_type_check").executeUpdate();
            em.createNativeQuery("ALTER TABLE task ADD CONSTRAINT task_type_check CHECK (type IN ('FEATURE', 'DESIGN', 'BACKEND', 'INFRA', 'QA', 'RELEASE', 'OPS', 'TECH_DEBT'))").executeUpdate();
            em.createNativeQuery("ALTER TABLE task DROP CONSTRAINT IF EXISTS task_execution_mode_check").executeUpdate();
            em.createNativeQuery("ALTER TABLE task ADD CONSTRAINT task_execution_mode_check CHECK (execution_mode IN ('SEQUENTIAL', 'PARALLEL'))").executeUpdate();
            em.createNativeQuery("ALTER TABLE holiday DROP CONSTRAINT IF EXISTS holiday_type_check").executeUpdate();
            em.createNativeQuery("ALTER TABLE holiday ADD CONSTRAINT holiday_type_check CHECK (type IN ('NATIONAL', 'COMPANY'))").executeUpdate();
            em.createNativeQuery("ALTER TABLE project DROP CONSTRAINT IF EXISTS project_status_check").executeUpdate();
            em.createNativeQuery("ALTER TABLE project ADD CONSTRAINT project_status_check CHECK (status IN ('PLANNING', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'))").executeUpdate();
            em.flush();
            log.debug("CHECK 제약조건 최신화 완료");
        } catch (Exception e) {
            log.warn("CHECK 제약조건 최신화 실패: {}", e.getMessage());
        }
    }

    // ========================================
    // Native INSERT (모든 컬럼 포함)
    // ========================================

    private int insertMembers(List<BackupDto.MemberRow> rows) {
        for (var r : rows) {
            // 레거시 role 변환: PLACEHOLDER → PD, ENGINEER → EM
            String role = r.getRole();
            if ("PLACEHOLDER".equals(role)) role = "PD";
            if ("ENGINEER".equals(role)) role = "EM";
            em.createNativeQuery("INSERT INTO member (id, name, role, team, email, capacity, active, queue_start_date, created_at, updated_at) VALUES (:id, :name, :role, :team, :email, :capacity, :active, :queueStartDate, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("name", r.getName()).setParameter("role", role)
                    .setParameter("team", r.getTeam()).setParameter("email", r.getEmail()).setParameter("capacity", r.getCapacity())
                    .setParameter("active", r.getActive()).setParameter("queueStartDate", r.getQueueStartDate())
                    .setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertSquads(List<BackupDto.SquadRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO squad (id, name, description, color, created_at, updated_at) VALUES (:id, :name, :description, :color, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("name", r.getName()).setParameter("description", r.getDescription())
                    .setParameter("color", r.getColor()).setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertSquadMembers(List<BackupDto.SquadMemberRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO squad_member (id, squad_id, member_id, created_at) VALUES (:id, :squadId, :memberId, :createdAt)")
                    .setParameter("id", r.getId()).setParameter("squadId", r.getSquadId()).setParameter("memberId", r.getMemberId())
                    .setParameter("createdAt", r.getCreatedAt()).executeUpdate();
        }
        return rows.size();
    }

    private int insertProjects(List<BackupDto.ProjectRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO project (id, name, description, jira_board_id, jira_epic_key, total_man_days_override, quarter, status, ktlo, sort_order, ppl_id, epl_id, start_date, end_date, created_at, updated_at) VALUES (:id, :name, :description, :jiraBoardId, :jiraEpicKey, :totalManDaysOverride, :quarter, :status, :ktlo, :sortOrder, :pplId, :eplId, :startDate, :endDate, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("name", r.getName()).setParameter("description", r.getDescription())
                    .setParameter("jiraBoardId", r.getJiraBoardId()).setParameter("jiraEpicKey", r.getJiraEpicKey())
                    .setParameter("totalManDaysOverride", r.getTotalManDaysOverride()).setParameter("quarter", r.getQuarter())
                    .setParameter("status", r.getStatus()).setParameter("ktlo", r.getKtlo() != null ? r.getKtlo() : false)
                    .setParameter("sortOrder", r.getSortOrder()).setParameter("pplId", r.getPplId()).setParameter("eplId", r.getEplId())
                    .setParameter("startDate", r.getStartDate()).setParameter("endDate", r.getEndDate())
                    .setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertProjectMilestones(List<BackupDto.ProjectMilestoneRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO project_milestone (id, project_id, name, type, start_date, end_date, days, qa_assignees, sort_order, created_at) VALUES (:id, :projectId, :name, :type, :startDate, :endDate, :days, :qaAssignees, :sortOrder, :createdAt)")
                    .setParameter("id", r.getId()).setParameter("projectId", r.getProjectId()).setParameter("name", r.getName())
                    .setParameter("type", r.getType()).setParameter("startDate", r.getStartDate()).setParameter("endDate", r.getEndDate())
                    .setParameter("days", r.getDays()).setParameter("qaAssignees", r.getQaAssignees())
                    .setParameter("sortOrder", r.getSortOrder()).setParameter("createdAt", r.getCreatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertProjectMembers(List<BackupDto.ProjectMemberRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO project_member (id, project_id, member_id, created_at) VALUES (:id, :projectId, :memberId, :createdAt)")
                    .setParameter("id", r.getId()).setParameter("projectId", r.getProjectId()).setParameter("memberId", r.getMemberId())
                    .setParameter("createdAt", r.getCreatedAt()).executeUpdate();
        }
        return rows.size();
    }

    private int insertProjectSquads(List<BackupDto.ProjectSquadRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO project_squad (id, project_id, squad_id, created_at) VALUES (:id, :projectId, :squadId, :createdAt)")
                    .setParameter("id", r.getId()).setParameter("projectId", r.getProjectId()).setParameter("squadId", r.getSquadId())
                    .setParameter("createdAt", r.getCreatedAt()).executeUpdate();
        }
        return rows.size();
    }

    private int insertProjectLinks(List<BackupDto.ProjectLinkRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO project_link (id, project_id, url, label, created_at) VALUES (:id, :projectId, :url, :label, :createdAt)")
                    .setParameter("id", r.getId()).setParameter("projectId", r.getProjectId())
                    .setParameter("url", r.getUrl()).setParameter("label", r.getLabel())
                    .setParameter("createdAt", r.getCreatedAt()).executeUpdate();
        }
        return rows.size();
    }

    private int insertProjectNotes(List<BackupDto.ProjectNoteRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO project_note (id, project_id, content, created_at, updated_at) VALUES (:id, :projectId, :content, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("projectId", r.getProjectId())
                    .setParameter("content", r.getContent()).setParameter("createdAt", r.getCreatedAt())
                    .setParameter("updatedAt", r.getUpdatedAt()).executeUpdate();
        }
        return rows.size();
    }

    private int insertHolidays(List<BackupDto.HolidayRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO holiday (id, date, name, type, created_at, updated_at) VALUES (:id, :date, :name, :type, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("date", r.getDate()).setParameter("name", r.getName())
                    .setParameter("type", r.getType()).setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertTasks(List<BackupDto.TaskRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO task (id, project_id, squad_id, assignee_id, name, description, status, priority, type, execution_mode, man_days, start_date, end_date, actual_end_date, jira_key, sort_order, assignee_order, created_at, updated_at) VALUES (:id, :projectId, :squadId, :assigneeId, :name, :description, :status, :priority, :type, :executionMode, :manDays, :startDate, :endDate, :actualEndDate, :jiraKey, :sortOrder, :assigneeOrder, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("projectId", r.getProjectId()).setParameter("squadId", r.getSquadId())
                    .setParameter("assigneeId", r.getAssigneeId()).setParameter("name", r.getName()).setParameter("description", r.getDescription())
                    .setParameter("status", r.getStatus()).setParameter("priority", r.getPriority()).setParameter("type", r.getType())
                    .setParameter("executionMode", r.getExecutionMode()).setParameter("manDays", r.getManDays())
                    .setParameter("startDate", r.getStartDate()).setParameter("endDate", r.getEndDate())
                    .setParameter("actualEndDate", r.getActualEndDate()).setParameter("jiraKey", r.getJiraKey())
                    .setParameter("sortOrder", r.getSortOrder()).setParameter("assigneeOrder", r.getAssigneeOrder())
                    .setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertTaskLinks(List<BackupDto.TaskLinkRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO task_link (id, task_id, url, label, created_at) VALUES (:id, :taskId, :url, :label, :createdAt)")
                    .setParameter("id", r.getId()).setParameter("taskId", r.getTaskId())
                    .setParameter("url", r.getUrl()).setParameter("label", r.getLabel())
                    .setParameter("createdAt", r.getCreatedAt()).executeUpdate();
        }
        return rows.size();
    }

    private int insertTaskDependencies(List<BackupDto.TaskDependencyRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO task_dependency (id, task_id, depends_on_task_id, created_at) VALUES (:id, :taskId, :dependsOnTaskId, :createdAt)")
                    .setParameter("id", r.getId()).setParameter("taskId", r.getTaskId())
                    .setParameter("dependsOnTaskId", r.getDependsOnTaskId()).setParameter("createdAt", r.getCreatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertMemberLeaves(List<BackupDto.MemberLeaveRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO member_leave (id, member_id, date, reason, created_at, updated_at) VALUES (:id, :memberId, :date, :reason, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("memberId", r.getMemberId()).setParameter("date", r.getDate())
                    .setParameter("reason", r.getReason()).setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertJiraConfigs(List<BackupDto.JiraConfigRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO jira_config (id, base_url, email, api_token, created_at, updated_at) VALUES (:id, :baseUrl, :email, :apiToken, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("baseUrl", r.getBaseUrl()).setParameter("email", r.getEmail())
                    .setParameter("apiToken", r.getApiToken()).setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertGoogleDriveConfigs(List<BackupDto.GoogleDriveConfigRow> rows) {
        for (var r : rows) {
            em.createNativeQuery("INSERT INTO google_drive_config (id, client_id, client_secret, refresh_token, folder_id, created_at, updated_at) VALUES (:id, :clientId, :clientSecret, :refreshToken, :folderId, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId()).setParameter("clientId", r.getClientId()).setParameter("clientSecret", r.getClientSecret())
                    .setParameter("refreshToken", r.getRefreshToken()).setParameter("folderId", r.getFolderId())
                    .setParameter("createdAt", r.getCreatedAt()).setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    // ========================================
    // Sequence 리셋
    // ========================================

    private void resetSequences() {
        String[] tables = {
                "member", "squad", "squad_member", "project", "project_milestone",
                "project_member", "project_squad", "project_link", "project_note", "holiday",
                "task", "task_link", "task_dependency", "member_leave",
                "jira_config", "google_drive_config"
        };
        for (String table : tables) {
            try {
                em.createNativeQuery("SELECT setval('" + table + "_id_seq', (SELECT COALESCE(MAX(id), 0) FROM " + table + ") + 1, false)")
                        .getSingleResult();
            } catch (Exception e) {
                log.warn("sequence 리셋 실패 ({}): {}", table, e.getMessage());
            }
        }
    }

    // ========================================
    // Entity → Row 변환
    // ========================================

    private BackupDto.MemberRow toMemberRow(Member m) {
        return BackupDto.MemberRow.builder().id(m.getId()).name(m.getName())
                .role(m.getRole() != null ? m.getRole().name() : null).team(m.getTeam())
                .email(m.getEmail()).capacity(m.getCapacity()).active(m.getActive())
                .queueStartDate(m.getQueueStartDate()).createdAt(m.getCreatedAt()).updatedAt(m.getUpdatedAt()).build();
    }

    private BackupDto.SquadRow toSquadRow(Squad s) {
        return BackupDto.SquadRow.builder().id(s.getId()).name(s.getName()).description(s.getDescription())
                .color(s.getColor()).createdAt(s.getCreatedAt()).updatedAt(s.getUpdatedAt()).build();
    }

    private BackupDto.SquadMemberRow toSquadMemberRow(SquadMember sm) {
        return BackupDto.SquadMemberRow.builder().id(sm.getId()).squadId(sm.getSquad().getId())
                .memberId(sm.getMember().getId()).createdAt(sm.getCreatedAt()).build();
    }

    private BackupDto.ProjectRow toProjectRow(Project p) {
        return BackupDto.ProjectRow.builder().id(p.getId()).name(p.getName()).description(p.getDescription())
                .jiraBoardId(p.getJiraBoardId()).jiraEpicKey(p.getJiraEpicKey())
                .totalManDaysOverride(p.getTotalManDaysOverride()).quarter(p.getQuarter())
                .status(p.getStatus() != null ? p.getStatus().name() : null)
                .ktlo(p.getKtlo()).sortOrder(p.getSortOrder())
                .pplId(p.getPpl() != null ? p.getPpl().getId() : null)
                .eplId(p.getEpl() != null ? p.getEpl().getId() : null)
                .startDate(p.getStartDate()).endDate(p.getEndDate())
                .createdAt(p.getCreatedAt()).updatedAt(p.getUpdatedAt()).build();
    }

    private BackupDto.ProjectMilestoneRow toProjectMilestoneRow(ProjectMilestone m) {
        return BackupDto.ProjectMilestoneRow.builder().id(m.getId()).projectId(m.getProject().getId())
                .name(m.getName()).type(m.getType() != null ? m.getType().name() : null)
                .startDate(m.getStartDate()).endDate(m.getEndDate()).days(m.getDays())
                .qaAssignees(m.getQaAssignees()).sortOrder(m.getSortOrder()).createdAt(m.getCreatedAt()).build();
    }

    private BackupDto.ProjectMemberRow toProjectMemberRow(ProjectMember pm) {
        return BackupDto.ProjectMemberRow.builder().id(pm.getId()).projectId(pm.getProject().getId())
                .memberId(pm.getMember().getId()).createdAt(pm.getCreatedAt()).build();
    }

    private BackupDto.ProjectSquadRow toProjectSquadRow(ProjectSquad ps) {
        return BackupDto.ProjectSquadRow.builder().id(ps.getId()).projectId(ps.getProject().getId())
                .squadId(ps.getSquad().getId()).createdAt(ps.getCreatedAt()).build();
    }

    private BackupDto.ProjectLinkRow toProjectLinkRow(ProjectLink pl) {
        return BackupDto.ProjectLinkRow.builder().id(pl.getId()).projectId(pl.getProject().getId())
                .url(pl.getUrl()).label(pl.getLabel()).createdAt(pl.getCreatedAt()).build();
    }

    private BackupDto.ProjectNoteRow toProjectNoteRow(ProjectNote pn) {
        return BackupDto.ProjectNoteRow.builder().id(pn.getId()).projectId(pn.getProject().getId())
                .content(pn.getContent()).createdAt(pn.getCreatedAt()).updatedAt(pn.getUpdatedAt()).build();
    }

    private BackupDto.HolidayRow toHolidayRow(Holiday h) {
        return BackupDto.HolidayRow.builder().id(h.getId()).date(h.getDate()).name(h.getName())
                .type(h.getType() != null ? h.getType().name() : null)
                .createdAt(h.getCreatedAt()).updatedAt(h.getUpdatedAt()).build();
    }

    private BackupDto.TaskRow toTaskRow(Task t) {
        return BackupDto.TaskRow.builder().id(t.getId()).projectId(t.getProject().getId())
                .squadId(t.getSquad() != null ? t.getSquad().getId() : null)
                .assigneeId(t.getAssignee() != null ? t.getAssignee().getId() : null)
                .name(t.getName()).description(t.getDescription())
                .status(t.getStatus() != null ? t.getStatus().name() : null)
                .priority(t.getPriority() != null ? t.getPriority().name() : null)
                .type(t.getType() != null ? t.getType().name() : null)
                .executionMode(t.getExecutionMode() != null ? t.getExecutionMode().name() : null)
                .manDays(t.getManDays()).startDate(t.getStartDate()).endDate(t.getEndDate())
                .actualEndDate(t.getActualEndDate()).jiraKey(t.getJiraKey())
                .sortOrder(t.getSortOrder()).assigneeOrder(t.getAssigneeOrder())
                .createdAt(t.getCreatedAt()).updatedAt(t.getUpdatedAt()).build();
    }

    private BackupDto.TaskLinkRow toTaskLinkRow(TaskLink tl) {
        return BackupDto.TaskLinkRow.builder().id(tl.getId()).taskId(tl.getTask().getId())
                .url(tl.getUrl()).label(tl.getLabel()).createdAt(tl.getCreatedAt()).build();
    }

    private BackupDto.TaskDependencyRow toTaskDependencyRow(TaskDependency td) {
        return BackupDto.TaskDependencyRow.builder().id(td.getId()).taskId(td.getTask().getId())
                .dependsOnTaskId(td.getDependsOnTask().getId()).createdAt(td.getCreatedAt()).build();
    }

    private BackupDto.MemberLeaveRow toMemberLeaveRow(MemberLeave ml) {
        return BackupDto.MemberLeaveRow.builder().id(ml.getId()).memberId(ml.getMember().getId())
                .date(ml.getDate()).reason(ml.getReason())
                .createdAt(ml.getCreatedAt()).updatedAt(ml.getUpdatedAt()).build();
    }

    private BackupDto.JiraConfigRow toJiraConfigRow(JiraConfig jc) {
        return BackupDto.JiraConfigRow.builder().id(jc.getId()).baseUrl(jc.getBaseUrl())
                .email(jc.getEmail()).apiToken(jc.getApiToken())
                .createdAt(jc.getCreatedAt()).updatedAt(jc.getUpdatedAt()).build();
    }

    private BackupDto.GoogleDriveConfigRow toGoogleDriveConfigRow(GoogleDriveConfig gc) {
        return BackupDto.GoogleDriveConfigRow.builder().id(gc.getId()).clientId(gc.getClientId())
                .clientSecret(gc.getClientSecret()).refreshToken(gc.getRefreshToken()).folderId(gc.getFolderId())
                .createdAt(gc.getCreatedAt()).updatedAt(gc.getUpdatedAt()).build();
    }

    private <T> List<T> safe(List<T> list) {
        return list != null ? list : Collections.emptyList();
    }
}
