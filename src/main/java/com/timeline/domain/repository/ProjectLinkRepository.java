package com.timeline.domain.repository;

import com.timeline.domain.entity.ProjectLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProjectLinkRepository extends JpaRepository<ProjectLink, Long> {

    List<ProjectLink> findByProjectIdOrderByCreatedAtAsc(Long projectId);

    void deleteByProjectId(Long projectId);
}
