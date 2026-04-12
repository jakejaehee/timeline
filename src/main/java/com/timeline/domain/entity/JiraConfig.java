package com.timeline.domain.entity;

import jakarta.persistence.*;
import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;

/**
 * Jira Cloud 전역 설정 엔티티
 * 단일 레코드(ID=1)로 관리
 */
@Entity
@Table(name = "jira_config")
@EntityListeners(AuditingEntityListener.class)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JiraConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Jira Cloud 베이스 URL (예: https://yourcompany.atlassian.net) */
    @Column(name = "base_url", length = 500)
    private String baseUrl;

    /** 인증 이메일 */
    @Column(length = 200)
    private String email;

    /** API Token (평문 저장; MVP) */
    @Column(name = "api_token", length = 500)
    private String apiToken;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
