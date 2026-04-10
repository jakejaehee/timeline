package com.timeline.service;

import com.timeline.domain.entity.DomainSystem;
import com.timeline.domain.repository.DomainSystemRepository;
import com.timeline.dto.DomainSystemDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 도메인 시스템 CRUD 서비스
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DomainSystemService {

    private final DomainSystemRepository domainSystemRepository;

    /**
     * 전체 도메인 시스템 목록 조회
     */
    public List<DomainSystemDto.Response> getAllDomainSystems() {
        return domainSystemRepository.findAllByOrderByNameAsc().stream()
                .map(DomainSystemDto.Response::from)
                .collect(Collectors.toList());
    }

    /**
     * 도메인 시스템 상세 조회
     */
    public DomainSystemDto.Response getDomainSystem(Long id) {
        DomainSystem domainSystem = findDomainSystemById(id);
        return DomainSystemDto.Response.from(domainSystem);
    }

    /**
     * 도메인 시스템 생성
     */
    @Transactional
    public DomainSystemDto.Response createDomainSystem(DomainSystemDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("도메인 시스템 이름은 필수입니다.");
        }

        if (domainSystemRepository.existsByName(request.getName())) {
            throw new IllegalArgumentException("이미 존재하는 도메인 시스템 이름입니다: " + request.getName());
        }

        validateColor(request.getColor());

        DomainSystem domainSystem = DomainSystem.builder()
                .name(request.getName())
                .description(request.getDescription())
                .color(request.getColor())
                .build();

        DomainSystem saved = domainSystemRepository.save(domainSystem);
        log.info("도메인 시스템 생성 완료: id={}, name={}", saved.getId(), saved.getName());
        return DomainSystemDto.Response.from(saved);
    }

    /**
     * 도메인 시스템 수정
     */
    @Transactional
    public DomainSystemDto.Response updateDomainSystem(Long id, DomainSystemDto.Request request) {
        if (request.getName() == null || request.getName().isBlank()) {
            throw new IllegalArgumentException("도메인 시스템 이름은 필수입니다.");
        }

        DomainSystem domainSystem = findDomainSystemById(id);

        // 이름 변경 시 중복 체크
        if (!domainSystem.getName().equals(request.getName())
                && domainSystemRepository.existsByName(request.getName())) {
            throw new IllegalArgumentException("이미 존재하는 도메인 시스템 이름입니다: " + request.getName());
        }

        validateColor(request.getColor());

        domainSystem.setName(request.getName());
        domainSystem.setDescription(request.getDescription());
        domainSystem.setColor(request.getColor());

        DomainSystem updated = domainSystemRepository.save(domainSystem);
        log.info("도메인 시스템 수정 완료: id={}, name={}", updated.getId(), updated.getName());
        return DomainSystemDto.Response.from(updated);
    }

    /**
     * 도메인 시스템 삭제
     */
    @Transactional
    public void deleteDomainSystem(Long id) {
        DomainSystem domainSystem = findDomainSystemById(id);
        domainSystemRepository.delete(domainSystem);
        log.info("도메인 시스템 삭제 완료: id={}, name={}", id, domainSystem.getName());
    }

    /**
     * ID로 도메인 시스템 조회 (내부용)
     */
    public DomainSystem findDomainSystemById(Long id) {
        return domainSystemRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("도메인 시스템을 찾을 수 없습니다. id=" + id));
    }

    /**
     * 색상 코드 유효성 검증 (#RRGGBB 형식)
     */
    private void validateColor(String color) {
        if (color != null && !color.isEmpty()) {
            if (!color.matches("^#[0-9a-fA-F]{6}$")) {
                throw new IllegalArgumentException("올바른 색상 코드 형식이 아닙니다 (예: #4A90D9): " + color);
            }
        }
    }
}
