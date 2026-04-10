package com.timeline.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * JPA Auditing 설정
 * - @CreatedDate, @LastModifiedDate 자동 관리
 */
@Configuration
@EnableJpaAuditing
public class JpaAuditingConfig {
}
