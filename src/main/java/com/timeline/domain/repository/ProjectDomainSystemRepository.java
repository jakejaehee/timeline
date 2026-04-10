package com.timeline.domain.repository;

import com.timeline.domain.entity.ProjectDomainSystem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProjectDomainSystemRepository extends JpaRepository<ProjectDomainSystem, Long> {

    @Query("SELECT pds FROM ProjectDomainSystem pds JOIN FETCH pds.domainSystem WHERE pds.project.id = :projectId")
    List<ProjectDomainSystem> findByProjectIdWithDomainSystem(@Param("projectId") Long projectId);

    boolean existsByProjectIdAndDomainSystemId(Long projectId, Long domainSystemId);

    Optional<ProjectDomainSystem> findByProjectIdAndDomainSystemId(Long projectId, Long domainSystemId);

    void deleteByProjectIdAndDomainSystemId(Long projectId, Long domainSystemId);

    void deleteByProjectId(Long projectId);
}
