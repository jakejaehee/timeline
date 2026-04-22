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
    private final MemberRepository memberRepository;
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

        // 멤버 ID→이름 맵 (QA 담당자 ID를 이름으로 변환하기 위해 1회 조회)
        // 비활성/삭제된 멤버도 이름을 표시할 수 있도록 전체 멤버 조회
        Map<Long, String> memberIdToName = memberRepository.findAll().stream()
                .collect(Collectors.toMap(Member::getId, Member::getName));

        List<Project> projects = projectIds.stream()
                .map(projectId -> projectRepository.findById(projectId)
                        .orElseThrow(() -> new IllegalArgumentException("프로젝트를 찾을 수 없습니다. id=" + projectId)))
                .sorted(Comparator.comparing(Project::getSortOrder, Comparator.nullsLast(Integer::compareTo))
                        .thenComparing(Project::getId))
                .collect(Collectors.toList());

        // sortOrder 순 계산 (프로젝트 목록 순서대로 멤버가 투입됨)
        return calculateSchedulePass(projects, holidays, rangeStart, rangeEnd, memberIdToName);
    }

    private List<Map<String, Object>> calculateSchedulePass(List<Project> projects,
                                                            Set<LocalDate> holidays,
                                                            LocalDate rangeStart, LocalDate rangeEnd,
                                                            Map<Long, String> memberIdToName) {
        List<Map<String, Object>> results = new ArrayList<>();
        // 멤버별 바쁜 기간 추적: memberId -> (startDate, endDate) 리스트
        Map<Long, List<LocalDate[]>> memberBusyPeriods = new HashMap<>();
        // QA 담당자별 바쁜 기간 추적: qaName -> Object[]{qaStartDate, qaEndDate, projectName} 리스트
        Map<String, List<Object[]>> qaAssigneeBusyPeriods = new HashMap<>();

        for (Project project : projects) {
            Long projectId = project.getId();

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

            // '미분류' 프로젝트는 일정 계산에서 제외
            if ("미분류".equals(project.getName())) {
                Map<String, Object> skipped = new LinkedHashMap<>();
                skipped.put("projectId", projectId);
                skipped.put("projectName", project.getName());
                skipped.put("skipped", true);
                skipped.put("skipReason", "'미분류' 프로젝트는 일정 계산에서 제외됩니다.");
                results.add(skipped);
                continue;
            }

            Map<String, Object> result = calculateSingleProject(project, holidays, rangeStart, rangeEnd, memberBusyPeriods, qaAssigneeBusyPeriods, memberIdToName);
            results.add(result);

            // 이 프로젝트의 기간을 참여 멤버의 바쁜 기간에 추가
            String startStr = (String) result.get("startDate");
            String launchStr = (String) result.get("launchDate");
            if (startStr != null && launchStr != null) {
                LocalDate projStart = LocalDate.parse(startStr);
                LocalDate projLaunch = LocalDate.parse(launchStr);
                @SuppressWarnings("unchecked")
                List<Long> allBeMemberIds = (List<Long>) result.get("_beMemberIds");
                if (allBeMemberIds != null) {
                    for (Long mid : allBeMemberIds) {
                        memberBusyPeriods.computeIfAbsent(mid, k -> new ArrayList<>())
                                .add(new LocalDate[]{projStart, projLaunch});
                    }
                }
            }
        }

        return results;
    }

    private List<Project> orderProjectsByLaunchDate(List<Project> projects, List<Map<String, Object>> results) {
        Map<Long, LocalDate> launchDateByProjectId = new HashMap<>();
        for (Map<String, Object> result : results) {
            Object pid = result.get("projectId");
            Object launchStr = result.get("launchDate");
            if (pid == null || launchStr == null) continue;
            launchDateByProjectId.put(((Number) pid).longValue(), LocalDate.parse(launchStr.toString()));
        }

        List<Project> ordered = new ArrayList<>(projects);
        ordered.sort((a, b) -> {
            LocalDate la = launchDateByProjectId.get(a.getId());
            LocalDate lb = launchDateByProjectId.get(b.getId());
            if (la == null && lb == null) {
                int bySort = Comparator.nullsLast(Integer::compareTo).compare(a.getSortOrder(), b.getSortOrder());
                return bySort != 0 ? bySort : a.getId().compareTo(b.getId());
            }
            if (la == null) return 1;
            if (lb == null) return -1;
            int byLaunch = la.compareTo(lb);
            if (byLaunch != 0) return byLaunch;
            int bySort = Comparator.nullsLast(Integer::compareTo).compare(a.getSortOrder(), b.getSortOrder());
            return bySort != 0 ? bySort : a.getId().compareTo(b.getId());
        });
        return ordered;
    }

    private Map<String, Object> calculateSingleProject(Project project,
                                                         Set<LocalDate> holidays,
                                                         LocalDate rangeStart, LocalDate rangeEnd,
                                                         Map<Long, List<LocalDate[]>> memberBusyPeriods,
                                                         Map<String, List<Object[]>> qaAssigneeBusyPeriods,
                                                         Map<Long, String> memberIdToName) {
        Long projectId = project.getId();

        // ===== Step 1: BE 멤버 결정 =====
        List<ProjectMember> projectMembers = projectMemberRepository.findByProjectIdWithMember(projectId);
        List<Member> explicitBeMembers = projectMembers.stream()
                .map(ProjectMember::getMember)
                .filter(m -> m.getRole() == MemberRole.BE && Boolean.TRUE.equals(m.getActive()))
                .collect(Collectors.toList());
        // QA 담당자는 ProjectMilestone.qaAssignees에서 파싱 (아래에서 처리)

        // totalMd는 여러 곳에서 사용되므로 한 번만 계산
        BigDecimal totalMd = calculateTotalMd(project, projectId);

        boolean autoAssigned = false;
        List<Member> beMembers;
        List<Member> autoAssignedMembers = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Map<Long, LocalDate> lateJoinDates = new HashMap<>();

        if (!explicitBeMembers.isEmpty()) {
            // 명시적 할당 멤버 사용
            beMembers = new ArrayList<>(explicitBeMembers);
        } else {
            // Step 1-1: 스쿼드 멤버 풀 구성
            autoAssigned = true;
            beMembers = new ArrayList<>();
            List<Member> squadMemberPool = getSquadMemberPool(projectId);

            if (!squadMemberPool.isEmpty() && totalMd.compareTo(BigDecimal.ZERO) > 0) {
                // Step 1-2: 가용 멤버 필터링
                LocalDate projStartEstimate = estimateProjectStart(project);

                // QA 일수 조회
                Integer qaDays = getQaDays(projectId);

                // Step 1-3 & 1-4: 필요 인원 결정 및 선택
                // 가용 판단 기준 종료일: 기간 지정이면 실제 론치일, 미지정이면 1명 기준 최악 상한
                LocalDate projStartEstimateAdj = bizDayCalc.ensureBusinessDay(projStartEstimate, holidays);
                boolean hasDatesForFilter = (project.getStartDate() != null && project.getEndDate() != null);
                LocalDate filterEndDate;
                if (hasDatesForFilter) {
                    filterEndDate = project.getEndDate();  // 실제 론치일 기준
                } else {
                    int autoEstDevDays = Math.max((int) Math.ceil(totalMd.doubleValue()), 1);
                    filterEndDate = bizDayCalc.calculateEndDate(projStartEstimateAdj, new BigDecimal(autoEstDevDays), BigDecimal.ONE, holidays);
                }
                List<Member> availableMembers = filterAvailableMembers(squadMemberPool, projStartEstimate, filterEndDate, memberBusyPeriods);

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

                // 자동 투입된 멤버의 지연 합류 가능 시작일 계산
                for (Member m : beMembers) {
                    LocalDate availableFrom = getMemberAvailableFrom(
                            m.getId(), projStartEstimate, filterEndDate, memberBusyPeriods, holidays);
                    // queueStartDate가 있으면 그보다 이전에는 투입 불가
                    LocalDate queueStart = m.getQueueStartDate();
                    if (queueStart != null) {
                        if (availableFrom == null || queueStart.isAfter(availableFrom)) {
                            availableFrom = queueStart;
                        }
                    }
                    if (availableFrom != null) {
                        lateJoinDates.put(m.getId(), availableFrom);
                    }
                }
            }
        }

        // 가용/바쁜 멤버 분리 (명시적 할당인 경우)
        List<Member> busyMembers = new ArrayList<>();
        if (!autoAssigned) {
            LocalDate projStartForFilter = project.getStartDate() != null ? project.getStartDate() : LocalDate.now();
            // 과거 시작일은 today로 보정 (실제 일정 계산에서도 today 이전은 today로 보정됨)
            if (projStartForFilter.isBefore(LocalDate.now())) {
                projStartForFilter = LocalDate.now();
            }

            // projEstimatedEnd 산출: 1명 기준 최악 상한 (totalMd 영업일)
            int estimatedDevDays = (int) Math.ceil(totalMd.doubleValue());
            LocalDate projEstimatedEnd;
            if (project.getEndDate() != null) {
                projEstimatedEnd = project.getEndDate();
            } else {
                projEstimatedEnd = bizDayCalc.calculateEndDate(
                        bizDayCalc.ensureBusinessDay(projStartForFilter, holidays),
                        new BigDecimal(Math.max(estimatedDevDays, 1)), BigDecimal.ONE, holidays);
            }

            List<Member> filteredBe = new ArrayList<>();
            for (Member m : beMembers) {
                if (isMemberBusy(m.getId(), projStartForFilter, projEstimatedEnd, memberBusyPeriods)) {
                    busyMembers.add(m);
                } else {
                    filteredBe.add(m);
                    // 지연 합류 멤버의 availableFrom 계산
                    LocalDate availableFrom = getMemberAvailableFrom(m.getId(), projStartForFilter, projEstimatedEnd, memberBusyPeriods, holidays);
                    // queueStartDate가 있으면 그보다 이전에는 투입 불가
                    LocalDate queueStart = m.getQueueStartDate();
                    if (queueStart != null) {
                        if (availableFrom == null || queueStart.isAfter(availableFrom)) {
                            availableFrom = queueStart;
                        }
                    }
                    if (availableFrom != null) {
                        lateJoinDates.put(m.getId(), availableFrom);
                    }
                }
            }
            beMembers = filteredBe;

            // 기간 미지정 + 명시적 할당: 가용 인원이 목표 인원에 미달하면 경고
            if (project.getStartDate() == null && project.getEndDate() == null
                    && totalMd.compareTo(BigDecimal.ZERO) > 0) {
                int targetCount = getTargetMemberCount(totalMd);
                if (beMembers.size() < targetCount) {
                    int additionalNeeded = targetCount - beMembers.size();
                    warnings.add("BE " + additionalNeeded + "명 추가 투입 필요 (현재 " + beMembers.size() + "명)");
                }
            }
        }

        // ===== Step 2: 일정 계산 실행 =====
        BigDecimal beCapacity = beMembers.stream()
                .map(m -> m.getCapacity() != null ? m.getCapacity() : BigDecimal.ONE)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        List<Task> activeTasks = taskRepository.findByProjectId(projectId).stream()
                .filter(t -> ACTIVE_STATUSES.contains(t.getStatus()))
                .collect(Collectors.toList());

        // QA 마일스톤
        List<ProjectMilestone> milestones = projectMilestoneRepository.findByProjectIdOrderBySortOrderAscStartDateAsc(projectId);
        ProjectMilestone qaMilestone = milestones.stream()
                .filter(m -> m.getType() == MilestoneType.QA && m.getDays() != null)
                .findFirst().orElse(null);
        Integer qaDays = qaMilestone != null ? qaMilestone.getDays() : null;

        // QA 시작일: 직전 마일스톤의 종료일 + 1일
        LocalDate qaFixedStartDate = null;
        if (qaMilestone != null) {
            int qaIdx = milestones.indexOf(qaMilestone);
            if (qaIdx > 0) {
                ProjectMilestone prevMilestone = milestones.get(qaIdx - 1);
                if (prevMilestone.getEndDate() != null) {
                    qaFixedStartDate = prevMilestone.getEndDate().plusDays(1);
                }
            }
        }

        // QA 담당자 이름 목록 (ProjectMilestone.qaAssignees 파싱, ID→이름 변환)
        List<String> qaAssigneeNames = parseQaAssigneeNames(
                qaMilestone != null ? qaMilestone.getQaAssignees() : null, memberIdToName);

        boolean fixedSchedule = (project.getStartDate() != null && project.getEndDate() != null);

        Set<LocalDate> beUnavailable = new HashSet<>(holidays);
        // QA 비가용일: 공휴일만 적용 (qaAssignees는 이름 문자열이라 Member 조회 복잡성 회피)
        Set<LocalDate> qaUnavailable = new HashSet<>(holidays);

        TimelineComputation timeline = computeTimeline(
                project, projectId, totalMd, beMembers, beCapacity, qaDays, qaFixedStartDate,
                holidays, beUnavailable, qaUnavailable, rangeStart, rangeEnd, memberBusyPeriods
        );

        int devDays = timeline.devDays;
        LocalDate startDate = timeline.startDate;
        LocalDate launchDate = timeline.launchDate;
        LocalDate devEndDate = timeline.devEndDate;
        LocalDate qaStartDate = timeline.qaStartDate;
        LocalDate qaEndDate = timeline.qaEndDate;
        String warning = timeline.warning;

        // 자동 투입된 멤버 중 lateJoinDate > devEndDate인 멤버 제외
        if (autoAssigned && devEndDate != null && !lateJoinDates.isEmpty()) {
            List<Member> lateExcluded = new ArrayList<>();
            Iterator<Member> it = beMembers.iterator();
            while (it.hasNext()) {
                Member m = it.next();
                LocalDate lateJoin = lateJoinDates.get(m.getId());
                if (lateJoin != null && lateJoin.isAfter(devEndDate)) {
                    it.remove();
                    lateJoinDates.remove(m.getId());
                    lateExcluded.add(m);
                }
            }
            if (!lateExcluded.isEmpty()) {
                // beCapacity 재계산
                beCapacity = beMembers.stream()
                        .map(m -> m.getCapacity() != null ? m.getCapacity() : BigDecimal.ONE)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                autoAssignedMembers = new ArrayList<>(beMembers);

                // 제외된 최종 인원 기준으로 일정 재계산
                timeline = computeTimeline(
                        project, projectId, totalMd, beMembers, beCapacity, qaDays, qaFixedStartDate,
                        holidays, beUnavailable, qaUnavailable, rangeStart, rangeEnd, memberBusyPeriods
                );
                devDays = timeline.devDays;
                startDate = timeline.startDate;
                launchDate = timeline.launchDate;
                devEndDate = timeline.devEndDate;
                qaStartDate = timeline.qaStartDate;
                qaEndDate = timeline.qaEndDate;
                warning = timeline.warning;
            }
        }

        // 기존 warning 과 자동 할당 warnings 병합
        if (warning != null) {
            warnings.add(0, warning);
        }

        // QA 중복 경고 감지
        List<String> qaConflicts = detectQaConflict(qaAssigneeNames, qaStartDate, qaEndDate, qaAssigneeBusyPeriods);
        warnings.addAll(qaConflicts);

        // QA 담당자 바쁜 기간 누적 (다음 프로젝트 중복 감지용)
        if (!qaAssigneeNames.isEmpty() && qaStartDate != null && qaEndDate != null) {
            for (String qaName : qaAssigneeNames) {
                qaAssigneeBusyPeriods.computeIfAbsent(qaName, k -> new ArrayList<>())
                        .add(new Object[]{qaStartDate, qaEndDate, project.getName()});
            }
        }

        // ===== 결과 조립 =====
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projectId", projectId);
        result.put("projectName", project.getName());
        result.put("fixedSchedule", fixedSchedule);
        result.put("autoStartDate", !fixedSchedule && project.getStartDate() == null);
        result.put("autoLaunchDate", !fixedSchedule && project.getEndDate() == null);
        result.put("startDate", startDate.toString());
        result.put("devEndDate", devEndDate != null ? devEndDate.toString() : null);
        result.put("qaStartDate", qaStartDate != null ? qaStartDate.toString() : null);
        result.put("qaEndDate", qaEndDate != null ? qaEndDate.toString() : null);
        result.put("launchDate", launchDate != null ? launchDate.toString() : null);
        result.put("totalMd", totalMd);
        result.put("beCount", beMembers.size());
        result.put("beCapacity", beCapacity);
        result.put("devDays", devDays);
        result.put("qaCount", qaAssigneeNames.size());
        result.put("qaDays", qaDays);
        result.put("taskCount", activeTasks.size());
        result.put("warning", warnings.isEmpty() ? null : String.join(" / ", warnings));
        result.put("beMembers", beMembers.stream().map(m -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", m.getName());
            item.put("capacity", m.getCapacity());
            if (lateJoinDates.containsKey(m.getId())) {
                item.put("availableFrom", lateJoinDates.get(m.getId()).toString());
            }
            return item;
        }).collect(Collectors.toList()));
        if (!busyMembers.isEmpty()) {
            result.put("busyMembers", busyMembers.stream().map(m -> Map.of("name", m.getName(), "capacity", m.getCapacity())).collect(Collectors.toList()));
        }
        if (!autoAssignedMembers.isEmpty()) {
            result.put("autoAssignedMembers", autoAssignedMembers.stream()
                    .map(m -> Map.of("id", m.getId(), "name", m.getName(), "capacity", m.getCapacity()))
                    .collect(Collectors.toList()));
        }
        result.put("qaMembers", qaAssigneeNames.stream().map(name -> Map.of("name", name)).collect(Collectors.toList()));

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
        LocalDate today = LocalDate.now();
        if (project.getStartDate() != null) {
            // 과거 날짜는 today로 보정 (실제 계산에서도 today 이전 시작일은 today로 보정됨)
            return project.getStartDate().isBefore(today) ? today : project.getStartDate();
        }
        return today;
    }

    /**
     * 멤버가 프로젝트 개발기간 전체에 걸쳐 바쁜지 판단 (투입불가 여부)
     * - 바쁜 기간이 projEstimatedEnd 이후까지 이어지면 → 투입불가 (true)
     * - 바쁜 기간이 projEstimatedEnd 이전에 끝나면 → 지연 합류 가용 (false)
     */
    private boolean isMemberBusy(Long memberId, LocalDate projStart, LocalDate projEstimatedEnd,
                                   Map<Long, List<LocalDate[]>> memberBusyPeriods) {
        List<LocalDate[]> periods = memberBusyPeriods.get(memberId);
        if (periods == null || periods.isEmpty()) return false;
        for (LocalDate[] period : periods) {
            // 기간 겹침: projStart <= period[1](inclusive) AND projEstimatedEnd >= period[0](inclusive)
            boolean overlaps = !projStart.isAfter(period[1]) && !projEstimatedEnd.isBefore(period[0]);
            if (overlaps && !period[1].isBefore(projEstimatedEnd)) {
                // 바쁜 기간이 프로젝트 예상 종료일 이후까지 이어짐 → 투입불가
                return true;
            }
        }
        return false;
    }

    /**
     * 멤버의 지연 합류 가용 개시일 계산
     * - 바쁜 기간 중 프로젝트와 겹치는 기간들의 종료일 최대값을 반환
     * - 바쁜 기간이 없거나 projStart 이전에 모두 끝나면 null (즉시 가용)
     */
    private LocalDate getMemberAvailableFrom(Long memberId, LocalDate projStart, LocalDate projEstimatedEnd,
                                               Map<Long, List<LocalDate[]>> memberBusyPeriods,
                                               Set<LocalDate> holidays) {
        List<LocalDate[]> periods = memberBusyPeriods.get(memberId);
        if (periods == null || periods.isEmpty()) return null;
        LocalDate latestEnd = null;
        for (LocalDate[] period : periods) {
            // 기간 겹침: projStart <= period[1](inclusive) AND projEstimatedEnd >= period[0](inclusive)
            boolean overlaps = !projStart.isAfter(period[1]) && !projEstimatedEnd.isBefore(period[0]);
            if (overlaps) {
                if (latestEnd == null || period[1].isAfter(latestEnd)) {
                    latestEnd = period[1];
                }
            }
        }
        // 겹치는 바쁜 기간이 없으면 즉시 가용
        if (latestEnd == null) {
            return null;
        }
        // 론치일(inclusive end)의 다음 영업일이 실제 가용 시작일
        return bizDayCalc.getNextBusinessDay(latestEnd, holidays);
    }

    /**
     * 가용 멤버 필터링: 바쁜 기간이 프로젝트 전체를 커버하지 않는 멤버
     */
    private List<Member> filterAvailableMembers(List<Member> pool, LocalDate projStart, LocalDate projEstimatedEnd,
                                                  Map<Long, List<LocalDate[]>> memberBusyPeriods) {
        List<Member> available = new ArrayList<>();
        for (Member m : pool) {
            if (!isMemberBusy(m.getId(), projStart, projEstimatedEnd, memberBusyPeriods)) {
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

    private static class TimelineComputation {
        final int devDays;
        final LocalDate startDate;
        final LocalDate launchDate;
        final LocalDate devEndDate;
        final LocalDate qaStartDate;
        final LocalDate qaEndDate;
        final String warning;

        private TimelineComputation(int devDays, LocalDate startDate, LocalDate launchDate,
                                    LocalDate devEndDate, LocalDate qaStartDate, LocalDate qaEndDate,
                                    String warning) {
            this.devDays = devDays;
            this.startDate = startDate;
            this.launchDate = launchDate;
            this.devEndDate = devEndDate;
            this.qaStartDate = qaStartDate;
            this.qaEndDate = qaEndDate;
            this.warning = warning;
        }
    }

    private TimelineComputation computeTimeline(Project project, Long projectId,
                                                BigDecimal totalMd, List<Member> beMembers, BigDecimal beCapacity,
                                                Integer qaDays, LocalDate qaFixedStartDate,
                                                Set<LocalDate> holidays, Set<LocalDate> beUnavailable, Set<LocalDate> qaUnavailable,
                                                LocalDate rangeStart, LocalDate rangeEnd,
                                                Map<Long, List<LocalDate[]>> memberBusyPeriods) {
        Map<Member, Set<LocalDate>> beMemberLeaves = new HashMap<>();
        for (Member m : beMembers) {
            beMemberLeaves.put(m, memberLeaveService.getMemberLeaveDatesBetween(m.getId(), rangeStart, rangeEnd));
        }

        int devDays = 0;
        if (totalMd.compareTo(BigDecimal.ZERO) > 0 && beCapacity.compareTo(BigDecimal.ZERO) > 0) {
            devDays = calculateDevDaysWithLeaves(totalMd, beCapacity, beMembers, beMemberLeaves, beUnavailable, project, null);
        }

        LocalDate today = LocalDate.now();
        LocalDate startDate;
        LocalDate launchDate;
        LocalDate devEndDate;
        LocalDate qaStartDate = null;
        LocalDate qaEndDate = null;
        String warning = null;
        boolean fixedSchedule = (project.getStartDate() != null && project.getEndDate() != null);

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
                LocalDate[] qaRange = calculateQaRangeFromLaunchDate(launchDate, qaDays, qaFixedStartDate, qaUnavailable);
                qaStartDate = qaRange[0];
                qaEndDate = qaRange[1];
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
                // 각 멤버의 실제 가용 시작일 계산 (queueStartDate + 바쁜 기간 모두 고려)
                // 멤버별 가용일 = max(queueStartDate, busyPeriod 종료 후 다음 영업일)
                // 프로젝트 시작일 = 가장 빨리 가용한 멤버 기준 (min)
                LocalDate earliestAvailable = beMembers.stream()
                        .map(m -> {
                            // 바쁜 기간 기반 가용일
                            List<LocalDate[]> periods = memberBusyPeriods.get(m.getId());
                            LocalDate busyAvailable;
                            if (periods == null || periods.isEmpty()) {
                                busyAvailable = LocalDate.now();
                            } else {
                                LocalDate latestBusyEnd = periods.stream()
                                        .map(period -> period[1])
                                        .max(LocalDate::compareTo)
                                        .orElse(null);
                                busyAvailable = latestBusyEnd != null
                                        ? bizDayCalc.getNextBusinessDay(latestBusyEnd, holidays)
                                        : LocalDate.now();
                            }
                            // queueStartDate가 있으면 그보다 이전에는 투입 불가
                            LocalDate queueStart = m.getQueueStartDate();
                            if (queueStart != null && queueStart.isAfter(busyAvailable)) {
                                return queueStart;
                            }
                            return busyAvailable;
                        })
                        .min(LocalDate::compareTo)
                        .orElse(null);

                // 0 MD 등으로 beMembers 자체가 비어 있으면 기존처럼 스쿼드 풀 기준으로 fallback
                if (earliestAvailable == null && beMembers.isEmpty()) {
                    List<Member> poolForStart = getSquadMemberPool(projectId);
                    LocalDate latestBusyEnd = poolForStart.stream()
                            .map(Member::getId)
                            .filter(memberBusyPeriods::containsKey)
                            .flatMap(mid -> memberBusyPeriods.get(mid).stream())
                            .map(period -> period[1])
                            .max(LocalDate::compareTo)
                            .orElse(null);
                    earliestAvailable = latestBusyEnd != null
                            ? bizDayCalc.getNextBusinessDay(latestBusyEnd, holidays)
                            : null;
                }
                startDate = earliestAvailable != null
                        ? earliestAvailable
                        : LocalDate.now();
                startDate = bizDayCalc.ensureBusinessDay(startDate, holidays);  // 비가용일 보정
            }

            LocalDate calcBaseDate = startDate.isBefore(today) ? today : startDate;
            LocalDate devCalcStart = bizDayCalc.ensureBusinessDay(calcBaseDate, beUnavailable);
            devEndDate = devCalcStart;

            if (devDays > 0) {
                devEndDate = bizDayCalc.calculateEndDate(devCalcStart, new BigDecimal(devDays), BigDecimal.ONE, beUnavailable);
            }

            if (qaDays != null && qaDays > 0) {
                if (project.getEndDate() != null) {
                    // endDate 지정: 론치일에서 역산 (fixedSchedule과 동일한 방식)
                    LocalDate[] qaRange = calculateQaRangeFromLaunchDate(project.getEndDate(), qaDays, qaFixedStartDate, qaUnavailable);
                    qaStartDate = qaRange[0];
                    qaEndDate = qaRange[1];
                } else {
                    // endDate 미지정: 기존 순방향 계산
                    if (qaFixedStartDate != null) {
                        qaStartDate = bizDayCalc.ensureBusinessDay(qaFixedStartDate, qaUnavailable);
                    } else {
                        qaStartDate = bizDayCalc.getNextBusinessDay(devEndDate, qaUnavailable);
                    }
                    qaEndDate = bizDayCalc.calculateEndDate(qaStartDate, new BigDecimal(qaDays), BigDecimal.ONE, qaUnavailable);
                }
            }

            if (totalMd.compareTo(BigDecimal.ZERO) == 0 && project.getEndDate() == null) {
                launchDate = null;  // 기간 미지정 0 MD: 계산 불가
            } else if (project.getEndDate() != null) {
                launchDate = project.getEndDate();
            } else if (qaEndDate != null) {
                launchDate = bizDayCalc.getNextBusinessDay(qaEndDate, holidays);
            } else {
                launchDate = bizDayCalc.getNextBusinessDay(devEndDate, holidays);
            }
        }

        return new TimelineComputation(devDays, startDate, launchDate, devEndDate, qaStartDate, qaEndDate, warning);
    }

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

    /**
     * 론치일 기준으로 QA 시작일·종료일을 역산한다.
     * - qaEndDate: 론치일에서 영업일 1일 전
     * - qaStartDate: qaFixedStartDate가 있으면 그대로 사용, 없으면 qaEndDate에서 (qaDays-1) 영업일 역산
     * - qaFixedStartDate > qaEndDate 엣지 케이스: qaStartDate를 qaEndDate와 동일하게 보정 (역전 방지)
     *
     * @return [qaStartDate, qaEndDate]
     */
    private LocalDate[] calculateQaRangeFromLaunchDate(LocalDate launchDate, int qaDays,
                                                        LocalDate qaFixedStartDate, Set<LocalDate> qaUnavailable) {
        LocalDate qaEndDate = subtractBusinessDays(launchDate, 1, qaUnavailable);
        LocalDate qaStartDate;
        if (qaFixedStartDate != null) {
            qaStartDate = qaFixedStartDate;
            // qaFixedStartDate가 qaEndDate 이후이면 역전 방지
            if (qaStartDate.isAfter(qaEndDate)) {
                qaStartDate = qaEndDate;
            }
        } else {
            qaStartDate = subtractBusinessDays(qaEndDate, qaDays - 1, qaUnavailable);
        }
        return new LocalDate[]{qaStartDate, qaEndDate};
    }

    /**
     * qaAssignees 쉼표 구분 문자열을 파싱하여 이름 목록 반환
     * - 각 토큰이 숫자(멤버 ID)이면 memberIdToName에서 이름을 조회하여 반환
     * - 숫자가 아니면(레거시 데이터: 이름 직접 저장) 그대로 반환
     * - ID가 맵에 없으면(비활성/삭제된 멤버) ID 문자열을 그대로 반환 (fallback)
     * - null 또는 빈 문자열이면 빈 리스트 반환
     */
    private List<String> parseQaAssigneeNames(String qaAssignees, Map<Long, String> memberIdToName) {
        if (qaAssignees == null || qaAssignees.isBlank()) {
            return Collections.emptyList();
        }
        return Arrays.stream(qaAssignees.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(token -> {
                    try {
                        Long id = Long.parseLong(token);
                        return memberIdToName.getOrDefault(id, token);
                    } catch (NumberFormatException e) {
                        return token; // 이미 이름이면 그대로 반환 (레거시 데이터 호환)
                    }
                })
                .collect(Collectors.toList());
    }

    /**
     * QA 담당자 기간 겹침 감지 - 충돌 경고 메시지 목록 반환
     * @param qaNames 현재 프로젝트의 QA 담당자 이름 목록
     * @param thisQaStart 현재 프로젝트의 QA 시작일
     * @param thisQaEnd 현재 프로젝트의 QA 종료일
     * @param qaAssigneeBusyPeriods 기존 QA 담당자 바쁜 기간 Map (key: 이름, value: Object[]{start, end, projectName} 리스트)
     * @return 충돌 경고 메시지 목록
     */
    private List<String> detectQaConflict(List<String> qaNames,
                                           LocalDate thisQaStart, LocalDate thisQaEnd,
                                           Map<String, List<Object[]>> qaAssigneeBusyPeriods) {
        if (qaNames.isEmpty() || thisQaStart == null || thisQaEnd == null) {
            return Collections.emptyList();
        }
        List<String> conflicts = new ArrayList<>();
        for (String name : qaNames) {
            List<Object[]> periods = qaAssigneeBusyPeriods.get(name);
            if (periods == null) continue;
            for (Object[] period : periods) {
                LocalDate pStart = (LocalDate) period[0];
                LocalDate pEnd = (LocalDate) period[1];
                String pProjectName = (String) period[2];
                if (pStart == null || pEnd == null) continue;
                // 기간 겹침 판단: thisQaStart <= pEnd && thisQaEnd >= pStart
                if (!thisQaStart.isAfter(pEnd) && !thisQaEnd.isBefore(pStart)) {
                    conflicts.add("QA 중복: '" + name + "'이(가) '" + pProjectName
                            + "'의 QA 기간(" + pStart + "~" + pEnd + ")과 겹칩니다.");
                }
            }
        }
        return conflicts;
    }
}
