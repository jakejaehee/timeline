package com.timeline.exception;

/**
 * 담당자 일정 충돌 예외
 * - 같은 담당자가 겹치는 기간에 이미 다른 태스크에 배정되어 있을 때 발생
 */
public class AssigneeConflictException extends RuntimeException {

    public AssigneeConflictException(String message) {
        super(message);
    }
}
