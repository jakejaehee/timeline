package com.timeline.service;

import com.timeline.domain.entity.Task;
import com.timeline.domain.enums.TaskExecutionMode;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.repository.MemberRepository;
import com.timeline.domain.repository.TaskRepository;
import com.timeline.dto.TaskDto;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 담당자 전역 실행 큐 순서 관리 서비스
 * - 담당자별 SEQUENTIAL 태스크 순서(assigneeOrder)를 관리
 * - assigneeOrder가 null인 태스크는 미정렬(unordered) 상태
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AssigneeOrderService {

    private final TaskRepository taskRepository;
    private final MemberRepository memberRepository;

    /** Hold/Cancelled 상태 목록 (스케줄링 제외용) */
    private static final List<TaskStatus> INACTIVE_STATUSES = List.of(TaskStatus.HOLD, TaskStatus.CANCELLED);

    /**
     * 담당자 실행 큐 순서 일괄 변경
     * - taskIds 순서대로 assigneeOrder를 1부터 부여
     * - taskIds에 포함되지 않은 기존 태스크의 assigneeOrder는 null로 초기화 (unordered)
     *
     * @param assigneeId 담당자 ID
     * @param taskIds    순서가 지정된 태스크 ID 목록 (첫 번째 = 1순위)
     */
    @Transactional
    public void reorderTasks(Long assigneeId, List<Long> taskIds) {
        if (assigneeId == null) {
            throw new IllegalArgumentException("담당자 ID는 필수입니다.");
        }
        if (!memberRepository.existsById(assigneeId)) {
            throw new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + assigneeId);
        }

        // 해당 담당자의 모든 SEQUENTIAL 활성 태스크 조회
        List<Task> allTasks = taskRepository.findSequentialTasksByAssigneeOrdered(
                assigneeId, TaskExecutionMode.SEQUENTIAL, INACTIVE_STATUSES);

        // 기존 태스크의 assigneeOrder를 모두 null로 초기화
        for (Task task : allTasks) {
            task.setAssigneeOrder(null);
        }

        // taskIds 순서대로 assigneeOrder 부여
        if (taskIds != null) {
            int order = 1;
            for (Long taskId : taskIds) {
                Task task = allTasks.stream()
                        .filter(t -> t.getId().equals(taskId))
                        .findFirst()
                        .orElse(null);
                if (task != null) {
                    task.setAssigneeOrder(order++);
                } else {
                    log.warn("담당자 큐 순서 변경 시 태스크를 찾을 수 없습니다: assigneeId={}, taskId={}", assigneeId, taskId);
                }
            }
        }

        taskRepository.saveAll(allTasks);
        log.info("담당자 실행 큐 순서 변경: assigneeId={}, taskIds={}", assigneeId, taskIds);
    }

    /**
     * 담당자별 정렬된 SEQUENTIAL 태스크 목록 조회
     */
    public List<TaskDto.Response> getOrderedTasksByAssignee(Long assigneeId) {
        if (assigneeId == null) {
            throw new IllegalArgumentException("담당자 ID는 필수입니다.");
        }
        if (!memberRepository.existsById(assigneeId)) {
            throw new EntityNotFoundException("멤버를 찾을 수 없습니다. id=" + assigneeId);
        }

        List<Task> tasks = taskRepository.findSequentialTasksByAssigneeOrdered(
                assigneeId, TaskExecutionMode.SEQUENTIAL, INACTIVE_STATUSES);

        return tasks.stream()
                .map(task -> TaskDto.Response.from(task, List.of()))
                .collect(Collectors.toList());
    }
}
