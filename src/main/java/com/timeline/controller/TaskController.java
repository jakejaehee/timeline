package com.timeline.controller;

import com.timeline.dto.TaskDto;
import com.timeline.service.AssigneeOrderService;
import com.timeline.service.TaskService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 태스크 REST API 컨트롤러
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class TaskController {

    private final TaskService taskService;
    private final AssigneeOrderService assigneeOrderService;

    /**
     * 프로젝트의 전체 태스크 조회 (간트차트용)
     */
    @GetMapping("/api/v1/projects/{projectId}/tasks")
    public ResponseEntity<?> getProjectTasks(@PathVariable Long projectId) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", taskService.getGanttData(projectId)
        ));
    }

    /**
     * 태스크 상세 조회
     */
    @GetMapping("/api/v1/tasks/{id}")
    public ResponseEntity<?> getTask(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", taskService.getTask(id)
        ));
    }

    /**
     * 날짜 프리뷰 계산 (DB 저장 없음)
     * - 담당자/공수/의존관계 기반으로 예상 시작일/종료일 계산
     */
    @PostMapping("/api/v1/projects/{projectId}/tasks/preview-dates")
    public ResponseEntity<?> previewDates(@PathVariable Long projectId,
                                           @RequestBody TaskDto.PreviewDatesRequest request) {
        TaskDto.PreviewDatesResponse preview = taskService.previewDates(
                projectId,
                request.getAssigneeId(),
                request.getManDays(),
                request.getDependsOnTaskIds(),
                request.getExcludeTaskId());
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", preview
        ));
    }

    /**
     * 태스크 생성
     */
    @PostMapping("/api/v1/projects/{projectId}/tasks")
    public ResponseEntity<?> createTask(@PathVariable Long projectId,
                                        @RequestBody TaskDto.Request request) {
        TaskDto.Response created = taskService.createTask(projectId, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 태스크 수정
     */
    @PutMapping("/api/v1/tasks/{id}")
    public ResponseEntity<?> updateTask(@PathVariable Long id,
                                        @RequestBody TaskDto.Request request) {
        TaskDto.Response updated = taskService.updateTask(id, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", updated
        ));
    }

    /**
     * 태스크 삭제
     */
    @DeleteMapping("/api/v1/tasks/{id}")
    public ResponseEntity<?> deleteTask(@PathVariable Long id) {
        taskService.deleteTask(id);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 태스크 일괄 삭제
     */
    @PostMapping("/api/v1/tasks/batch-delete")
    public ResponseEntity<?> batchDelete(@RequestBody Map<String, Object> body) {
        Object taskIdsObj = body.get("taskIds");
        if (!(taskIdsObj instanceof List<?>)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "taskIds는 필수입니다."
            ));
        }
        List<?> taskIdRaw = (List<?>) taskIdsObj;
        if (taskIdRaw.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "taskIds는 필수입니다."
            ));
        }
        List<Long> taskIds;
        try {
            taskIds = taskIdRaw.stream()
                    .map(o -> ((Number) o).longValue())
                    .toList();
        } catch (ClassCastException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "taskIds는 숫자 배열이어야 합니다."
            ));
        }
        int deleted = taskService.deleteTasksBatch(taskIds);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "deleted", deleted
        ));
    }

    /**
     * 의존관계 추가
     */
    @PostMapping("/api/v1/tasks/{id}/dependencies")
    public ResponseEntity<?> addDependency(@PathVariable Long id,
                                           @RequestBody TaskDto.AddDependencyRequest request) {
        taskService.addDependency(id, request.getDependsOnTaskId());
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 의존관계 제거
     */
    @DeleteMapping("/api/v1/tasks/{id}/dependencies/{dependsOnTaskId}")
    public ResponseEntity<?> removeDependency(@PathVariable Long id,
                                              @PathVariable Long dependsOnTaskId) {
        taskService.removeDependency(id, dependsOnTaskId);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    // ---- 담당자 실행 큐 순서 API ----

    /**
     * 담당자 실행 큐 순서 일괄 변경
     * Body: {"assigneeId": Long, "taskIds": [Long, ...]}
     */
    @PatchMapping("/api/v1/tasks/assignee-order")
    public ResponseEntity<?> reorderAssigneeTasks(@RequestBody Map<String, Object> body) {
        Object assigneeIdObj = body.get("assigneeId");
        if (assigneeIdObj == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "assigneeId는 필수입니다."
            ));
        }
        Long assigneeId = ((Number) assigneeIdObj).longValue();

        @SuppressWarnings("unchecked")
        List<Number> taskIdNumbers = (List<Number>) body.get("taskIds");
        List<Long> taskIds = taskIdNumbers != null
                ? taskIdNumbers.stream().map(Number::longValue).toList()
                : List.of();

        assigneeOrderService.reorderTasks(assigneeId, taskIds);

        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }

    /**
     * 담당자별 정렬된 SEQUENTIAL 태스크 목록 조회
     * 재계산 없이 현재 저장된 순서/날짜를 그대로 반환한다.
     * 재계산은 명시적 재계산 버튼(POST /recalculate-queue)과 순서 변경(PATCH /assignee-order)에서만 수행.
     */
    @GetMapping("/api/v1/members/{assigneeId}/ordered-tasks")
    public ResponseEntity<?> getOrderedTasks(@PathVariable Long assigneeId) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", assigneeOrderService.getOrderedTasksByAssignee(assigneeId)
        ));
    }

    // ---- 태스크 링크 전용 API ----

    /**
     * 태스크 링크 목록 조회
     */
    @GetMapping("/api/v1/tasks/{id}/links")
    public ResponseEntity<?> getTaskLinks(@PathVariable Long id) {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", taskService.getTaskLinks(id)
        ));
    }

    /**
     * 태스크 링크 단건 추가
     */
    @PostMapping("/api/v1/tasks/{id}/links")
    public ResponseEntity<?> addTaskLink(@PathVariable Long id,
                                         @RequestBody TaskDto.TaskLinkRequest request) {
        TaskDto.TaskLinkResponse created = taskService.addTaskLink(id, request);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "data", created
        ));
    }

    /**
     * 태스크 링크 단건 삭제
     */
    @DeleteMapping("/api/v1/tasks/{id}/links/{linkId}")
    public ResponseEntity<?> deleteTaskLink(@PathVariable Long id,
                                            @PathVariable Long linkId) {
        taskService.deleteTaskLink(id, linkId);
        return ResponseEntity.ok(Map.of(
                "success", true
        ));
    }
}
