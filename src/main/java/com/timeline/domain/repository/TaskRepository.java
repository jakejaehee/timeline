package com.timeline.domain.repository;

import com.timeline.domain.entity.Task;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskPriority;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.enums.TaskType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface TaskRepository extends JpaRepository<Task, Long> {

    /**
     * 프로젝트별 태스크 조회 (간트차트용)
     * - assignee, domainSystem을 JOIN FETCH하여 N+1 방지
     * - sortOrder 기준 정렬
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "LEFT JOIN FETCH t.assignee " +
            "WHERE t.project.id = :projectId " +
            "ORDER BY t.domainSystem.name ASC NULLS LAST, t.sortOrder ASC, t.startDate ASC")
    List<Task> findByProjectIdWithDetails(@Param("projectId") Long projectId);

    /**
     * 태스크 단건 조회 (연관 엔티티 포함)
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "LEFT JOIN FETCH t.assignee " +
            "WHERE t.id = :taskId")
    Optional<Task> findByIdWithDetails(@Param("taskId") Long taskId);

    /**
     * 담당자별 기간 중복 검사 (SEQUENTIAL 모드인 태스크만 충돌 대상)
     * - 특정 담당자가 주어진 기간에 이미 다른 태스크를 수행 중인지 확인
     * - 기간 겹침 조건: 기존태스크.startDate <= newEndDate AND 기존태스크.endDate >= newStartDate
     * - 자기 자신은 제외 (수정 시)
     * - PARALLEL 모드인 기존 태스크는 충돌 대상에서 제외
     * - HOLD/CANCELLED 상태 태스크는 충돌 대상에서 제외
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.startDate <= :endDate " +
            "AND t.endDate >= :startDate " +
            "AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId) " +
            "AND t.executionMode = :sequentialMode " +
            "AND t.status NOT IN :excludeStatuses")
    List<Task> findOverlappingTasks(
            @Param("assigneeId") Long assigneeId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate,
            @Param("excludeTaskId") Long excludeTaskId,
            @Param("sequentialMode") TaskExecutionMode sequentialMode,
            @Param("excludeStatuses") List<TaskStatus> excludeStatuses);

    /**
     * 담당자별 태스크 조회
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "WHERE t.assignee.id = :assigneeId " +
            "ORDER BY t.startDate ASC")
    List<Task> findByAssigneeIdWithDetails(@Param("assigneeId") Long assigneeId);

    /**
     * 전체 태스크 조회 (팀 보드용) - 필터 조건 적용
     * - project, domainSystem, assignee JOIN FETCH
     * - 동적 필터: status, projectId, startDate/endDate 범위, assigneeId, priority, type, unordered, isDelayed
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "LEFT JOIN FETCH t.assignee " +
            "WHERE (:status IS NULL OR t.status = :status) " +
            "AND (:projectId IS NULL OR t.project.id = :projectId) " +
            "AND (:startDate IS NULL OR t.endDate >= :startDate) " +
            "AND (:endDate IS NULL OR t.startDate <= :endDate) " +
            "AND (:assigneeId IS NULL OR t.assignee.id = :assigneeId) " +
            "AND (:priority IS NULL OR t.priority = :priority) " +
            "AND (:type IS NULL OR t.type = :type) " +
            "AND (:unordered IS NULL OR :unordered = false OR t.assigneeOrder IS NULL) " +
            "AND (:isDelayed IS NULL OR :isDelayed = false OR (t.endDate < CURRENT_DATE AND t.status <> com.timeline.domain.enums.TaskStatus.COMPLETED)) " +
            "ORDER BY t.startDate ASC")
    List<Task> findAllForTeamBoard(
            @Param("status") TaskStatus status,
            @Param("projectId") Long projectId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate,
            @Param("assigneeId") Long assigneeId,
            @Param("priority") TaskPriority priority,
            @Param("type") TaskType type,
            @Param("unordered") Boolean unordered,
            @Param("isDelayed") Boolean isDelayed);

    /**
     * 전체 태스크 조회 (팀 보드용) - 기존 하위호환 메서드
     */
    default List<Task> findAllForTeamBoard(TaskStatus status, Long projectId,
                                            LocalDate startDate, LocalDate endDate) {
        return findAllForTeamBoard(status, projectId, startDate, endDate,
                null, null, null, null, null);
    }

    /**
     * 동일 프로젝트 + 담당자의 SEQUENTIAL 태스크 중 종료일이 가장 늦은 것부터 조회
     * - excludeTaskId 제외 (수정 시 자기 자신 제외)
     * - 결과 목록의 첫 번째 요소가 가장 늦은 종료일
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.project.id = :projectId " +
            "AND t.executionMode = :sequentialMode " +
            "AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId) " +
            "ORDER BY t.endDate DESC")
    List<Task> findLatestSequentialTaskByAssignee(
            @Param("assigneeId") Long assigneeId,
            @Param("projectId") Long projectId,
            @Param("sequentialMode") TaskExecutionMode sequentialMode,
            @Param("excludeTaskId") Long excludeTaskId);

    /**
     * 동일 프로젝트 + 담당자의 SEQUENTIAL 태스크 수 (excludeTaskId 제외)
     * - 첫 번째 태스크 여부 판단에 사용
     */
    @Query("SELECT COUNT(t) FROM Task t " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.project.id = :projectId " +
            "AND t.executionMode = :sequentialMode " +
            "AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId)")
    long countSequentialTasksByAssignee(
            @Param("assigneeId") Long assigneeId,
            @Param("projectId") Long projectId,
            @Param("sequentialMode") TaskExecutionMode sequentialMode,
            @Param("excludeTaskId") Long excludeTaskId);

    /**
     * 담당자의 전체 프로젝트 SEQUENTIAL 태스크 중 종료일이 가장 늦은 것부터 조회 (전역 큐)
     * - 프로젝트 제한 없음
     * - Hold/Cancelled 상태 제외
     * - excludeTaskId 제외 (수정 시 자기 자신)
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.executionMode = :sequentialMode " +
            "AND t.status NOT IN :excludeStatuses " +
            "AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId) " +
            "ORDER BY t.endDate DESC")
    List<Task> findLatestSequentialTaskByAssigneeGlobal(
            @Param("assigneeId") Long assigneeId,
            @Param("sequentialMode") TaskExecutionMode sequentialMode,
            @Param("excludeStatuses") List<TaskStatus> excludeStatuses,
            @Param("excludeTaskId") Long excludeTaskId);

    /**
     * 담당자의 전체 프로젝트 SEQUENTIAL 태스크 수 (Hold/Cancelled 제외)
     */
    @Query("SELECT COUNT(t) FROM Task t " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.executionMode = :sequentialMode " +
            "AND t.status NOT IN :excludeStatuses " +
            "AND (:excludeTaskId IS NULL OR t.id <> :excludeTaskId)")
    long countSequentialTasksByAssigneeGlobal(
            @Param("assigneeId") Long assigneeId,
            @Param("sequentialMode") TaskExecutionMode sequentialMode,
            @Param("excludeStatuses") List<TaskStatus> excludeStatuses,
            @Param("excludeTaskId") Long excludeTaskId);

    /**
     * 담당자의 SEQUENTIAL 태스크 조회 (assigneeOrder 순, 전역 큐 관리용)
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.executionMode = :sequentialMode " +
            "AND t.status NOT IN :excludeStatuses " +
            "ORDER BY t.assigneeOrder ASC NULLS LAST, t.startDate ASC")
    List<Task> findSequentialTasksByAssigneeOrdered(
            @Param("assigneeId") Long assigneeId,
            @Param("sequentialMode") TaskExecutionMode sequentialMode,
            @Param("excludeStatuses") List<TaskStatus> excludeStatuses);

    /**
     * 담당자의 PARALLEL 태스크 조회 (startDate 정렬)
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.executionMode = :parallelMode " +
            "AND t.status NOT IN :excludeStatuses " +
            "ORDER BY t.startDate ASC")
    List<Task> findParallelTasksByAssigneeOrdered(
            @Param("assigneeId") Long assigneeId,
            @Param("parallelMode") TaskExecutionMode parallelMode,
            @Param("excludeStatuses") List<TaskStatus> excludeStatuses);

    /**
     * 담당자의 비활성(HOLD/CANCELLED) 태스크 조회
     */
    @Query("SELECT t FROM Task t " +
            "JOIN FETCH t.project " +
            "LEFT JOIN FETCH t.domainSystem " +
            "WHERE t.assignee.id = :assigneeId " +
            "AND t.status IN :statuses " +
            "ORDER BY t.startDate ASC")
    List<Task> findInactiveTasksByAssignee(
            @Param("assigneeId") Long assigneeId,
            @Param("statuses") List<TaskStatus> statuses);

    /**
     * 프로젝트 내 최대 endDate 조회 (expectedEndDate 계산용)
     */
    @Query("SELECT MAX(t.endDate) FROM Task t " +
            "WHERE t.project.id = :projectId " +
            "AND t.status NOT IN :excludeStatuses")
    LocalDate findMaxEndDateByProjectId(
            @Param("projectId") Long projectId,
            @Param("excludeStatuses") List<TaskStatus> excludeStatuses);

    /**
     * 프로젝트별 manDays 합계 조회 (N+1 방지용 일괄 쿼리)
     */
    @Query("SELECT t.project.id, COALESCE(SUM(t.manDays), 0) FROM Task t WHERE t.status IN :statuses GROUP BY t.project.id")
    List<Object[]> sumManDaysByProjectGrouped(@Param("statuses") List<TaskStatus> statuses);

    List<Task> findByProjectId(Long projectId);

    List<Task> findByProjectIdAndStatus(Long projectId, TaskStatus status);

    void deleteByProjectId(Long projectId);
}
