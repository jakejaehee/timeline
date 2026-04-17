package com.timeline.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Date;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Hibernate ddl-auto=update가 처리하지 못하는 스키마/데이터 변경을 보완하는 런너.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SchemaUpdateRunner implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(ApplicationArguments args) {
        alterColumnNullable("task", "domain_system_id");
        alterColumnNullable("task", "assignee_id");
        alterColumnNullable("task", "man_days");
        alterColumnNullable("task", "start_date");
        alterColumnNullable("task", "end_date");
        alterColumnNullable("project", "start_date");
        alterColumnNullable("project", "end_date");
        updateMemberRoleCheck();
        alterColumnNullable("project_milestone", "start_date");
        alterColumnNullable("project_milestone", "end_date");
        addColumnIfNotExists("project_milestone", "type", "VARCHAR(20)");
        addColumnIfNotExists("project_milestone", "days", "INTEGER");
        fixTaskEndDatesByManDays();
    }

    /**
     * member 테이블의 role CHECK 제약조건을 최신 enum 값으로 갱신
     */
    private void updateMemberRoleCheck() {
        try {
            jdbcTemplate.execute("ALTER TABLE member DROP CONSTRAINT IF EXISTS member_role_check");
            jdbcTemplate.execute("ALTER TABLE member ADD CONSTRAINT member_role_check " +
                    "CHECK (role IN ('BE', 'FE', 'QA', 'PM', 'EM', 'PLACEHOLDER'))");
            log.info("스키마 보정: member_role_check 제약조건 갱신 완료 (EM 추가)");
        } catch (Exception e) {
            log.warn("member_role_check 갱신 실패: {}", e.getMessage());
        }
    }

    private void addColumnIfNotExists(String table, String column, String type) {
        try {
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
                    Integer.class, table, column);
            if (count == null || count == 0) {
                jdbcTemplate.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + type);
                log.info("스키마 보정: {}.{} 컬럼 추가 완료 ({})", table, column, type);
            }
        } catch (Exception e) {
            log.warn("스키마 보정 실패 ({}.{}): {}", table, column, e.getMessage());
        }
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

    /**
     * startDate == endDate 이고 manDays > 1인 태스크의 endDate를
     * 영업일 기준으로 보정 (주말 건너뜀)
     */
    private void fixTaskEndDatesByManDays() {
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT id, start_date, end_date, man_days FROM task " +
                    "WHERE man_days > 1");
            if (rows.isEmpty()) return;

            int updated = 0;
            for (Map<String, Object> row : rows) {
                Long id = ((Number) row.get("id")).longValue();
                LocalDate startDate = ((Date) row.get("start_date")).toLocalDate();
                LocalDate currentEnd = ((Date) row.get("end_date")).toLocalDate();
                int md = Math.round(((Number) row.get("man_days")).floatValue());
                if (md < 2) continue;

                // 현재 영업일 수 계산
                int currentBizDays = countBusinessDays(startDate, currentEnd);
                if (currentBizDays >= md) continue; // 이미 충분하면 건너뜀

                LocalDate newEnd = addBusinessDays(startDate, md - 1);
                jdbcTemplate.update("UPDATE task SET end_date = ? WHERE id = ?", newEnd, id);
                updated++;
            }
            if (updated > 0) {
                log.info("데이터 보정: startDate=endDate인 태스크 {}건의 endDate를 manDays 기준 영업일로 보정 완료", updated);
            }
        } catch (Exception e) {
            log.warn("태스크 endDate 보정 실패: {}", e.getMessage());
        }
    }

    private int countBusinessDays(LocalDate from, LocalDate to) {
        int count = 0;
        LocalDate d = from;
        while (!d.isAfter(to)) {
            if (d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY) {
                count++;
            }
            d = d.plusDays(1);
        }
        return count;
    }

    private LocalDate addBusinessDays(LocalDate from, int days) {
        LocalDate d = from;
        int added = 0;
        while (added < days) {
            d = d.plusDays(1);
            if (d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY) {
                added++;
            }
        }
        return d;
    }
}
