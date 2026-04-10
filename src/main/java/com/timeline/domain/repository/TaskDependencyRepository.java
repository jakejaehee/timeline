package com.timeline.domain.repository;

import com.timeline.domain.entity.TaskDependency;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TaskDependencyRepository extends JpaRepository<TaskDependency, Long> {

    /**
     * 특정 태스크의 선행 의존관계 조회 (이 태스크가 기다리는 선행 태스크들)
     */
    @Query("SELECT td FROM TaskDependency td " +
            "JOIN FETCH td.dependsOnTask " +
            "WHERE td.task.id = :taskId")
    List<TaskDependency> findByTaskIdWithDependsOnTask(@Param("taskId") Long taskId);

    /**
     * 특정 태스크를 선행으로 가지는 후행 태스크 의존관계 조회
     */
    @Query("SELECT td FROM TaskDependency td " +
            "JOIN FETCH td.task " +
            "WHERE td.dependsOnTask.id = :dependsOnTaskId")
    List<TaskDependency> findByDependsOnTaskIdWithTask(@Param("dependsOnTaskId") Long dependsOnTaskId);

    /**
     * 프로젝트 내 모든 태스크 의존관계 조회 (간트차트 화살표 표시용)
     */
    @Query("SELECT td FROM TaskDependency td " +
            "JOIN FETCH td.task " +
            "JOIN FETCH td.dependsOnTask " +
            "WHERE td.task.project.id = :projectId")
    List<TaskDependency> findByProjectIdWithDetails(@Param("projectId") Long projectId);

    boolean existsByTaskIdAndDependsOnTaskId(Long taskId, Long dependsOnTaskId);

    void deleteByTaskId(Long taskId);

    void deleteByDependsOnTaskId(Long dependsOnTaskId);
}
