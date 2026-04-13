package com.timeline.domain.repository;

import com.timeline.domain.entity.ProjectMilestone;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProjectMilestoneRepository extends JpaRepository<ProjectMilestone, Long> {

    List<ProjectMilestone> findByProjectIdOrderBySortOrderAscStartDateAsc(Long projectId);

    void deleteByProjectId(Long projectId);
}
