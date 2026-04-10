package com.timeline.domain.enums;

/**
 * 태스크 실행 모드
 * - SEQUENTIAL: 순차 실행. 동일 담당자의 날짜 겹침 시 충돌 검증 수행
 * - PARALLEL: 병렬 실행. 동일 담당자의 동시 작업 허용 (충돌 검증 건너뜀)
 */
public enum TaskExecutionMode {
    SEQUENTIAL,
    PARALLEL
}
