package com.timeline.domain.repository;

import com.timeline.domain.entity.Member;
import com.timeline.domain.enums.MemberRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface MemberRepository extends JpaRepository<Member, Long> {

    List<Member> findByActiveTrue();

    List<Member> findByActiveTrueOrderByNameAsc();

    List<Member> findByRole(MemberRole role);

    List<Member> findByRoleAndActiveTrue(MemberRole role);

    boolean existsByNameAndActiveTrue(String name);
}
