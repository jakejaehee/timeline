package com.timeline.domain.enums;

/**
 * 경고 유형 (8가지)
 */
public enum WarningType {
    UNORDERED_TASK,       // 순서 미지정 (assigneeOrder null)
    MISSING_START_DATE,   // 시작일 누락 (첫 태스크 startDate null)
    SCHEDULE_CONFLICT,    // 일정 충돌 (담당자 일정 겹침)
    DEPENDENCY_ISSUE,     // 의존성 문제 (순환 또는 미완료 선행)
    DEADLINE_EXCEEDED,    // 마감 지연 (expectedEndDate > deadline)
    ORPHAN_TASK,          // orphan task (담당자 없는 SEQUENTIAL 태스크)
    DEPENDENCY_REMOVED,   // 의존성 제거된 태스크 (Hold/Cancelled 선행)
    UNAVAILABLE_DATE      // 비가용일 충돌 (태스크 기간 중 비가용일 포함)
}
