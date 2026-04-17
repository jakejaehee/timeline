package com.timeline.service;

import com.timeline.domain.entity.*;
import com.timeline.domain.enums.MemberRole;
import com.timeline.domain.enums.MilestoneType;
import com.timeline.domain.enums.TaskStatus;
import com.timeline.domain.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ScheduleCalculationService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectMilestoneRepository projectMilestoneRepository;
    private final TaskRepository taskRepository;
    private final HolidayService holidayService;
    private final MemberLeaveService memberLeaveService;
    private final BusinessDayCalculator bizDayCalc;

    private static final List<TaskStatus> ACTIVE_STATUSES = List.of(TaskStatus.TODO, TaskStatus.IN_PROGRESS);

    @Transactional(readOnly = true)
    public List<Map<String, Object>> calculateSchedule(List<Long> projectIds) {
        if (projectIds == null || projectIds.isEmpty()) {
            throw new IllegalArgumentException("프로젝트를 선택해주세요.");
        }

        // 공휴일 캐시 (넉넉히 2년치)
        LocalDate rangeStart = LocalDate.now().minusMonths(1);
        LocalDate rangeEnd = LocalDate.now().plusYears(2);
        Set<LocalDate> holidays = holidayService.getHolidayDatesBetween(rangeStart, rangeEnd);

        List<Map<String, Object>> results = new ArrayList<>();
        // 멤버별 가용 시점 추적: memberId -> 해당 멤버가 참여 중인 프로젝트의 론치일
        Map<Long, LocalDate> memberBusyUntil = new HashMap<>();

        for (Long projectId : projectIds) {
            Project project = projectRepository.findById(projectId)
                    .orElseThrow(() -> new IllegalArgumentException("프로젝트를 찾을 수 없습니다. id=" + projectId));

            // 이 프로젝트의 BE 멤버 조회 → 겹치는 멤버가 있으면 해당 멤버의 가용 시점 이후로 시작
            List<ProjectMember> pms = projectMemberRepository.findByProjectIdWithMember(projectId);
            List<Long> thisBeMemberIds = pms.stream()
                    .map(ProjectMember::getMember)
                    .filter(m -> m.getRole() == MemberRole.BE && Boolean.TRUE.equals(m.getActive()))
                    .map(Member::getId)
                    .collect(Collectors.toList());

            // 겹치는 멤버 중 가장 늦은 론치일 + 1 영업일 = 이 프로젝트의 최소 시작일
            LocalDate forcedStartDate = null;
            for (Long mid : thisBeMemberIds) {
                LocalDate busyUntil = memberBusyUntil.get(mid);
                if (busyUntil != null) {
                    LocalDate nextAvail = bizDayCalc.getNextBusinessDay(busyUntil, holidays);
                    if (forcedStartDate == null || nextAvail.isAfter(forcedStartDate)) {
                        forcedStartDate = nextAvail;
                    }
                }
            }

            Map<String, Object> result = calculateSingleProject(project, forcedStartDate, holidays, rangeStart, rangeEnd, memberBusyUntil);
            results.add(result);

            // 이 프로젝트의 론치일로 참여 멤버 가용 시점 갱신
            String launchDateStr = (String) result.get("launchDate");
            if (launchDateStr != null) {
                LocalDate launchDate = LocalDate.parse(launchDateStr);
                @SuppressWarnings("unchecked")
                List<Long> allBeMemberIds = (List<Long>) result.get("_beMemberIds");
                if (allBeMemberIds != null) {
                    for (Long mid : allBeMemberIds) {
                        memberBusyUntil.put(mid, launchDate);
                    }
                }
            }
        }

        return results;
    }

    private Map<String, Object> calculateSingleProject(Project project, LocalDate forcedStartDate,
                                                         Set<LocalDate> holidays,
                                                         LocalDate rangeStart, LocalDate rangeEnd,
                                                         Map<Long, LocalDate> memberBusyUntil) {
        Long projectId = project.getId();

        // BE/QA 멤버 조회 (프로젝트에 배정된 전체)
        List<ProjectMember> projectMembers = projectMemberRepository.findByProjectIdWithMember(projectId);
        List<Member> allBeMembers = projectMembers.stream()
                .map(ProjectMember::getMember)
                .filter(m -> m.getRole() == MemberRole.BE && Boolean.TRUE.equals(m.getActive()))
                .collect(Collectors.toList());
        List<Member> qaMembers = projectMembers.stream()
                .map(ProjectMember::getMember)
                .filter(m -> m.getRole() == MemberRole.QA && Boolean.TRUE.equals(m.getActive()))
                .collect(Collectors.toList());

        // 이 프로젝트 시작일 결정 (가용 멤버 필터링에 필요) — 명시적 시작일 우선
        LocalDate projStartForFilter;
        if (project.getStartDate() != null) {
            projStartForFilter = project.getStartDate();
        } else if (forcedStartDate != null) {
            projStartForFilter = forcedStartDate;
        } else {
            projStartForFilter = LocalDate.now();
        }

        // BE 멤버 중 가용 멤버만 필터링: 이전 프로젝트가 론치하지 않으면 캐파에 포함 안 됨
        List<Member> beMembers = new ArrayList<>();
        List<Member> busyMembers = new ArrayList<>();
        for (Member m : allBeMembers) {
            LocalDate busyUntil = memberBusyUntil.get(m.getId());
            if (busyUntil != null && !busyUntil.isBefore(projStartForFilter)) {
                // 이전 프로젝트 론치일이 이 프로젝트 시작일 이후 → 아직 busy
                busyMembers.add(m);
            } else {
                beMembers.add(m);
            }
        }

        // BE 캐파 합계 (가용 멤버만)
        BigDecimal beCapacity = beMembers.stream()
                .map(m -> m.getCapacity() != null ? m.getCapacity() : BigDecimal.ONE)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        // TODO/IN_PROGRESS 태스크 총 공수 (override 우선)
        List<Task> activeTasks = taskRepository.findByProjectId(projectId).stream()
                .filter(t -> ACTIVE_STATUSES.contains(t.getStatus()))
                .collect(Collectors.toList());
        BigDecimal taskMdSum = activeTasks.stream()
                .map(t -> t.getManDays() != null ? t.getManDays() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalMd = (project.getTotalManDaysOverride() != null) ? project.getTotalManDaysOverride() : taskMdSum;

        // QA 마일스톤 정보 (일수 + 시작일)
        List<ProjectMilestone> milestones = projectMilestoneRepository.findByProjectIdOrderBySortOrderAscStartDateAsc(projectId);
        ProjectMilestone qaMilestone = milestones.stream()
                .filter(m -> m.getType() == MilestoneType.QA && m.getDays() != null)
                .findFirst().orElse(null);
        Integer qaDays = qaMilestone != null ? qaMilestone.getDays() : null;
        LocalDate qaFixedStartDate = qaMilestone != null ? qaMilestone.getStartDate() : null;

        // 시작일/론치일이 모두 설정된 경우 → 계산 없이 그대로 사용 (경고만 체크)
        boolean fixedSchedule = (project.getStartDate() != null && project.getEndDate() != null);

        LocalDate startDate;
        LocalDate launchDate;
        LocalDate devEndDate;
        LocalDate qaStartDate = null;
        LocalDate qaEndDate = null;
        int devDays = 0;
        String warning = null;

        // BE 비가용일: 공휴일 (종료일 계산 시 주말+공휴일 스킵용)
        Set<LocalDate> beUnavailable = new HashSet<>(holidays);

        // BE 멤버별 개인 휴가 조회
        Map<Member, Set<LocalDate>> beMemberLeaves = new HashMap<>();
        for (Member m : beMembers) {
            beMemberLeaves.put(m, memberLeaveService.getMemberLeaveDatesBetween(m.getId(), rangeStart, rangeEnd));
        }

        // 개발 소요일 계산: 개인 휴가로 인한 캐파 손실 반영 (반복 수렴)
        if (totalMd.compareTo(BigDecimal.ZERO) > 0 && beCapacity.compareTo(BigDecimal.ZERO) > 0) {
            devDays = calculateDevDaysWithLeaves(totalMd, beCapacity, beMembers, beMemberLeaves, beUnavailable, project, forcedStartDate);
        }

        // QA 비가용일 (fixedSchedule/계산모드 공통)
        Set<LocalDate> qaUnavailable = new HashSet<>(holidays);
        for (Member m : qaMembers) {
            qaUnavailable.addAll(memberLeaveService.getMemberLeaveDatesBetween(m.getId(), rangeStart, rangeEnd));
        }

        LocalDate today = LocalDate.now();

        if (fixedSchedule) {
            // 시작일/론치일 고정 모드
            startDate = project.getStartDate();
            launchDate = project.getEndDate();

            // 개발종료 = 시작일(과거이면 오늘) + 개발소요일
            LocalDate devCalcBase = startDate.isBefore(today) ? today : startDate;
            LocalDate devCalcStart = bizDayCalc.ensureBusinessDay(devCalcBase, beUnavailable);
            if (devDays > 0) {
                devEndDate = bizDayCalc.calculateEndDate(devCalcStart, new BigDecimal(devDays), BigDecimal.ONE, beUnavailable);
            } else {
                devEndDate = devCalcStart;
            }

            // QA가 있으면 론치일 전날이 QA 종료일, 거기서 역산
            if (qaDays != null && qaDays > 0) {
                // QA 종료일 = 론치일 - 1 영업일
                qaEndDate = subtractBusinessDays(launchDate, 1, qaUnavailable);
                if (qaFixedStartDate != null) {
                    qaStartDate = qaFixedStartDate;
                } else {
                    qaStartDate = subtractBusinessDays(qaEndDate, qaDays - 1, qaUnavailable);
                }
            }

            // 경고 체크: 시작일이 과거이면 오늘 기준으로 남은 기간 계산
            LocalDate effectiveStart = startDate.isBefore(today) ? today : startDate;
            int totalNeededDays = devDays + (qaDays != null ? qaDays : 0);
            if (totalNeededDays > 0) {
                int remainingBizDays = countBusinessDays(effectiveStart, launchDate, beUnavailable);
                double ratio = (double) remainingBizDays / totalNeededDays;
                // 권장 론치일: 오늘(또는 시작일) + 예상 소요일 + 1영업일(론치는 QA 다음날)
                LocalDate recommendedQaEnd = bizDayCalc.calculateEndDate(
                        bizDayCalc.ensureBusinessDay(effectiveStart, beUnavailable),
                        new BigDecimal(totalNeededDays), BigDecimal.ONE, beUnavailable);
                LocalDate recommendedLaunch = bizDayCalc.getNextBusinessDay(recommendedQaEnd, holidays);
                String recommendedStr = recommendedLaunch.toString();
                if (ratio < 0.7) {
                    warning = "남은 기간(" + remainingBizDays + "일)이 예상 소요일(" + totalNeededDays + "일)보다 "
                            + Math.round((1 - ratio) * 100) + "% 부족합니다. → 론치일을 " + recommendedStr + "로 변경을 권장합니다.";
                } else if (ratio > 2.0) {
                    warning = "남은 기간(" + remainingBizDays + "일)이 예상 소요일(" + totalNeededDays + "일) 대비 "
                            + Math.round((ratio - 1) * 100) + "% 여유가 있습니다. → 론치일을 " + recommendedStr + "로 앞당길 수 있습니다.";
                }
            }
        } else {
            // 계산 모드
            // 시작일: 프로젝트에 명시적 시작일이 있으면 무조건 사용 (busy 멤버는 캐파 제외로 처리)
            if (project.getStartDate() != null) {
                startDate = project.getStartDate();
            } else if (forcedStartDate != null) {
                startDate = forcedStartDate;
            } else {
                LocalDate earliestMemberStart = beMembers.stream()
                        .map(Member::getQueueStartDate)
                        .filter(Objects::nonNull)
                        .min(LocalDate::compareTo)
                        .orElse(null);

                if (earliestMemberStart != null) {
                    startDate = earliestMemberStart;
                } else {
                    startDate = LocalDate.now();
                }
            }

            LocalDate calcBaseDate = startDate.isBefore(today) ? today : startDate;
            LocalDate devCalcStart = bizDayCalc.ensureBusinessDay(calcBaseDate, beUnavailable);
            devEndDate = devCalcStart;

            if (devDays > 0) {
                devEndDate = bizDayCalc.calculateEndDate(devCalcStart, new BigDecimal(devDays), BigDecimal.ONE, beUnavailable);
            }

            if (qaDays != null && qaDays > 0) {
                if (qaFixedStartDate != null) {
                    qaStartDate = bizDayCalc.ensureBusinessDay(qaFixedStartDate, qaUnavailable);
                } else {
                    qaStartDate = bizDayCalc.getNextBusinessDay(devEndDate, qaUnavailable);
                }
                qaEndDate = bizDayCalc.calculateEndDate(qaStartDate, new BigDecimal(qaDays), BigDecimal.ONE, qaUnavailable);
            }

            // 론치일: 프로젝트에 종료일이 명시적으로 설정되어 있으면 그것을 사용
            if (project.getEndDate() != null) {
                launchDate = project.getEndDate();
            } else if (qaEndDate != null) {
                launchDate = bizDayCalc.getNextBusinessDay(qaEndDate, holidays);
            } else {
                launchDate = bizDayCalc.getNextBusinessDay(devEndDate, holidays);
            }
        }

        // 결과 조립
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projectId", projectId);
        result.put("projectName", project.getName());
        result.put("fixedSchedule", fixedSchedule);
        result.put("startDate", startDate.toString());
        result.put("devEndDate", devEndDate.toString());
        result.put("qaStartDate", qaStartDate != null ? qaStartDate.toString() : null);
        result.put("qaEndDate", qaEndDate != null ? qaEndDate.toString() : null);
        result.put("launchDate", launchDate.toString());
        result.put("totalMd", totalMd);
        result.put("beCount", beMembers.size());
        result.put("beCapacity", beCapacity);
        result.put("devDays", devDays);
        result.put("qaCount", qaMembers.size());
        result.put("qaDays", qaDays);
        result.put("taskCount", activeTasks.size());
        result.put("warning", warning);
        result.put("beMembers", beMembers.stream().map(m -> Map.of("name", m.getName(), "capacity", m.getCapacity())).collect(Collectors.toList()));
        if (!busyMembers.isEmpty()) {
            result.put("busyMembers", busyMembers.stream().map(m -> Map.of("name", m.getName(), "capacity", m.getCapacity())).collect(Collectors.toList()));
        }
        result.put("qaMembers", qaMembers.stream().map(m -> Map.of("name", m.getName())).collect(Collectors.toList()));
        // 내부용: 멤버 가용 추적에 사용 (allBeMembers — busy 포함 전체)
        result.put("_beMemberIds", allBeMembers.stream().map(Member::getId).collect(Collectors.toList()));

        return result;
    }

    /**
     * 개인 휴가로 인한 캐파 손실을 반영한 개발 소요일 계산
     * 반복 수렴: 초기 추정 → 해당 기간 내 휴가 손실 MD 계산 → 조정된 소요일 재계산
     */
    private int calculateDevDaysWithLeaves(BigDecimal totalMd, BigDecimal beCapacity,
                                            List<Member> beMembers, Map<Member, Set<LocalDate>> beMemberLeaves,
                                            Set<LocalDate> beUnavailable, Project project, LocalDate forcedStartDate) {
        LocalDate today = LocalDate.now();
        LocalDate calcStart;
        if (forcedStartDate != null) {
            calcStart = forcedStartDate;
        } else if (project.getStartDate() != null) {
            calcStart = project.getStartDate();
        } else {
            calcStart = today;
        }
        if (calcStart.isBefore(today)) calcStart = today;
        calcStart = bizDayCalc.ensureBusinessDay(calcStart, beUnavailable);

        // 초기 추정
        int devDays = totalMd.divide(beCapacity, 0, RoundingMode.CEILING).intValue();

        final LocalDate devStart = calcStart;

        // 반복 수렴 (최대 5회)
        for (int iter = 0; iter < 5; iter++) {
            LocalDate estEnd = bizDayCalc.calculateEndDate(devStart, new BigDecimal(devDays), BigDecimal.ONE, beUnavailable);

            // 해당 기간 내 멤버별 휴가로 손실되는 MD 계산
            BigDecimal lostMd = BigDecimal.ZERO;
            for (Member m : beMembers) {
                Set<LocalDate> leaves = beMemberLeaves.get(m);
                if (leaves == null || leaves.isEmpty()) continue;
                BigDecimal cap = m.getCapacity() != null ? m.getCapacity() : BigDecimal.ONE;
                long leaveCount = leaves.stream()
                        .filter(d -> !d.isBefore(devStart) && !d.isAfter(estEnd))
                        .filter(d -> bizDayCalc.isBusinessDay(d, beUnavailable))
                        .count();
                lostMd = lostMd.add(cap.multiply(new BigDecimal(leaveCount)));
            }

            BigDecimal adjustedMd = totalMd.add(lostMd);
            int newDevDays = adjustedMd.divide(beCapacity, 0, RoundingMode.CEILING).intValue();
            if (newDevDays == devDays) break;
            devDays = newDevDays;
        }
        return devDays;
    }

    /**
     * 시작일~종료일 사이 영업일 수 (비가용일 제외, 양쪽 포함)
     */
    private int countBusinessDays(LocalDate from, LocalDate to, Set<LocalDate> unavailable) {
        int count = 0;
        LocalDate d = from;
        while (!d.isAfter(to)) {
            if (bizDayCalc.isBusinessDay(d, unavailable)) count++;
            d = d.plusDays(1);
        }
        return count;
    }

    /**
     * 기준일에서 N 영업일 전 날짜를 역산 (비가용일 제외)
     * 기준일을 포함하지 않고, 기준일 이전으로 N 영업일째 날짜 반환
     * 예: subtractBusinessDays(수요일, 1) → 화요일
     */
    private LocalDate subtractBusinessDays(LocalDate from, int days, Set<LocalDate> unavailable) {
        LocalDate d = from;
        while (days > 0) {
            d = d.minusDays(1);
            if (bizDayCalc.isBusinessDay(d, unavailable)) {
                days--;
            }
        }
        return d;
    }
}
