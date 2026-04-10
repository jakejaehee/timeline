package com.timeline.controller;

import com.timeline.dto.DomainSystemDto;
import com.timeline.service.DomainSystemService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 도메인 시스템 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/domain-systems")
@RequiredArgsConstructor
public class DomainSystemController {

    private final DomainSystemService domainSystemService;

    /**
     * 전체 도메인 시스템 목록 조회
     */
    @GetMapping
    public ResponseEntity<?> getAllDomainSystems() {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", domainSystemService.getAllDomainSystems()
        ));
    }

    /**
     * 도메인 시스템 상세 조회
     */
    @GetMapping("/{id}")
    public ResponseEntity<?> getDomainSystem(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", domainSystemService.getDomainSystem(id)
        ));
    }

    /**
     * 도메인 시스템 생성
     */
    @PostMapping
    public ResponseEntity<?> createDomainSystem(@RequestBody DomainSystemDto.Request request) {
        DomainSystemDto.Response created = domainSystemService.createDomainSystem(request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 도메인 시스템 수정
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updateDomainSystem(@PathVariable Long id,
                                                @RequestBody DomainSystemDto.Request request) {
        DomainSystemDto.Response updated = domainSystemService.updateDomainSystem(id, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", updated
        ));
    }

    /**
     * 도메인 시스템 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteDomainSystem(@PathVariable Long id) {
        domainSystemService.deleteDomainSystem(id);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }
}
