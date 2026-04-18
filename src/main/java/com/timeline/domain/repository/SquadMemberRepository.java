package com.timeline.domain.repository;

import com.timeline.domain.entity.SquadMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SquadMemberRepository extends JpaRepository<SquadMember, Long> {

    @Query("SELECT sm FROM SquadMember sm JOIN FETCH sm.member WHERE sm.squad.id = :squadId")
    List<SquadMember> findBySquadIdWithMember(Long squadId);

    @Query("SELECT sm FROM SquadMember sm JOIN FETCH sm.squad WHERE sm.member.id = :memberId")
    List<SquadMember> findByMemberIdWithSquad(Long memberId);

    boolean existsBySquadIdAndMemberId(Long squadId, Long memberId);

    Optional<SquadMember> findBySquadIdAndMemberId(Long squadId, Long memberId);

    void deleteBySquadId(Long squadId);

    void deleteByMemberId(Long memberId);
}
