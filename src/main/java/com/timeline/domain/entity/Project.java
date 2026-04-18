package com.timeline.domain.entity;

import com.timeline.domain.enums.ProjectStatus;
import jakarta.persistence.*;
import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;


/**
 * 프로젝트 엔티티
 */
@Entity
@Table(name = "project")
@EntityListeners(AuditingEntityListener.class)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    @Column(name = "jira_board_id", length = 100)
    private String jiraBoardId;

    @Column(name = "jira_epic_key", length = 100)
    private String jiraEpicKey;

    @Column(length = 200)
    private String quarter;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private ProjectStatus status = ProjectStatus.PLANNING;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ppl_id")
    private Member ppl;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "epl_id")
    private Member epl;

    @Column(name = "total_man_days_override", precision = 10, scale = 1)
    private BigDecimal totalManDaysOverride;

    @Builder.Default
    @Column(nullable = false)
    private Boolean ktlo = false;

    @Column(name = "sort_order")
    private Integer sortOrder;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
