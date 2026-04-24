package com.timeline.controller;

import com.timeline.domain.entity.SidebarLink;
import com.timeline.domain.repository.SidebarLinkRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

@Slf4j
@RestController
@RequestMapping("/api/v1/sidebar-links")
@RequiredArgsConstructor
public class SidebarLinkController {

    private final SidebarLinkRepository sidebarLinkRepository;

    @GetMapping
    public ResponseEntity<?> getAllSidebarLinks() {
        var links = sidebarLinkRepository.findAllByOrderBySortOrderAscCreatedAtAsc();
        var data = links.stream().map(l -> {
            var map = new LinkedHashMap<String, Object>();
            map.put("id", l.getId());
            map.put("label", l.getLabel());
            map.put("url", l.getUrl());
            map.put("icon", l.getIcon());
            map.put("sortOrder", l.getSortOrder());
            return map;
        }).toList();
        return ResponseEntity.ok(Map.of("success", true, "data", data));
    }

    @PostMapping
    public ResponseEntity<?> createSidebarLink(@RequestBody Map<String, String> body) {
        var label = body.get("label");
        var url = body.get("url");
        validateSidebarLink(label, url);

        // sortOrder: 기존 최대값 + 1
        var allLinks = sidebarLinkRepository.findAllByOrderBySortOrderAscCreatedAtAsc();
        int maxOrder = allLinks.stream()
                .map(SidebarLink::getSortOrder)
                .filter(Objects::nonNull)
                .mapToInt(Integer::intValue)
                .max().orElse(0);

        var icon = body.get("icon");
        validateIcon(icon);
        var link = SidebarLink.builder()
                .label(label)
                .url(url)
                .icon(icon)
                .sortOrder(maxOrder + 1)
                .build();
        sidebarLinkRepository.save(link);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateSidebarLink(@PathVariable Long id,
                                                @RequestBody Map<String, String> body) {
        var link = sidebarLinkRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("링크를 찾을 수 없습니다."));
        if (body.containsKey("label")) {
            var label = body.get("label");
            if (label == null || label.isBlank()) throw new IllegalArgumentException("링크 이름을 입력하세요.");
            link.setLabel(label);
        }
        if (body.containsKey("url")) {
            var url = body.get("url");
            if (url == null || url.isBlank()) throw new IllegalArgumentException("링크 주소를 입력하세요.");
            validateUrl(url);
            link.setUrl(url);
        }
        if (body.containsKey("icon")) {
            validateIcon(body.get("icon"));
            link.setIcon(body.get("icon"));
        }
        sidebarLinkRepository.save(link);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteSidebarLink(@PathVariable Long id) {
        sidebarLinkRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PatchMapping("/{id}/sort-order")
    public ResponseEntity<?> updateSortOrder(@PathVariable Long id,
                                              @RequestBody Map<String, Object> body) {
        var link = sidebarLinkRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("링크를 찾을 수 없습니다."));
        Object sortOrderObj = body.get("sortOrder");
        Integer sortOrder = (sortOrderObj != null) ? ((Number) sortOrderObj).intValue() : null;
        link.setSortOrder(sortOrder);
        sidebarLinkRepository.save(link);
        return ResponseEntity.ok(Map.of("success", true));
    }

    private void validateSidebarLink(String label, String url) {
        if (label == null || label.isBlank()) throw new IllegalArgumentException("링크 이름을 입력하세요.");
        if (label.length() > 200) throw new IllegalArgumentException("링크 이름은 200자를 초과할 수 없습니다.");
        if (url == null || url.isBlank()) throw new IllegalArgumentException("링크 주소를 입력하세요.");
        if (url.length() > 2000) throw new IllegalArgumentException("링크 주소는 2000자를 초과할 수 없습니다.");
        validateUrl(url);
    }

    private void validateUrl(String url) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw new IllegalArgumentException("링크 주소는 http:// 또는 https://로 시작해야 합니다.");
        }
    }

    private void validateIcon(String icon) {
        if (icon != null && !icon.isBlank() && !icon.matches("^[a-zA-Z0-9-]+$")) {
            throw new IllegalArgumentException("아이콘 클래스명이 유효하지 않습니다.");
        }
    }
}
