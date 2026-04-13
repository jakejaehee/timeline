package com.timeline.domain.repository;

import com.timeline.domain.entity.Project;
import com.timeline.domain.enums.ProjectStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProjectRepository extends JpaRepository<Project, Long> {

    List<Project> findByStatus(ProjectStatus status);

    List<Project> findByStatusNot(ProjectStatus status);

    List<Project> findAllByOrderBySortOrderAscCreatedAtDesc();

    @Query("SELECT DISTINCT p.projectType FROM Project p WHERE p.projectType IS NOT NULL ORDER BY p.projectType")
    List<String> findDistinctProjectTypes();
}
