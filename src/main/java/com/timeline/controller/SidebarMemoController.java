package com.timeline.controller;

import com.timeline.domain.entity.SidebarMemo;
import com.timeline.domain.repository.SidebarMemoRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.LinkedHashMap;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/sidebar-memos")
@RequiredArgsConstructor
public class SidebarMemoController {

    private final SidebarMemoRepository sidebarMemoRepository;

    @GetMapping
    public ResponseEntity<?> getAllSidebarMemos() {
        var memos = sidebarMemoRepository.findAllByOrderByCreatedAtDesc();
        var data = memos.stream().map(m -> {
            var map = new LinkedHashMap<String, Object>();
            map.put("id", m.getId());
            map.put("content", m.getContent());
            map.put("createdAt", m.getCreatedAt());
            map.put("updatedAt", m.getUpdatedAt() != null ? m.getUpdatedAt() : m.getCreatedAt());
            return map;
        }).toList();
        return ResponseEntity.ok(Map.of("success", true, "data", data));
    }

    @PostMapping
    public ResponseEntity<?> createSidebarMemo(@RequestBody Map<String, String> body) {
        var content = body.get("content");
        validateContent(content);
        var memo = SidebarMemo.builder().content(content).build();
        sidebarMemoRepository.save(memo);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateSidebarMemo(@PathVariable Long id,
                                                @RequestBody Map<String, String> body) {
        var memo = sidebarMemoRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("메모를 찾을 수 없습니다."));
        var content = body.get("content");
        validateContent(content);
        memo.setContent(content);
        sidebarMemoRepository.save(memo);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteSidebarMemo(@PathVariable Long id) {
        sidebarMemoRepository.deleteById(id);
        return ResponseEntity.ok(Map.of("success", true));
    }

    private void validateContent(String content) {
        if (content == null || content.isBlank()) {
            throw new IllegalArgumentException("메모 내용을 입력하세요.");
        }
        if (content.length() > 2000) {
            throw new IllegalArgumentException("메모는 2000자를 초과할 수 없습니다.");
        }
    }
}
