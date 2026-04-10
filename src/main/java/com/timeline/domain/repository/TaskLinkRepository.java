package com.timeline.domain.repository;

import com.timeline.domain.entity.TaskLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TaskLinkRepository extends JpaRepository<TaskLink, Long> {

    /**
     * 태스크의 링크 목록 조회 (생성일 오름차순)
     */
    List<TaskLink> findByTaskIdOrderByCreatedAtAsc(Long taskId);

    /**
     * 태스크 삭제 시 링크 일괄 삭제
     */
    void deleteByTaskId(Long taskId);

    /**
     * 태스크의 링크 개수 조회 (10개 제한 검증용)
     */
    long countByTaskId(Long taskId);
}
