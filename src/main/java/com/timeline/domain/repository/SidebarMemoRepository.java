package com.timeline.domain.repository;

import com.timeline.domain.entity.SidebarMemo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface SidebarMemoRepository extends JpaRepository<SidebarMemo, Long> {
    List<SidebarMemo> findAllByOrderByCreatedAtDesc();
}
