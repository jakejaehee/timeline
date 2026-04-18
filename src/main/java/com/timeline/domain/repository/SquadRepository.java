package com.timeline.domain.repository;

import com.timeline.domain.entity.Squad;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SquadRepository extends JpaRepository<Squad, Long> {

    Optional<Squad> findByName(String name);

    boolean existsByName(String name);

    List<Squad> findAllByOrderByNameAsc();
}
