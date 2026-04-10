package com.timeline.domain.repository;

import com.timeline.domain.entity.DomainSystem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface DomainSystemRepository extends JpaRepository<DomainSystem, Long> {

    Optional<DomainSystem> findByName(String name);

    boolean existsByName(String name);

    List<DomainSystem> findAllByOrderByNameAsc();
}
