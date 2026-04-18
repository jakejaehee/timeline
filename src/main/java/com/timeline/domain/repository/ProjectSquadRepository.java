package com.timeline.domain.repository;

import com.timeline.domain.entity.ProjectSquad;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProjectSquadRepository extends JpaRepository<ProjectSquad, Long> {

    @Query("SELECT ps FROM ProjectSquad ps JOIN FETCH ps.squad WHERE ps.project.id = :projectId")
    List<ProjectSquad> findByProjectIdWithSquad(@Param("projectId") Long projectId);

    boolean existsByProjectIdAndSquadId(Long projectId, Long squadId);

    Optional<ProjectSquad> findByProjectIdAndSquadId(Long projectId, Long squadId);

    void deleteByProjectIdAndSquadId(Long projectId, Long squadId);

    void deleteByProjectId(Long projectId);

    void deleteBySquadId(Long squadId);
}
