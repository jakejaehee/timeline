package com.timeline.service;

import com.timeline.dto.JiraDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Jira Cloud REST API 호출 클라이언트
 * - Basic Auth (email:apiToken)
 * - Board 이슈 전체 수집 (페이지네이션)
 * - Search API 폴백 (Board API가 JQL 미지원 시)
 * - ADF description -> plain text 변환
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class JiraApiClient {

    private final RestTemplate jiraRestTemplate;

    /** Story Points 디버깅: 최초 이슈 파싱 시 fields 키 목록을 INFO 로그로 1회 출력 */
    private static volatile boolean storyPointsFieldsLogged = false;

    private static final int MAX_RESULTS = 50;
    /** 안전장치: 최대 수집 가능 이슈 수 (무한 루프 방지) */
    private static final int MAX_TOTAL_ISSUES = 10000;

    private static final String BOARD_FIELDS = "summary,status,assignee,customfield_10016,customfield_10015,customfield_10028,customfield_10004,customfield_10025,dueDate,description,resolutiondate,issuelinks";

    /** customfield ID 형식 검증 패턴 (예: customfield_12345) */
    private static final java.util.regex.Pattern CUSTOMFIELD_ID_PATTERN =
            java.util.regex.Pattern.compile("^customfield_\\d+$");

    /** BOARD_FIELDS에 포함된 필드 ID Set (부분 문자열 매칭 방지용) */
    private static final Set<String> BOARD_FIELDS_SET;
    static {
        BOARD_FIELDS_SET = Set.of(BOARD_FIELDS.split(","));
    }

    /** Jira statusCategory 허용 목록 (JQL injection 방지) - statusCategory 기반 필터링 */
    private static final Set<String> ALLOWED_STATUS_VALUES = Set.of(
            "To Do", "In Progress", "Done"
    );

    /** statusCategory JQL 값 → statusCategory.key 매핑 (클라이언트 사이드 재필터링용) */
    private static final Map<String, String> STATUS_CATEGORY_KEY_MAP = Map.of(
            "To Do", "new",
            "In Progress", "indeterminate",
            "Done", "done"
    );

    /**
     * Story Points 필드 ID 동적 탐지
     * GET {baseUrl}/rest/api/3/field 를 호출하여 Story Points 필드의 customfield ID를 반환한다.
     *
     * 탐지 순서:
     * 1) name이 "Story Points", "Story point estimate", "Story Points Estimate", "스토리 포인트" 중 정확 일치
     * 2) schema.custom이 float 타입이면서 name에 "story" 또는 "point" 포함
     * 3) null 반환 (기존 하드코딩 후보로 폴백)
     *
     * @return 탐지된 필드 ID (nullable). 예외 발생 시에도 null 반환 (예외 전파 금지).
     */
    @SuppressWarnings("unchecked")
    public String findStoryPointsFieldId(String baseUrl, String email, String apiToken) {
        try {
            URI uri = UriComponentsBuilder.fromHttpUrl(baseUrl + "/rest/api/3/field")
                    .build().encode().toUri();
            HttpHeaders headers = createAuthHeaders(email, apiToken);
            HttpEntity<Void> entity = new HttpEntity<>(headers);

            ResponseEntity<List> response = jiraRestTemplate.exchange(uri, HttpMethod.GET, entity, List.class);
            List<Map<String, Object>> fields = response.getBody();
            if (fields == null || fields.isEmpty()) {
                log.info("[Jira] Story Points 필드 ID 동적 탐지 실패. 기존 후보 목록으로 폴백.");
                return null;
            }

            // 1차 탐지: name 정확 일치 (대소문자 무시)
            Set<String> exactNames = Set.of(
                    "story points", "story point estimate", "story points estimate", "스토리 포인트"
            );
            for (Map<String, Object> field : fields) {
                String name = (String) field.get("name");
                if (name != null && exactNames.contains(name.toLowerCase())) {
                    String fieldId = (String) field.get("id");
                    if (fieldId != null && CUSTOMFIELD_ID_PATTERN.matcher(fieldId).matches()) {
                        log.info("[Jira] Story Points 필드 ID 동적 탐지 성공: {}", fieldId);
                        return fieldId;
                    }
                    log.warn("[Jira] Story Points 필드 ID 형식 불일치 (무시): {}", fieldId);
                }
            }

            // 2차 탐지: schema.custom이 float 타입 && name에 "story" 또는 "point" 포함
            for (Map<String, Object> field : fields) {
                Map<String, Object> schema = (Map<String, Object>) field.get("schema");
                if (schema == null) continue;
                Object customType = schema.get("custom");
                if (customType == null) continue;
                if ("com.atlassian.jira.plugin.system.customfieldtypes:float".equals(customType.toString())) {
                    String name = (String) field.get("name");
                    if (name != null) {
                        String nameLower = name.toLowerCase();
                        if (nameLower.contains("story") || nameLower.contains("point")) {
                            String fieldId = (String) field.get("id");
                            if (fieldId != null && CUSTOMFIELD_ID_PATTERN.matcher(fieldId).matches()) {
                                log.info("[Jira] Story Points 필드 ID 동적 탐지 성공: {}", fieldId);
                                return fieldId;
                            }
                            log.warn("[Jira] Story Points 필드 ID 형식 불일치 (무시): {}", fieldId);
                        }
                    }
                }
            }

            log.info("[Jira] Story Points 필드 ID 동적 탐지 실패. 기존 후보 목록으로 폴백.");
            return null;
        } catch (Exception e) {
            log.warn("[Jira] /rest/api/3/field 호출 실패: {}. 기존 후보 목록으로 폴백.", e.getMessage());
            return null;
        }
    }

    /**
     * 연결 테스트: GET {baseUrl}/rest/api/3/myself
     */
    public JiraDto.JiraUserInfo testConnection(String baseUrl, String email, String apiToken) {
        URI uri = UriComponentsBuilder.fromHttpUrl(baseUrl + "/rest/api/3/myself")
                .build().encode().toUri();
        HttpHeaders headers = createAuthHeaders(email, apiToken);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<Map> response = jiraRestTemplate.exchange(uri, HttpMethod.GET, entity, Map.class);
            Map<String, Object> body = response.getBody();
            if (body == null) {
                throw new RuntimeException("Jira API 응답이 비어있습니다.");
            }
            return JiraDto.JiraUserInfo.builder()
                    .displayName((String) body.get("displayName"))
                    .emailAddress((String) body.get("emailAddress"))
                    .build();
        } catch (HttpClientErrorException.Unauthorized e) {
            throw new RuntimeException("Jira 인증 실패: 이메일 또는 API Token이 올바르지 않습니다.");
        } catch (HttpClientErrorException.Forbidden e) {
            throw new RuntimeException("Jira 접근 권한이 없습니다.");
        } catch (HttpClientErrorException e) {
            log.warn("Jira API 오류: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
            throw new RuntimeException("Jira API 오류: " + e.getStatusCode());
        } catch (Exception e) {
            if (e instanceof RuntimeException) throw (RuntimeException) e;
            log.warn("Jira 연결 실패", e);
            throw new RuntimeException("Jira 연결 실패. 네트워크 상태를 확인해주세요.");
        }
    }

    /**
     * Board 이슈 전체 목록 수집 (페이지네이션)
     * API: GET {baseUrl}/rest/agile/1.0/board/{boardId}/issue
     * createdAfter가 null이 아니면 JQL 필터 적용.
     * Board API가 JQL을 지원하지 않으면 (400 BadRequest) Search API로 폴백.
     */
    public List<JiraDto.JiraIssue> fetchAllBoardIssues(String baseUrl, String email, String apiToken,
                                                        String boardId, LocalDate createdAfter,
                                                        List<String> statusFilter,
                                                        String storyPointsFieldId) {
        // boardId 검증: 숫자만 허용 (path injection 방지)
        if (boardId == null || !boardId.matches("^\\d+$")) {
            throw new IllegalArgumentException("Jira Board ID는 숫자만 허용됩니다: " + boardId);
        }

        HttpHeaders headers = createAuthHeaders(email, apiToken);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        // JQL 조건 생성
        String jql = buildJql(createdAfter, statusFilter);

        // 동적 fields 구성: 탐지된 storyPointsFieldId를 BOARD_FIELDS에 추가
        String fields = BOARD_FIELDS;
        if (storyPointsFieldId != null && !storyPointsFieldId.isBlank()
                && !BOARD_FIELDS_SET.contains(storyPointsFieldId)) {
            fields = fields + "," + storyPointsFieldId;
        }

        List<JiraDto.JiraIssue> allIssues = new ArrayList<>();
        int startAt = 0;
        int total = Integer.MAX_VALUE;

        while (startAt < total && allIssues.size() < MAX_TOTAL_ISSUES) {
            UriComponentsBuilder builder = UriComponentsBuilder
                    .fromHttpUrl(baseUrl + "/rest/agile/1.0/board/" + boardId + "/issue")
                    .queryParam("maxResults", MAX_RESULTS)
                    .queryParam("startAt", startAt)
                    .queryParam("fields", fields);

            if (jql != null) {
                builder.queryParam("jql", jql);
            }

            URI uri = builder.build().encode().toUri();

            try {
                ResponseEntity<Map> response = jiraRestTemplate.exchange(uri, HttpMethod.GET, entity, Map.class);
                Map<String, Object> body = response.getBody();
                if (body == null) break;

                total = toInt(body.get("total"), 0);
                List<Map<String, Object>> issues = (List<Map<String, Object>>) body.get("issues");
                if (issues == null || issues.isEmpty()) break;

                for (Map<String, Object> issue : issues) {
                    allIssues.add(parseIssue(issue, storyPointsFieldId));
                }

                startAt += issues.size();
                log.debug("Jira 이슈 수집 중: startAt={}, total={}, fetched={}", startAt, total, allIssues.size());

            } catch (HttpClientErrorException.BadRequest e) {
                // Board API가 JQL을 지원하지 않는 경우 Search API로 폴백
                log.warn("Board API가 JQL을 지원하지 않습니다. Search API로 폴백합니다. boardId={}", boardId);
                return fetchIssuesByJql(baseUrl, email, apiToken, boardId, createdAfter, statusFilter, storyPointsFieldId);
            } catch (HttpClientErrorException.NotFound e) {
                throw new RuntimeException("Jira Board를 찾을 수 없습니다. Board ID: " + boardId);
            } catch (HttpClientErrorException.Unauthorized e) {
                throw new RuntimeException("Jira 인증 실패: 이메일 또는 API Token이 올바르지 않습니다.");
            } catch (HttpClientErrorException e) {
                log.warn("Jira API 오류: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
                throw new RuntimeException("Jira API 오류: " + e.getStatusCode());
            } catch (Exception e) {
                if (e instanceof RuntimeException) throw (RuntimeException) e;
                log.warn("Jira 이슈 수집 실패", e);
                throw new RuntimeException("Jira 이슈 수집 실패. 네트워크 상태를 확인해주세요.");
            }
        }

        // Board API 응답 후 클라이언트 사이드 statusCategory 재필터링 (방어적 처리)
        // Board API가 JQL statusCategory 필터를 무시하고 전체 이슈를 반환하는 경우를 대비하여
        // statusCategoryKey 기반으로 필터링 (언어 무관)
        if (statusFilter != null && !statusFilter.isEmpty()) {
            Set<String> categoryKeyFilter = statusFilter.stream()
                    .filter(s -> s != null && !s.isBlank())
                    .map(s -> STATUS_CATEGORY_KEY_MAP.getOrDefault(s, s.toLowerCase()))
                    .collect(Collectors.toSet());
            if (!categoryKeyFilter.isEmpty()) {
                allIssues = allIssues.stream()
                        .filter(issue -> issue.getStatusCategoryKey() != null
                                && categoryKeyFilter.contains(issue.getStatusCategoryKey()))
                        .collect(Collectors.toList());
                log.info("클라이언트 사이드 statusCategory 재필터링 적용: filter={} → {}건", statusFilter, allIssues.size());
            }
        }

        log.info("Jira Board {} 이슈 수집 완료: {}건", boardId, allIssues.size());
        return allIssues;
    }

    /**
     * Search API 폴백: /rest/api/3/search 엔드포인트 사용
     * Board 메타데이터에서 프로젝트 키를 조회하여 JQL에 포함
     */
    @SuppressWarnings("unchecked")
    public List<JiraDto.JiraIssue> fetchIssuesByJql(String baseUrl, String email, String apiToken,
                                                     String boardId, LocalDate createdAfter,
                                                     List<String> statusFilter,
                                                     String storyPointsFieldId) {
        // boardId 검증: 숫자만 허용 (path injection 방지)
        if (boardId == null || !boardId.matches("^\\d+$")) {
            throw new IllegalArgumentException("Jira Board ID는 숫자만 허용됩니다: " + boardId);
        }

        HttpHeaders headers = createAuthHeaders(email, apiToken);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        // Board 메타데이터에서 프로젝트 키 조회
        String projectKey = fetchBoardProjectKey(baseUrl, email, apiToken, boardId);

        // JQL 조건 구성 (projectKey 안전성 검증: 영숫자, 하이픈, 언더스코어만 허용)
        if (!projectKey.matches("^[A-Za-z0-9_\\-]+$")) {
            throw new RuntimeException("Board의 프로젝트 키가 올바르지 않습니다: " + projectKey);
        }
        StringBuilder jqlBuilder = new StringBuilder();
        jqlBuilder.append("project=\"").append(projectKey).append("\"");
        // createdAfter + statusFilter 조건 추가
        String additionalJql = buildJql(createdAfter, statusFilter);
        if (additionalJql != null) {
            jqlBuilder.append(" AND ").append(additionalJql);
        }
        jqlBuilder.append(" ORDER BY created ASC");
        String jql = jqlBuilder.toString();

        log.info("Search API 폴백 JQL: {}", jql);

        // 동적 fields 구성: 탐지된 storyPointsFieldId를 BOARD_FIELDS에 추가
        String fields = BOARD_FIELDS;
        if (storyPointsFieldId != null && !storyPointsFieldId.isBlank()
                && !BOARD_FIELDS_SET.contains(storyPointsFieldId)) {
            fields = fields + "," + storyPointsFieldId;
        }

        List<JiraDto.JiraIssue> allIssues = new ArrayList<>();
        int startAt = 0;
        int total = Integer.MAX_VALUE;

        while (startAt < total && allIssues.size() < MAX_TOTAL_ISSUES) {
            URI uri = UriComponentsBuilder
                    .fromHttpUrl(baseUrl + "/rest/api/3/search")
                    .queryParam("jql", jql)
                    .queryParam("maxResults", MAX_RESULTS)
                    .queryParam("startAt", startAt)
                    .queryParam("fields", fields)
                    .build().encode().toUri();

            try {
                ResponseEntity<Map> response = jiraRestTemplate.exchange(uri, HttpMethod.GET, entity, Map.class);
                Map<String, Object> body = response.getBody();
                if (body == null) break;

                total = toInt(body.get("total"), 0);
                List<Map<String, Object>> issues = (List<Map<String, Object>>) body.get("issues");
                if (issues == null || issues.isEmpty()) break;

                for (Map<String, Object> issue : issues) {
                    allIssues.add(parseIssue(issue, storyPointsFieldId));
                }

                startAt += issues.size();
                log.debug("Search API 이슈 수집 중: startAt={}, total={}, fetched={}", startAt, total, allIssues.size());

            } catch (HttpClientErrorException.Unauthorized e) {
                throw new RuntimeException("Jira 인증 실패: 이메일 또는 API Token이 올바르지 않습니다.");
            } catch (HttpClientErrorException e) {
                log.warn("Jira Search API 오류: {} - {}", e.getStatusCode(), e.getResponseBodyAsString());
                throw new RuntimeException("Jira Search API 오류: " + e.getStatusCode());
            } catch (Exception e) {
                if (e instanceof RuntimeException) throw (RuntimeException) e;
                log.warn("Jira Search API 이슈 수집 실패", e);
                throw new RuntimeException("Jira 이슈 수집 실패. 네트워크 상태를 확인해주세요.");
            }
        }

        // Search API 응답 후에도 클라이언트 사이드 statusCategory 재필터링 (방어적 처리)
        if (statusFilter != null && !statusFilter.isEmpty()) {
            Set<String> categoryKeyFilter = statusFilter.stream()
                    .filter(s -> s != null && !s.isBlank())
                    .map(s -> STATUS_CATEGORY_KEY_MAP.getOrDefault(s, s.toLowerCase()))
                    .collect(Collectors.toSet());
            if (!categoryKeyFilter.isEmpty()) {
                allIssues = allIssues.stream()
                        .filter(issue -> issue.getStatusCategoryKey() != null
                                && categoryKeyFilter.contains(issue.getStatusCategoryKey()))
                        .collect(Collectors.toList());
                log.info("Search API 클라이언트 사이드 statusCategory 재필터링 적용: filter={} → {}건", statusFilter, allIssues.size());
            }
        }

        log.info("Jira Search API 이슈 수집 완료: {}건 (project={})", allIssues.size(), projectKey);
        return allIssues;
    }

    /**
     * JQL 조건 문자열 생성 (createdAfter + statusFilter)
     * allowlist 기반으로 statusFilter 값을 검증하여 JQL injection을 방지한다.
     *
     * @return JQL 조건 문자열, 조건이 없으면 null
     */
    private String buildJql(LocalDate createdAfter, List<String> statusFilter) {
        List<String> conditions = new ArrayList<>();
        if (createdAfter != null) {
            conditions.add("created>=\"" + createdAfter.format(DateTimeFormatter.ISO_LOCAL_DATE) + "\"");
        }
        if (statusFilter != null && !statusFilter.isEmpty()) {
            // allowlist 검증: 허용된 값만 사용
            List<String> safe = statusFilter.stream()
                    .filter(ALLOWED_STATUS_VALUES::contains)
                    .toList();
            if (!safe.isEmpty()) {
                String inClause = safe.stream()
                        .map(s -> "\"" + s + "\"")
                        .collect(Collectors.joining(","));
                conditions.add("statusCategory in (" + inClause + ")");
            }
        }
        String jql = conditions.isEmpty() ? null : String.join(" AND ", conditions);
        if (jql != null) {
            log.info("[Jira Debug] 생성된 JQL: {}", jql);
        }
        return jql;
    }

    /**
     * Board 메타데이터에서 프로젝트 키 조회
     * API: GET {baseUrl}/rest/agile/1.0/board/{boardId}
     */
    @SuppressWarnings("unchecked")
    private String fetchBoardProjectKey(String baseUrl, String email, String apiToken, String boardId) {
        URI uri = UriComponentsBuilder
                .fromHttpUrl(baseUrl + "/rest/agile/1.0/board/" + boardId)
                .build().encode().toUri();
        HttpHeaders headers = createAuthHeaders(email, apiToken);
        HttpEntity<Void> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<Map> response = jiraRestTemplate.exchange(uri, HttpMethod.GET, entity, Map.class);
            Map<String, Object> body = response.getBody();
            if (body != null) {
                // location.projectKey 또는 location.project.key
                Map<String, Object> location = (Map<String, Object>) body.get("location");
                if (location != null) {
                    String projectKey = (String) location.get("projectKey");
                    if (projectKey != null && !projectKey.isBlank()) {
                        return projectKey;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Board 메타데이터 조회 실패. boardId={}, error={}", boardId, e.getMessage());
        }

        // 폴백: Board ID를 그대로 프로젝트 키로 사용할 수 없으므로 예외 발생
        throw new RuntimeException("Board에서 프로젝트 키를 확인할 수 없습니다. Board ID: " + boardId);
    }

    /**
     * Jira API 응답의 단일 이슈를 JiraIssue로 파싱
     */
    @SuppressWarnings("unchecked")
    private JiraDto.JiraIssue parseIssue(Map<String, Object> issue, String storyPointsFieldId) {
        String key = (String) issue.get("key");
        Map<String, Object> fields = (Map<String, Object>) issue.get("fields");
        if (fields == null) {
            return JiraDto.JiraIssue.builder().key(key).build();
        }

        // summary
        String summary = (String) fields.get("summary");

        // status
        String statusName = null;
        String statusCategoryKey = null;
        Map<String, Object> statusObj = (Map<String, Object>) fields.get("status");
        if (statusObj != null) {
            statusName = (String) statusObj.get("name");
            // statusCategory.key 파싱 ("new", "indeterminate", "done")
            Map<String, Object> statusCategory = (Map<String, Object>) statusObj.get("statusCategory");
            if (statusCategory != null) {
                statusCategoryKey = (String) statusCategory.get("key");
            }
        }

        // assignee
        String assigneeDisplayName = null;
        String assigneeEmail = null;
        Map<String, Object> assigneeObj = (Map<String, Object>) fields.get("assignee");
        if (assigneeObj != null) {
            assigneeDisplayName = (String) assigneeObj.get("displayName");
            assigneeEmail = (String) assigneeObj.get("emailAddress");
        }

        // story points: 동적 탐지 필드 > 하드코딩 후보 순서로 시도
        BigDecimal storyPoints = extractStoryPoints(fields, storyPointsFieldId);

        // start date: customfield_10015
        LocalDate startDate = parseLocalDate(fields.get("customfield_10015"));

        // due date
        LocalDate dueDate = parseLocalDate(fields.get("dueDate"));

        // description (ADF -> plain text)
        String description = extractDescriptionText(fields.get("description"));

        // resolutiondate
        LocalDate resolutionDate = parseLocalDate(fields.get("resolutiondate"));

        // issuelinks 파싱
        List<JiraDto.JiraIssueLink> issueLinks = parseIssueLinks(fields.get("issuelinks"));

        return JiraDto.JiraIssue.builder()
                .key(key)
                .summary(truncate(summary, 300))
                .status(statusName)
                .statusCategoryKey(statusCategoryKey)
                .assigneeDisplayName(assigneeDisplayName)
                .assigneeEmail(assigneeEmail)
                .storyPoints(storyPoints)
                .startDate(startDate)
                .dueDate(dueDate)
                .description(description)
                .resolutionDate(resolutionDate)
                .issueLinks(issueLinks)
                .build();
    }

    /**
     * Jira issuelinks 필드 파싱
     * 각 link entry에는 outwardIssue 또는 inwardIssue 중 하나만 존재
     */
    @SuppressWarnings("unchecked")
    private List<JiraDto.JiraIssueLink> parseIssueLinks(Object issuelinksObj) {
        if (issuelinksObj == null) return List.of();
        if (!(issuelinksObj instanceof List)) return List.of();

        List<Map<String, Object>> links = (List<Map<String, Object>>) issuelinksObj;
        List<JiraDto.JiraIssueLink> result = new ArrayList<>();

        for (Map<String, Object> link : links) {
            try {
                Map<String, Object> typeObj = (Map<String, Object>) link.get("type");
                Map<String, Object> outwardIssue = (Map<String, Object>) link.get("outwardIssue");
                Map<String, Object> inwardIssue = (Map<String, Object>) link.get("inwardIssue");

                String linkType = null;
                String linkedKey = null;

                if (outwardIssue != null) {
                    linkType = typeObj != null ? (String) typeObj.get("outward") : null;
                    linkedKey = (String) outwardIssue.get("key");
                } else if (inwardIssue != null) {
                    linkType = typeObj != null ? (String) typeObj.get("inward") : null;
                    linkedKey = (String) inwardIssue.get("key");
                }

                if (linkedKey != null && !linkedKey.isBlank()) {
                    result.add(JiraDto.JiraIssueLink.builder()
                            .type(linkType)
                            .linkedKey(linkedKey)
                            .build());
                }
            } catch (Exception e) {
                log.debug("issuelink 파싱 중 오류 (skip): {}", e.getMessage());
            }
        }
        return result;
    }

    /**
     * Story Points 추출: 여러 후보 필드를 순서대로 시도
     * - Number 타입 (Double, Integer 등)
     * - Map 타입 ({"value": 5.0} 형태 - 일부 Jira 인스턴스)
     * - String 타입
     */
    /** Story Points 합리적 범위: 0 이상 10000 이하 */
    private static final BigDecimal STORY_POINTS_MAX = new BigDecimal("10000");

    @SuppressWarnings("unchecked")
    private BigDecimal extractStoryPoints(Map<String, Object> fields, String storyPointsFieldId) {
        if (!storyPointsFieldsLogged) {
            storyPointsFieldsLogged = true;
            // 모든 customfield 중 Number 타입인 것만 출력 (story points 탐지용)
            Map<String, Object> numberCustomFields = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : fields.entrySet()) {
                if (entry.getKey().startsWith("customfield_") && entry.getValue() instanceof Number) {
                    numberCustomFields.put(entry.getKey(), entry.getValue());
                }
            }
            log.info("[Jira Debug] 첫 번째 이슈의 Number 타입 customfield 목록 (story points 후보): {}", numberCustomFields);
            log.info("[Jira Debug] 첫 번째 이슈의 전체 fields 키 목록: {}", fields.keySet());
        }
        // 동적 탐지된 필드 ID를 기존 하드코딩 후보 앞에 우선 배치
        List<String> candidates = new ArrayList<>();
        if (storyPointsFieldId != null && !storyPointsFieldId.isBlank()) {
            candidates.add(storyPointsFieldId);
        }
        // 기존 하드코딩 후보 (중복 방지)
        for (String c : new String[]{"customfield_10016", "customfield_10028", "customfield_10004", "customfield_10025"}) {
            if (!candidates.contains(c)) candidates.add(c);
        }
        for (String field : candidates) {
            Object value = fields.get(field);
            if (value == null) continue;
            try {
                BigDecimal parsed = null;
                // 순수 숫자 (Double, Integer, etc.)
                if (value instanceof Number) {
                    parsed = new BigDecimal(value.toString());
                }
                // Map 형태: {"value": 5.0} - 일부 Jira 인스턴스
                else if (value instanceof Map) {
                    Object inner = ((Map<?, ?>) value).get("value");
                    if (inner != null) {
                        parsed = new BigDecimal(inner.toString());
                    }
                }
                // String 형태
                else {
                    String str = value.toString().trim();
                    if (!str.isEmpty() && !str.equals("null")) {
                        parsed = new BigDecimal(str);
                    }
                }
                // 범위 검증: 음수 또는 비합리적으로 큰 값은 story points가 아님
                if (parsed != null) {
                    if (parsed.compareTo(BigDecimal.ZERO) < 0 || parsed.compareTo(STORY_POINTS_MAX) > 0) {
                        log.debug("Story Points 범위 초과로 무시 (필드: {}, 값: {})", field, parsed);
                        continue;
                    }
                    return parsed;
                }
            } catch (NumberFormatException e) {
                log.debug("Story Points 파싱 실패 (필드: {}, 값: {}): {}", field, value, e.getMessage());
            }
        }
        log.debug("Story Points 추출 실패. 후보 필드 모두 null 또는 파싱 불가. fields 키 목록: {}", fields.keySet());
        return null;
    }

    /**
     * ADF(Atlassian Document Format) description -> plain text 변환
     * 재귀적으로 text 노드만 추출
     */
    @SuppressWarnings("unchecked")
    private String extractDescriptionText(Object descriptionObj) {
        if (descriptionObj == null) return null;

        // String인 경우 그대로 반환 (레거시 이슈)
        if (descriptionObj instanceof String) {
            return (String) descriptionObj;
        }

        // ADF JSON (Map 구조)
        if (descriptionObj instanceof Map) {
            Map<String, Object> adf = (Map<String, Object>) descriptionObj;
            StringBuilder sb = new StringBuilder();
            extractTextNodes(adf, sb);
            String result = sb.toString().trim();
            return result.isEmpty() ? null : result;
        }

        return null;
    }

    /**
     * ADF 노드에서 재귀적으로 text 추출
     */
    @SuppressWarnings("unchecked")
    private void extractTextNodes(Map<String, Object> node, StringBuilder sb) {
        if (node == null) return;

        String type = (String) node.get("type");
        if ("text".equals(type)) {
            Object text = node.get("text");
            if (text != null) {
                sb.append(text.toString());
            }
        }

        // hardBreak -> 줄바꿈
        if ("hardBreak".equals(type)) {
            sb.append("\n");
        }

        // paragraph 구분은 줄바꿈으로
        if ("paragraph".equals(type) && sb.length() > 0 && sb.charAt(sb.length() - 1) != '\n') {
            sb.append("\n");
        }

        // content 하위 노드 재귀 순회
        List<Map<String, Object>> content = (List<Map<String, Object>>) node.get("content");
        if (content != null) {
            for (Map<String, Object> child : content) {
                extractTextNodes(child, sb);
            }
        }
    }

    /**
     * Basic Auth 헤더 생성
     */
    private HttpHeaders createAuthHeaders(String email, String apiToken) {
        HttpHeaders headers = new HttpHeaders();
        String auth = email + ":" + apiToken;
        String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes(StandardCharsets.UTF_8));
        headers.set(HttpHeaders.AUTHORIZATION, "Basic " + encodedAuth);
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(List.of(MediaType.APPLICATION_JSON));
        return headers;
    }

    /**
     * 문자열 -> LocalDate 변환
     */
    private LocalDate parseLocalDate(Object value) {
        if (value == null) return null;
        String str = value.toString().trim();
        if (str.isEmpty()) return null;
        try {
            // "YYYY-MM-DD" 형식만 파싱 (T 이후 부분 제거)
            if (str.length() > 10) {
                str = str.substring(0, 10);
            }
            return LocalDate.parse(str);
        } catch (Exception e) {
            log.warn("Jira 날짜 파싱 실패: {}", value);
            return null;
        }
    }

    /**
     * 문자열 truncate
     */
    private String truncate(String s, int maxLen) {
        if (s == null) return null;
        return s.length() > maxLen ? s.substring(0, maxLen) : s;
    }

    /**
     * Object -> int 변환
     */
    private int toInt(Object value, int defaultValue) {
        if (value == null) return defaultValue;
        if (value instanceof Number) return ((Number) value).intValue();
        try {
            return Integer.parseInt(value.toString());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
