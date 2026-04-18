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
    private final ProjectSquadRepository projectSquadRepository;
    private final SquadMemberRepository squadMemberRepository;
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
        // 멤버별 바쁜 기간 추적: memberId -> (startDate, endDate) 리스트
        Map<Long, List<LocalDate[]>> memberBusyPeriods = new HashMap<>();

        for (Long projectId : projectIds) {
            Project project = projectRepository.findById(projectId)
                    .orElseThrow(() -> new IllegalArgumentException("프로젝트를 찾을 수 없습니다. id=" + projectId));

            // KTLO 프로젝트는 일정 계산에서 제외
            if (Boolean.TRUE.equals(project.getKtlo())) {
                Map<String, Object> skipped = new LinkedHashMap<>();
                skipped.put("projectId", projectId);
                skipped.put("projectName", project.getName());
                skipped.put("skipped", true);
                skipped.put("skipReason", "KTLO 프로젝트는 일정 계산에서 제외됩니다.");
                results.add(skipped);
                continue;
            }

            Map<String, Object> result = calculateSingleProject(project, holidays, rangeStart, rangeEnd, memberBusyPeriods);
            results.add(result);

            // 이 프로젝트의 기간을 참여 멤버의 바쁜 기간에 추가
            String startStr = (String) result.get("startDate");
            String launchStr = (String) result.get("launchDate");
            if (startStr != null && launchStr != null) {
                LocalDate projStart = LocalDate.parse(startStr);
                LocalDate projLaunchNextDay = bizDayCalc.getNextBusinessDay(LocalDate.parse(launchStr), holidays);
                @SuppressWarnings("unchecked")
                List<Long> allBeMemberIds = (List<Long>) result.get("_beMemberIds");
                if (allBeMemberIds != null) {
                    for (Long mid : allBeMemberIds) {
                        memberBusyPeriods.computeIfAbsent(mid, k -> new ArrayList<>())
                                .add(new LocalDate[]{projStart, projLaunchNextDay});
                    }
                }
            }
        }

        return results;
    }

    private Map<String, Object> calculateSingleProject(Project project,
                                                         Set<LocalDate> holidays,
                                                         LocalDate rangeStart, LocalDate rangeEnd,
                                                         Map<Long, List<LocalDate[]>> memberBusyPeriods) {
        Long projectId = project.getId();

        // ===== Step 1: BE 멤버 결정 =====
        List<ProjectMember> projectMembers = projectMemberRepository.findByProjectIdWithMember(projectId);
        List<Member> explicitBeMembers = projectMembers.stream()
                .map(ProjectMember::getMember)
                .filter(m -> m.getRole() == MemberRole.BE && Boolean.TRUE.equals(m.getActive()))
                .collect(Collectors.toList());
        List<Member> qaMembers = projectMembers.stream()
                .map(ProjectMember::getMember)
                .filter(m -> m.getRole() == MemberRole.QA && Boolean.TRUE.equals(m.getActive()))
                .collect(Collectors.toList());

        boolean autoAssigned = false;
        List<Member> beMembers;
        List<Member> autoAssignedMembers = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (!explicitBeMembers.isEmpty()) {
            // 명시적 할당 멤버 사용
            beMembers = new ArrayList<>(explicitBeMembers);
        } else {
            // Step 1-1: 스쿼드 멤버 풀 구성
            autoAssigned = true;
            beMembers = new ArrayList<>();
            List<Member> squadMemberPool = getSquadMemberPool(projectId);

            if (!squadMemberPool.isEmpty()) {
                // Step 1-2: 가용 멤버 필터링
                LocalDate projStartEstimate = estimateProjectStart(project);
                // totalMd 미리 계산 (인원 결정에 필요)
                BigDecimal totalMd = calculateTotalMd(project, projectId);

                // QA 일수 조회
                Integer qaDays = getQaDays(projectId);

                // Step 1-3 & 1-4: 필요 인원 결정 및 선택
                List<Member> availableMembers = filterAvailableMembers(squadMemberPool, projStartEstimate, project, memberBusyPeriods, holidays);

                // capacity 높은 순 정렬
                availableMembers.sort((a, b) -> {
                    BigDecimal ca = a.getCapacity() != null ? a.getCapacity() : BigDecimal.ONE;
                    BigDecimal cb = b.getCapacity() != null ? b.getCapacity() : BigDecimal.ONE;
                    return cb.compareTo(ca);
                });

                boolean hasDates = project.getStartDate() != null && project.getEndDate() != null;

                if (hasDates) {
                    // 기간 지정: 개발완료일 기준 필요 capacity 산출
                    LocalDate devEndTarget = calculateDevEndTarget(project, qaDays, holidays);
                    if (devEndTarget != null && project.getStartDate() != null) {
                        int devBizDays = countBusinessDays(project.getStartDate(), devEndTarget, holidays);
                        if (devBizDays > 0 && totalMd.compareTo(BigDecimal.ZERO) > 0) {
                            BigDecimal neededCapacity = totalMd.divide(new BigDecimal(devBizDays), 2, RoundingMode.CEILING);
                            beMembers = selectByCapacity(availableMembers, neededCapacity);
                        } else {
                            beMembers = new ArrayList<>(availableMembers);
                        }
                    } else {
                        beMembers = new ArrayList<>(availableMembers);
                    }

                    // 부족 시 경고
                    BigDecimal selectedCapacity = beMembers.stream()
                            .map(m -> m.getCapacity() != null ? m.getCapacity() : BigDecimal.ONE)
                            .reduce(BigDecimal.ZERO, BigDecimal::add);
                    if (totalMd.compareTo(BigDecimal.ZERO) > 0 && selectedCapacity.compareTo(BigDecimal.ZERO) > 0) {
                        LocalDate devEndTarget2 = calculateDevEndTarget(project, qaDays, holidays);
                        if (devEndTarget2 != null && project.getStartDate() != null) {
                            int devBizDays = countBusinessDays(project.getStartDate(), devEndTarget2, holidays);
                            BigDecimal neededCapacity = devBizDays > 0 ? totalMd.divide(new BigDecimal(devBizDays), 2, RoundingMode.CEILING) : totalMd;
                            if (selectedCapacity.compareTo(neededCapacity) < 0) {
                                // 부족 인원 계산
                                BigDecimal deficit = neededCapacity.subtract(selectedCapacity);
                                int additionalNeeded = deficit.divide(BigDecimal.ONE, 0, RoundingMode.CEILING).intValue();
                                // 현재 인원 기준 예상 론치일 계산
                                int actualDevDays = totalMd.divide(selectedCapacity, 0, RoundingMode.CEILING).intValue();
                                LocalDate estDevStart = bizDayCalc.ensureBusinessDay(
                                        project.getStartDate().isBefore(LocalDate.now()) ? LocalDate.now() : project.getStartDate(), holidays);
                                LocalDate estDevEnd = bizDayCalc.calculateEndDate(estDevStart, new BigDecimal(actualDevDays), BigDecimal.ONE, holidays);
                                LocalDate estLaunch;
                                if (qaDays != null && qaDays > 0) {
                                    LocalDate estQaStart = bizDayCalc.getNextBusinessDay(estDevEnd, holidays);
                                    LocalDate estQaEnd = bizDayCalc.calculateEndDate(estQaStart, new BigDecimal(qaDays), BigDecimal.ONE, holidays);
                                    estLaunch = bizDayCalc.getNextBusinessDay(estQaEnd, holidays);
                                } else {
                                    estLaunch = bizDayCalc.getNextBusinessDay(estDevEnd, holidays);
                                }
                                warnings.add("BE " + additionalNeeded + "명 추가 투입 필요. 현재 인원(" + beMembers.size() + "명) 기준 예상 론치일: " + estLaunch);
                            }
                        }
                    }
                } else {
                    // 기간 미지정: totalMd 구간별 인원 테이블
                    int targetCount = getTargetMemberCount(totalMd);
                    int selectCount = Math.min(targetCount, availableMembers.size());
                    beMembers = new ArrayList<>(availableMembers.subList(0, selectCount));
                }

                autoAssignedMembers = new ArrayList<>(beMembers);
            }
        }

        // 가용/바쁜 멤버 분리 (명시적 할당인 경우)
        List<Member> busyMembers = new ArrayList<>();
        if (!autoAssigned) {
            LocalDate projStartForFilter = project.getStartDate() != null ? project.getStartDate() : LocalDate.now();
            List<Member> filteredBe = new ArrayList<>();
            for (Member m : beMembers) {
                if (isMemberBusy(m.getId(), projStartForFilter, project, memberBusyPeriods)) {
                    busyMembers.add(m);
                } else {
                    filteredBe.add(m);
                }
            }
            beMembers = filteredBe;
        }

        // ===== Step 2: 일정 계산 실행 =====
        BigDecimal beCapacity = beMembers.stream()
                .map(m -> m.getCapacity() != null ? m.getCapacity() : BigDecimal.ONE)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        // totalMd
        BigDecimal totalMd = calculateTotalMd(project, projectId);
        List<Task> activeTasks = taskRepository.findByProjectId(projectId).stream()
                .filter(t -> ACTIVE_STATUSES.contains(t.getStatus()))
                .collect(Collectors.toList());

        // QA 마일스톤
        List<ProjectMilestone> milestones = projectMilestoneRepository.findByProjectIdOrderBySortOrderAscStartDateAsc(projectId);
        ProjectMilestone qaMilestone = milestones.stream()
                .filter(m -> m.getType() == MilestoneType.QA && m.getDays() != null)
                .findFirst().orElse(null);
        Integer qaDays = qaMilestone != null ? qaMilestone.getDays() : null;
        LocalDate qaFixedStartDate = qaMilestone != null ? qaMilestone.getStartDate() : null;

        boolean fixedSchedule = (project.getStartDate() != null && project.getEndDate() != null);

        Set<LocalDate> beUnavailable = new HashSet<>(holidays);
        Map<Member, Set<LocalDate>> beMemberLeaves = new HashMap<>();
        for (Member m : beMembers) {
            beMemberLeaves.put(m, memberLeaveService.getMemberLeaveDatesBetween(m.getId(), rangeStart, rangeEnd));
        }

        int devDays = 0;
        if (totalMd.compareTo(BigDecimal.ZERO) > 0 && beCapacity.compareTo(BigDecimal.ZERO) > 0) {
            devDays = calculateDevDaysWithLeaves(totalMd, beCapacity, beMembers, beMemberLeaves, beUnavailable, project, null);
        }

        Set<LocalDate> qaUnavailable = new HashSet<>(holidays);
        for (Member m : qaMembers) {
            qaUnavailable.addAll(memberLeaveService.getMemberLeaveDatesBetween(m.getId(), rangeStart, rangeEnd));
        }

        LocalDate today = LocalDate.now();
        LocalDate startDate;
        LocalDate launchDate;
        LocalDate devEndDate;
        LocalDate qaStartDate = null;
        LocalDate qaEndDate = null;
        String warning = null;

        if (fixedSchedule) {
            startDate = project.getStartDate();
            launchDate = project.getEndDate();

            LocalDate devCalcBase = startDate.isBefore(today) ? today : startDate;
            LocalDate devCalcStart = bizDayCalc.ensureBusinessDay(devCalcBase, beUnavailable);
            if (devDays > 0) {
                devEndDate = bizDayCalc.calculateEndDate(devCalcStart, new BigDecimal(devDays), BigDecimal.ONE, beUnavailable);
            } else {
                devEndDate = devCalcStart;
            }

            if (qaDays != null && qaDays > 0) {
                qaEndDate = subtractBusinessDays(launchDate, 1, qaUnavailable);
                if (qaFixedStartDate != null) {
                    qaStartDate = qaFixedStartDate;
                } else {
                    qaStartDate = subtractBusinessDays(qaEndDate, qaDays - 1, qaUnavailable);
                }
            }

            LocalDate effectiveStart = startDate.isBefore(today) ? today : startDate;
            int totalNeededDays = devDays + (qaDays != null ? qaDays : 0);
            if (totalNeededDays > 0) {
                int remainingBizDays = countBusinessDays(effectiveStart, launchDate, beUnavailable);
                double ratio = (double) remainingBizDays / totalNeededDays;
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
            if (project.getStartDate() != null) {
                startDate = project.getStartDate();
            } else {
                LocalDate earliestMemberStart = beMembers.stream()
                        .map(Member::getQueueStartDate)
                        .filter(Objects::nonNull)
                        .min(LocalDate::compareTo)
                        .orElse(null);
                startDate = earliestMemberStart != null ? earliestMemberStart : LocalDate.now();
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

            if (project.getEndDate() != null) {
                launchDate = project.getEndDate();
            } else if (qaEndDate != null) {
                launchDate = bizDayCalc.getNextBusinessDay(qaEndDate, holidays);
            } else {
                launchDate = bizDayCalc.getNextBusinessDay(devEndDate, holidays);
            }
        }

        // 기존 warning 과 자동 할당 warnings 병합
        if (warning != null) {
            warnings.add(0, warning);
        }

        // ===== 결과 조립 =====
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
        result.put("warning", warnings.isEmpty() ? null : String.join("\n", warnings));
        result.put("beMembers", beMembers.stream().map(m -> Map.of("name", m.getName(), "capacity", m.getCapacity())).collect(Collectors.toList()));
        if (!busyMembers.isEmpty()) {
            result.put("busyMembers", busyMembers.stream().map(m -> Map.of("name", m.getName(), "capacity", m.getCapacity())).collect(Collectors.toList()));
        }
        if (!autoAssignedMembers.isEmpty()) {
            result.put("autoAssignedMembers", autoAssignedMembers.stream()
                    .map(m -> Map.of("id", m.getId(), "name", m.getName(), "capacity", m.getCapacity()))
                    .collect(Collectors.toList()));
        }
        result.put("qaMembers", qaMembers.stream().map(m -> Map.of("name", m.getName())).collect(Collectors.toList()));

        // 내부용: 멤버 가용 추적
        List<Long> allIds = new ArrayList<>();
        beMembers.forEach(m -> allIds.add(m.getId()));
        busyMembers.forEach(m -> allIds.add(m.getId()));
        result.put("_beMemberIds", allIds);

        return result;
    }

    // ===== 자동 할당 헬퍼 메서드 =====

    /**
     * 프로젝트에 연결된 모든 스쿼드의 BE 멤버 풀 구성 (중복 제거)
     */
    private List<Member> getSquadMemberPool(Long projectId) {
        List<ProjectSquad> projectSquads = projectSquadRepository.findByProjectIdWithSquad(projectId);
        Set<Long> seenIds = new HashSet<>();
        List<Member> pool = new ArrayList<>();
        for (ProjectSquad ps : projectSquads) {
            List<SquadMember> sms = squadMemberRepository.findBySquadIdWithMember(ps.getSquad().getId());
            for (SquadMember sm : sms) {
                Member m = sm.getMember();
                if (m.getRole() == MemberRole.BE && Boolean.TRUE.equals(m.getActive()) && seenIds.add(m.getId())) {
                    pool.add(m);
                }
            }
        }
        return pool;
    }

    /**
     * 프로젝트 시작일 추정 (자동 할당 가용 판단용)
     */
    private LocalDate estimateProjectStart(Project project) {
        if (project.getStartDate() != null) return project.getStartDate();
        return LocalDate.now();
    }

    /**
     * 멤버가 특정 프로젝트 기간에 바쁜지 판단
     */
    private boolean isMemberBusy(Long memberId, LocalDate projStart, Project project,
                                   Map<Long, List<LocalDate[]>> memberBusyPeriods) {
        List<LocalDate[]> periods = memberBusyPeriods.get(memberId);
        if (periods == null || periods.isEmpty()) return false;
        for (LocalDate[] period : periods) {
            // 기간 중첩 판단: period[0]~period[1] 과 projStart~(추정 종료) 가 겹치는지
            if (projStart.isBefore(period[1]) && (project.getEndDate() == null || !project.getEndDate().isBefore(period[0]))) {
                return true;
            }
        }
        return false;
    }

    /**
     * 가용 멤버 필터링: 바쁜 기간과 현재 프로젝트 기간이 중첩되지 않는 멤버
     */
    private List<Member> filterAvailableMembers(List<Member> pool, LocalDate projStart, Project project,
                                                  Map<Long, List<LocalDate[]>> memberBusyPeriods,
                                                  Set<LocalDate> holidays) {
        List<Member> available = new ArrayList<>();
        for (Member m : pool) {
            if (!isMemberBusy(m.getId(), projStart, project, memberBusyPeriods)) {
                available.add(m);
            }
        }
        return available;
    }

    /**
     * capacity 누적이 필요 capacity에 도달할 때까지 멤버 선택
     */
    private List<Member> selectByCapacity(List<Member> sortedMembers, BigDecimal neededCapacity) {
        List<Member> selected = new ArrayList<>();
        BigDecimal accumulated = BigDecimal.ZERO;
        for (Member m : sortedMembers) {
            selected.add(m);
            accumulated = accumulated.add(m.getCapacity() != null ? m.getCapacity() : BigDecimal.ONE);
            if (accumulated.compareTo(neededCapacity) >= 0) break;
        }
        return selected;
    }

    /**
     * totalMd 구간별 목표 인원 수
     */
    private int getTargetMemberCount(BigDecimal totalMd) {
        int md = totalMd.intValue();
        if (md <= 5) return 1;
        if (md <= 15) return 2;
        if (md <= 30) return 3;
        return 4;
    }

    /**
     * 프로젝트의 개발완료 목표일 (endDate - QA일수)
     */
    private LocalDate calculateDevEndTarget(Project project, Integer qaDays, Set<LocalDate> holidays) {
        if (project.getEndDate() == null) return null;
        if (qaDays == null || qaDays <= 0) return project.getEndDate();
        // endDate(론치일) 전날부터 QA일수 + 론치일 1일 역산
        return subtractBusinessDays(project.getEndDate(), qaDays + 1, holidays);
    }

    /**
     * 프로젝트의 totalMd 계산
     */
    private BigDecimal calculateTotalMd(Project project, Long projectId) {
        if (project.getTotalManDaysOverride() != null) return project.getTotalManDaysOverride();
        return taskRepository.findByProjectId(projectId).stream()
                .filter(t -> ACTIVE_STATUSES.contains(t.getStatus()))
                .map(t -> t.getManDays() != null ? t.getManDays() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    /**
     * QA 일수 조회
     */
    private Integer getQaDays(Long projectId) {
        return projectMilestoneRepository.findByProjectIdOrderBySortOrderAscStartDateAsc(projectId).stream()
                .filter(m -> m.getType() == MilestoneType.QA && m.getDays() != null)
                .findFirst()
                .map(ProjectMilestone::getDays)
                .orElse(null);
    }

    // ===== 기존 계산 헬퍼 =====

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

        int devDays = totalMd.divide(beCapacity, 0, RoundingMode.CEILING).intValue();
        final LocalDate devStart = calcStart;

        for (int iter = 0; iter < 5; iter++) {
            LocalDate estEnd = bizDayCalc.calculateEndDate(devStart, new BigDecimal(devDays), BigDecimal.ONE, beUnavailable);
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

    private int countBusinessDays(LocalDate from, LocalDate to, Set<LocalDate> unavailable) {
        int count = 0;
        LocalDate d = from;
        while (!d.isAfter(to)) {
            if (bizDayCalc.isBusinessDay(d, unavailable)) count++;
            d = d.plusDays(1);
        }
        return count;
    }

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
