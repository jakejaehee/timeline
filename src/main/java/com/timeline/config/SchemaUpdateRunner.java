package com.timeline.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Hibernate ddl-auto=update가 처리하지 못하는 스키마 변경을 보완하는 런너.
 * (NOT NULL 제거 등 기존 컬럼 제약조건 변경)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SchemaUpdateRunner implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(ApplicationArguments args) {
        alterColumnNullable("task", "domain_system_id");
    }

    private void alterColumnNullable(String table, String column) {
        try {
            Boolean isNullable = jdbcTemplate.queryForObject(
                    "SELECT is_nullable = 'YES' FROM information_schema.columns " +
                    "WHERE table_name = ? AND column_name = ?",
                    Boolean.class, table, column);
            if (Boolean.FALSE.equals(isNullable)) {
                jdbcTemplate.execute("ALTER TABLE " + table + " ALTER COLUMN " + column + " DROP NOT NULL");
                log.info("스키마 보정: {}.{} NOT NULL 제거 완료", table, column);
            }
        } catch (Exception e) {
            log.warn("스키마 보정 실패 ({}.{}): {}", table, column, e.getMessage());
        }
    }
}
