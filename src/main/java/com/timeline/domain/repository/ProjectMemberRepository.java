package com.timeline.domain.repository;

import com.timeline.domain.entity.ProjectMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProjectMemberRepository extends JpaRepository<ProjectMember, Long> {

    @Query("SELECT pm FROM ProjectMember pm JOIN FETCH pm.member WHERE pm.project.id = :projectId")
    List<ProjectMember> findByProjectIdWithMember(@Param("projectId") Long projectId);

    @Query("SELECT pm FROM ProjectMember pm JOIN FETCH pm.project WHERE pm.member.id = :memberId")
    List<ProjectMember> findByMemberIdWithProject(@Param("memberId") Long memberId);

    boolean existsByProjectIdAndMemberId(Long projectId, Long memberId);

    Optional<ProjectMember> findByProjectIdAndMemberId(Long projectId, Long memberId);

    void deleteByProjectIdAndMemberId(Long projectId, Long memberId);

    void deleteByProjectId(Long projectId);

    long countByProjectId(Long projectId);

    /**
     * 프로젝트별 멤버 수 일괄 조회 (N+1 방지)
     * 결과: Object[] { projectId (Long), memberCount (Long) }
     */
    @Query("SELECT pm.project.id, COUNT(pm) FROM ProjectMember pm GROUP BY pm.project.id")
    List<Object[]> countByProjectIdGrouped();
}
