package com.timeline.domain.entity;

import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskPriority;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.enums.TaskType;
import jakarta.persistence.*;
import lombok.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 태스크 엔티티
 */
@Entity
@Table(name = "task")
@EntityListeners(AuditingEntityListener.class)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "domain_system_id")
    private DomainSystem domainSystem;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignee_id")
    private Member assignee;

    @Column(nullable = false, length = 300)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "end_date")
    private LocalDate endDate;

    @Column(name = "man_days", precision = 5, scale = 1)
    private BigDecimal manDays;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TaskStatus status = TaskStatus.TODO;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "execution_mode", nullable = false, length = 20,
            columnDefinition = "VARCHAR(20) DEFAULT 'SEQUENTIAL'")
    private TaskExecutionMode executionMode = TaskExecutionMode.SEQUENTIAL;

    @Enumerated(EnumType.STRING)
    @Column(length = 5)
    private TaskPriority priority;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private TaskType type;

    @Column(name = "actual_end_date")
    private LocalDate actualEndDate;

    @Column(name = "assignee_order")
    private Integer assigneeOrder;

    @Column(name = "jira_key", length = 50)
    private String jiraKey;

    @Column(name = "sort_order")
    private Integer sortOrder;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
