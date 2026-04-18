package com.timeline.domain.repository;

import com.timeline.domain.entity.GoogleDriveConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface GoogleDriveConfigRepository extends JpaRepository<GoogleDriveConfig, Long> {
}
