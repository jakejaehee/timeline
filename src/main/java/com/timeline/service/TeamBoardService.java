package com.timeline.service;

import com.timeline.domain.entity.Task;
import com.timeline.domain.enums.TaskPriority;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.enums.TaskType;
import com.timeline.domain.repository.TaskRepository;
import com.timeline.dto.TeamBoardDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Team Board 서비스
 * - 전체 프로젝트의 태스크를 멤버별로 그룹핑하여 조회
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TeamBoardService {

    private final TaskRepository taskRepository;

    /**
     * 팀 보드 데이터 조회
     * - 필터(status, projectId, startDate, endDate, assigneeId, priority, type, unordered, isDelayed) 적용
     * - 담당자가 있는 태스크: 멤버별 그룹핑
     * - 담당자가 없는 태스크: unassigned 목록
     */
    public TeamBoardDto.Response getTeamBoard(TaskStatus status,
                                               Long projectId,
                                               LocalDate startDate,
                                               LocalDate endDate,
                                               Long assigneeId,
                                               TaskPriority priority,
                                               TaskType type,
                                               Boolean unordered,
                                               Boolean isDelayed) {
        List<Task> allTasks = taskRepository.findAllForTeamBoard(status, projectId, startDate, endDate,
                assigneeId, priority, type, unordered, isDelayed);

        // 담당자 유무로 분리
        List<Task> assignedTasks = new ArrayList<>();
        List<Task> unassignedTasks = new ArrayList<>();

        for (Task task : allTasks) {
            if (task.getAssignee() != null) {
                assignedTasks.add(task);
            } else {
                unassignedTasks.add(task);
            }
        }

        // 담당자별 그룹핑 (LinkedHashMap으로 순서 유지)
        Map<Long, List<Task>> groupedByMember = new LinkedHashMap<>();
        for (Task task : assignedTasks) {
            groupedByMember
                    .computeIfAbsent(task.getAssignee().getId(), k -> new ArrayList<>())
                    .add(task);
        }

        // MemberGroup 변환
        List<TeamBoardDto.MemberGroup> memberGroups = groupedByMember.entrySet().stream()
                .map(entry -> {
                    Task first = entry.getValue().get(0);
                    return TeamBoardDto.MemberGroup.builder()
                            .id(first.getAssignee().getId())
                            .name(first.getAssignee().getName())
                            .role(first.getAssignee().getRole())
                            .tasks(entry.getValue().stream()
                                    .map(TeamBoardDto.TaskItem::from)
                                    .collect(Collectors.toList()))
                            .build();
                })
                .sorted(Comparator.comparing(TeamBoardDto.MemberGroup::getName))
                .collect(Collectors.toList());

        // 미지정 태스크 변환
        List<TeamBoardDto.TaskItem> unassignedItems = unassignedTasks.stream()
                .map(TeamBoardDto.TaskItem::from)
                .collect(Collectors.toList());

        return TeamBoardDto.Response.builder()
                .members(memberGroups)
                .unassigned(unassignedItems)
                .build();
    }
}
