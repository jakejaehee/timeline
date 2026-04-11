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
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DataBackupService {

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

    @PersistenceContext
    private EntityManager em;

    /**
     * 전체 DB 데이터를 Snapshot으로 반환
     */
    public BackupDto.Snapshot exportAll() {
        log.info("데이터 Export 시작");

        BackupDto.Snapshot snapshot = BackupDto.Snapshot.builder()
                .schemaVersion("1.0")
                .exportedAt(LocalDateTime.now())
                .members(memberRepository.findAll().stream().map(this::toMemberRow).collect(Collectors.toList()))
                .domainSystems(domainSystemRepository.findAll().stream().map(this::toDomainSystemRow).collect(Collectors.toList()))
                .projects(projectRepository.findAll().stream().map(this::toProjectRow).collect(Collectors.toList()))
                .holidays(holidayRepository.findAll().stream().map(this::toHolidayRow).collect(Collectors.toList()))
                .projectMembers(projectMemberRepository.findAll().stream().map(this::toProjectMemberRow).collect(Collectors.toList()))
                .projectDomainSystems(projectDomainSystemRepository.findAll().stream().map(this::toProjectDomainSystemRow).collect(Collectors.toList()))
                .tasks(taskRepository.findAll().stream().map(this::toTaskRow).collect(Collectors.toList()))
                .memberLeaves(memberLeaveRepository.findAll().stream().map(this::toMemberLeaveRow).collect(Collectors.toList()))
                .taskLinks(taskLinkRepository.findAll().stream().map(this::toTaskLinkRow).collect(Collectors.toList()))
                .taskDependencies(taskDependencyRepository.findAll().stream().map(this::toTaskDependencyRow).collect(Collectors.toList()))
                .build();

        log.info("데이터 Export 완료: members={}, projects={}, tasks={}",
                snapshot.getMembers().size(), snapshot.getProjects().size(), snapshot.getTasks().size());

        return snapshot;
    }

    /**
     * Snapshot을 검증 후 전체 삭제 → 재삽입 (원본 ID 유지)
     */
    @Transactional
    public BackupDto.ImportResult importAll(BackupDto.Snapshot snapshot) {
        log.info("데이터 Import 시작");

        // 유효성 검증
        validateSnapshot(snapshot);

        // FK 역순으로 전체 데이터 삭제
        deleteAllInOrder();

        // 삽입 순서대로 Native INSERT 실행
        int memberCount = insertMembers(safe(snapshot.getMembers()));
        int domainSystemCount = insertDomainSystems(safe(snapshot.getDomainSystems()));
        int projectCount = insertProjects(safe(snapshot.getProjects()));
        int holidayCount = insertHolidays(safe(snapshot.getHolidays()));
        int projectMemberCount = insertProjectMembers(safe(snapshot.getProjectMembers()));
        int projectDomainSystemCount = insertProjectDomainSystems(safe(snapshot.getProjectDomainSystems()));
        int taskCount = insertTasks(safe(snapshot.getTasks()));
        int memberLeaveCount = insertMemberLeaves(safe(snapshot.getMemberLeaves()));
        int taskLinkCount = insertTaskLinks(safe(snapshot.getTaskLinks()));
        int taskDependencyCount = insertTaskDependencies(safe(snapshot.getTaskDependencies()));

        // JPA 캐시 동기화
        em.flush();
        em.clear();

        // PostgreSQL sequence 리셋
        resetSequences();

        BackupDto.ImportResult result = BackupDto.ImportResult.builder()
                .members(memberCount)
                .domainSystems(domainSystemCount)
                .projects(projectCount)
                .holidays(holidayCount)
                .projectMembers(projectMemberCount)
                .projectDomainSystems(projectDomainSystemCount)
                .tasks(taskCount)
                .memberLeaves(memberLeaveCount)
                .taskLinks(taskLinkCount)
                .taskDependencies(taskDependencyCount)
                .build();

        log.info("데이터 Import 완료: {}", result.toSummaryMessage());
        return result;
    }

    // ========================================
    // 유효성 검증
    // ========================================

    private void validateSnapshot(BackupDto.Snapshot snapshot) {
        if (snapshot == null) {
            throw new IllegalArgumentException("유효하지 않은 백업 파일입니다: 데이터가 비어 있습니다.");
        }
        if (snapshot.getSchemaVersion() == null || snapshot.getSchemaVersion().isBlank()) {
            throw new IllegalArgumentException("유효하지 않은 백업 파일입니다: schemaVersion 필드가 없습니다.");
        }
        if (!"1.0".equals(snapshot.getSchemaVersion())) {
            throw new IllegalArgumentException("지원하지 않는 schemaVersion입니다: " + snapshot.getSchemaVersion());
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
        projectMemberRepository.deleteAllInBatch();
        projectDomainSystemRepository.deleteAllInBatch();
        memberLeaveRepository.deleteAllInBatch();
        projectRepository.deleteAllInBatch();
        domainSystemRepository.deleteAllInBatch();
        holidayRepository.deleteAllInBatch();
        memberRepository.deleteAllInBatch();
        em.flush();
        log.debug("전체 데이터 삭제 완료");
    }

    // ========================================
    // Native INSERT
    // ========================================

    private int insertMembers(List<BackupDto.MemberRow> rows) {
        for (BackupDto.MemberRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO member (id, name, role, email, capacity, active, queue_start_date, created_at, updated_at) " +
                    "VALUES (:id, :name, :role, :email, :capacity, :active, :queueStartDate, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId())
                    .setParameter("name", r.getName())
                    .setParameter("role", r.getRole())
                    .setParameter("email", r.getEmail())
                    .setParameter("capacity", r.getCapacity())
                    .setParameter("active", r.getActive())
                    .setParameter("queueStartDate", r.getQueueStartDate())
                    .setParameter("createdAt", r.getCreatedAt())
                    .setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertDomainSystems(List<BackupDto.DomainSystemRow> rows) {
        for (BackupDto.DomainSystemRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO domain_system (id, name, description, color, created_at, updated_at) " +
                    "VALUES (:id, :name, :description, :color, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId())
                    .setParameter("name", r.getName())
                    .setParameter("description", r.getDescription())
                    .setParameter("color", r.getColor())
                    .setParameter("createdAt", r.getCreatedAt())
                    .setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertProjects(List<BackupDto.ProjectRow> rows) {
        for (BackupDto.ProjectRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO project (id, name, project_type, description, start_date, end_date, status, created_at, updated_at) " +
                    "VALUES (:id, :name, :projectType, :description, :startDate, :endDate, :status, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId())
                    .setParameter("name", r.getName())
                    .setParameter("projectType", r.getProjectType())
                    .setParameter("description", r.getDescription())
                    .setParameter("startDate", r.getStartDate())
                    .setParameter("endDate", r.getEndDate())
                    .setParameter("status", r.getStatus())
                    .setParameter("createdAt", r.getCreatedAt())
                    .setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertHolidays(List<BackupDto.HolidayRow> rows) {
        for (BackupDto.HolidayRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO holiday (id, date, name, type, created_at, updated_at) " +
                    "VALUES (:id, :date, :name, :type, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId())
                    .setParameter("date", r.getDate())
                    .setParameter("name", r.getName())
                    .setParameter("type", r.getType())
                    .setParameter("createdAt", r.getCreatedAt())
                    .setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertProjectMembers(List<BackupDto.ProjectMemberRow> rows) {
        for (BackupDto.ProjectMemberRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO project_member (id, project_id, member_id, created_at) " +
                    "VALUES (:id, :projectId, :memberId, :createdAt)")
                    .setParameter("id", r.getId())
                    .setParameter("projectId", r.getProjectId())
                    .setParameter("memberId", r.getMemberId())
                    .setParameter("createdAt", r.getCreatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertProjectDomainSystems(List<BackupDto.ProjectDomainSystemRow> rows) {
        for (BackupDto.ProjectDomainSystemRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO project_domain_system (id, project_id, domain_system_id, created_at) " +
                    "VALUES (:id, :projectId, :domainSystemId, :createdAt)")
                    .setParameter("id", r.getId())
                    .setParameter("projectId", r.getProjectId())
                    .setParameter("domainSystemId", r.getDomainSystemId())
                    .setParameter("createdAt", r.getCreatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertTasks(List<BackupDto.TaskRow> rows) {
        for (BackupDto.TaskRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO task (id, project_id, domain_system_id, assignee_id, name, description, " +
                    "start_date, end_date, man_days, status, execution_mode, priority, type, " +
                    "actual_end_date, assignee_order, sort_order, created_at, updated_at) " +
                    "VALUES (:id, :projectId, :domainSystemId, :assigneeId, :name, :description, " +
                    ":startDate, :endDate, :manDays, :status, :executionMode, :priority, :type, " +
                    ":actualEndDate, :assigneeOrder, :sortOrder, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId())
                    .setParameter("projectId", r.getProjectId())
                    .setParameter("domainSystemId", r.getDomainSystemId())
                    .setParameter("assigneeId", r.getAssigneeId())
                    .setParameter("name", r.getName())
                    .setParameter("description", r.getDescription())
                    .setParameter("startDate", r.getStartDate())
                    .setParameter("endDate", r.getEndDate())
                    .setParameter("manDays", r.getManDays())
                    .setParameter("status", r.getStatus())
                    .setParameter("executionMode", r.getExecutionMode())
                    .setParameter("priority", r.getPriority())
                    .setParameter("type", r.getType())
                    .setParameter("actualEndDate", r.getActualEndDate())
                    .setParameter("assigneeOrder", r.getAssigneeOrder())
                    .setParameter("sortOrder", r.getSortOrder())
                    .setParameter("createdAt", r.getCreatedAt())
                    .setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertMemberLeaves(List<BackupDto.MemberLeaveRow> rows) {
        for (BackupDto.MemberLeaveRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO member_leave (id, member_id, date, reason, created_at, updated_at) " +
                    "VALUES (:id, :memberId, :date, :reason, :createdAt, :updatedAt)")
                    .setParameter("id", r.getId())
                    .setParameter("memberId", r.getMemberId())
                    .setParameter("date", r.getDate())
                    .setParameter("reason", r.getReason())
                    .setParameter("createdAt", r.getCreatedAt())
                    .setParameter("updatedAt", r.getUpdatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertTaskLinks(List<BackupDto.TaskLinkRow> rows) {
        for (BackupDto.TaskLinkRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO task_link (id, task_id, url, label, created_at) " +
                    "VALUES (:id, :taskId, :url, :label, :createdAt)")
                    .setParameter("id", r.getId())
                    .setParameter("taskId", r.getTaskId())
                    .setParameter("url", r.getUrl())
                    .setParameter("label", r.getLabel())
                    .setParameter("createdAt", r.getCreatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    private int insertTaskDependencies(List<BackupDto.TaskDependencyRow> rows) {
        for (BackupDto.TaskDependencyRow r : rows) {
            em.createNativeQuery(
                    "INSERT INTO task_dependency (id, task_id, depends_on_task_id, created_at) " +
                    "VALUES (:id, :taskId, :dependsOnTaskId, :createdAt)")
                    .setParameter("id", r.getId())
                    .setParameter("taskId", r.getTaskId())
                    .setParameter("dependsOnTaskId", r.getDependsOnTaskId())
                    .setParameter("createdAt", r.getCreatedAt())
                    .executeUpdate();
        }
        return rows.size();
    }

    // ========================================
    // Sequence 리셋
    // ========================================

    private void resetSequences() {
        log.debug("PostgreSQL sequence 리셋 시작");
        String[] tables = {
                "member", "domain_system", "project", "holiday",
                "project_member", "project_domain_system", "task",
                "member_leave", "task_link", "task_dependency"
        };
        for (String table : tables) {
            String seqName = table + "_id_seq";
            em.createNativeQuery(
                    "SELECT setval('" + seqName + "', (SELECT COALESCE(MAX(id), 0) FROM " + table + ") + 1, false)")
                    .getSingleResult();
        }
        log.debug("PostgreSQL sequence 리셋 완료");
    }

    // ========================================
    // Entity → Row 변환 헬퍼
    // ========================================

    private BackupDto.MemberRow toMemberRow(Member m) {
        return BackupDto.MemberRow.builder()
                .id(m.getId())
                .name(m.getName())
                .role(m.getRole() != null ? m.getRole().name() : null)
                .email(m.getEmail())
                .capacity(m.getCapacity())
                .active(m.getActive())
                .queueStartDate(m.getQueueStartDate())
                .createdAt(m.getCreatedAt())
                .updatedAt(m.getUpdatedAt())
                .build();
    }

    private BackupDto.DomainSystemRow toDomainSystemRow(DomainSystem ds) {
        return BackupDto.DomainSystemRow.builder()
                .id(ds.getId())
                .name(ds.getName())
                .description(ds.getDescription())
                .color(ds.getColor())
                .createdAt(ds.getCreatedAt())
                .updatedAt(ds.getUpdatedAt())
                .build();
    }

    private BackupDto.ProjectRow toProjectRow(Project p) {
        return BackupDto.ProjectRow.builder()
                .id(p.getId())
                .name(p.getName())
                .projectType(p.getProjectType())
                .description(p.getDescription())
                .startDate(p.getStartDate())
                .endDate(p.getEndDate())
                .status(p.getStatus() != null ? p.getStatus().name() : null)
                .createdAt(p.getCreatedAt())
                .updatedAt(p.getUpdatedAt())
                .build();
    }

    private BackupDto.HolidayRow toHolidayRow(Holiday h) {
        return BackupDto.HolidayRow.builder()
                .id(h.getId())
                .date(h.getDate())
                .name(h.getName())
                .type(h.getType() != null ? h.getType().name() : null)
                .createdAt(h.getCreatedAt())
                .updatedAt(h.getUpdatedAt())
                .build();
    }

    private BackupDto.ProjectMemberRow toProjectMemberRow(ProjectMember pm) {
        return BackupDto.ProjectMemberRow.builder()
                .id(pm.getId())
                .projectId(pm.getProject().getId())
                .memberId(pm.getMember().getId())
                .createdAt(pm.getCreatedAt())
                .build();
    }

    private BackupDto.ProjectDomainSystemRow toProjectDomainSystemRow(ProjectDomainSystem pds) {
        return BackupDto.ProjectDomainSystemRow.builder()
                .id(pds.getId())
                .projectId(pds.getProject().getId())
                .domainSystemId(pds.getDomainSystem().getId())
                .createdAt(pds.getCreatedAt())
                .build();
    }

    private BackupDto.TaskRow toTaskRow(Task t) {
        return BackupDto.TaskRow.builder()
                .id(t.getId())
                .projectId(t.getProject().getId())
                .domainSystemId(t.getDomainSystem().getId())
                .assigneeId(t.getAssignee() != null ? t.getAssignee().getId() : null)
                .name(t.getName())
                .description(t.getDescription())
                .startDate(t.getStartDate())
                .endDate(t.getEndDate())
                .manDays(t.getManDays())
                .status(t.getStatus() != null ? t.getStatus().name() : null)
                .executionMode(t.getExecutionMode() != null ? t.getExecutionMode().name() : null)
                .priority(t.getPriority() != null ? t.getPriority().name() : null)
                .type(t.getType() != null ? t.getType().name() : null)
                .actualEndDate(t.getActualEndDate())
                .assigneeOrder(t.getAssigneeOrder())
                .sortOrder(t.getSortOrder())
                .createdAt(t.getCreatedAt())
                .updatedAt(t.getUpdatedAt())
                .build();
    }

    private BackupDto.MemberLeaveRow toMemberLeaveRow(MemberLeave ml) {
        return BackupDto.MemberLeaveRow.builder()
                .id(ml.getId())
                .memberId(ml.getMember().getId())
                .date(ml.getDate())
                .reason(ml.getReason())
                .createdAt(ml.getCreatedAt())
                .updatedAt(ml.getUpdatedAt())
                .build();
    }

    private BackupDto.TaskLinkRow toTaskLinkRow(TaskLink tl) {
        return BackupDto.TaskLinkRow.builder()
                .id(tl.getId())
                .taskId(tl.getTask().getId())
                .url(tl.getUrl())
                .label(tl.getLabel())
                .createdAt(tl.getCreatedAt())
                .build();
    }

    private BackupDto.TaskDependencyRow toTaskDependencyRow(TaskDependency td) {
        return BackupDto.TaskDependencyRow.builder()
                .id(td.getId())
                .taskId(td.getTask().getId())
                .dependsOnTaskId(td.getDependsOnTask().getId())
                .createdAt(td.getCreatedAt())
                .build();
    }

    // ========================================
    // 유틸
    // ========================================

    private <T> List<T> safe(List<T> list) {
        return list != null ? list : Collections.emptyList();
    }
}
