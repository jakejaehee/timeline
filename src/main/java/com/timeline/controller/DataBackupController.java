package com.timeline.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.timeline.dto.BackupDto;
import com.timeline.service.DataBackupService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.Map;

/**
 * 데이터 Export/Import REST API 컨트롤러
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/data")
@RequiredArgsConstructor
public class DataBackupController {

    private final DataBackupService dataBackupService;
    private final ObjectMapper objectMapper;

    /**
     * 전체 DB 데이터 Export (JSON 파일 다운로드)
     */
    @GetMapping("/export")
    public ResponseEntity<byte[]> export() {
        log.info("데이터 Export 요청");

        BackupDto.Snapshot snapshot = dataBackupService.exportAll();

        try {
            byte[] jsonBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(snapshot);
            String filename = "timeline-backup-" + LocalDate.now() + ".json";

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(jsonBytes);
        } catch (Exception e) {
            log.error("Export JSON 직렬화 실패", e);
            throw new RuntimeException("Export 처리 중 오류가 발생했습니다.", e);
        }
    }

    /**
     * JSON 파일 Import (전체 데이터 교체)
     */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> importData(@RequestParam("file") MultipartFile file) {
        log.info("데이터 Import 요청: size={}", file.getSize());

        if (file.isEmpty()) {
            throw new IllegalArgumentException("업로드된 파일이 비어 있습니다.");
        }

        BackupDto.Snapshot snapshot;
        try {
            snapshot = objectMapper.readValue(file.getInputStream(), BackupDto.Snapshot.class);
        } catch (Exception e) {
            log.error("Import JSON 파싱 실패", e);
            throw new IllegalArgumentException("유효하지 않은 백업 파일입니다: JSON 파싱에 실패했습니다.");
        }

        BackupDto.ImportResult result = dataBackupService.importAll(snapshot);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Import 완료. " + result.toSummaryMessage()
        ));
    }
}
