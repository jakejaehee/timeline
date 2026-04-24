package com.timeline.domain.repository;

import com.timeline.domain.entity.SidebarLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SidebarLinkRepository extends JpaRepository<SidebarLink, Long> {
    List<SidebarLink> findAllByOrderBySortOrderAscCreatedAtAsc();
}
