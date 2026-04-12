package com.timeline.domain.repository;

import com.timeline.domain.entity.JiraConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface JiraConfigRepository extends JpaRepository<JiraConfig, Long> {

    /**
     * 첫 번째(단일) 설정 레코드 조회
     */
    Optional<JiraConfig> findFirstByOrderByIdAsc();
}
