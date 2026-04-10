package com.timeline.domain.repository;

import com.timeline.domain.entity.Project;
import com.timeline.domain.enums.ProjectStatus;
import com.timeline.domain.enums.ProjectType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProjectRepository extends JpaRepository<Project, Long> {

    List<Project> findByStatus(ProjectStatus status);

    List<Project> findByType(ProjectType type);

    List<Project> findByStatusNot(ProjectStatus status);

    List<Project> findAllByOrderByCreatedAtDesc();
}
