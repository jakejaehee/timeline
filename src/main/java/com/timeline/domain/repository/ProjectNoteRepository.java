package com.timeline.domain.repository;

import com.timeline.domain.entity.ProjectNote;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ProjectNoteRepository extends JpaRepository<ProjectNote, Long> {

    List<ProjectNote> findByProjectIdOrderByCreatedAtDesc(Long projectId);

    void deleteByProjectId(Long projectId);

    @Query("SELECT pn.project.id, COUNT(pn) FROM ProjectNote pn GROUP BY pn.project.id")
    List<Object[]> countByProjectIdGrouped();
}
