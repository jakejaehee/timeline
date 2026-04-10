# AI Integration Design

## 1. Anthropic Java SDK 통합

### 의존성 추가 (build.gradle)
```groovy
implementation 'com.anthropic:anthropic-java:1.+'
```

### 설정 (application.yml)
```yaml
anthropic:
  api-key: ${ANTHROPIC_API_KEY}
  model: claude-sonnet-4-5
  max-tokens: 4096
```

### 환경변수 (.env)
```
ANTHROPIC_API_KEY=sk-ant-...
```

## 2. AI Service 구조

### AnthropicConfig.java
```
@Configuration 클래스
- AnthropicClient Bean 생성
- API Key, Model 설정 주입
- 애플리케이션 시작 시 초기화 → 즉시 사용 가능
```

### AiParsingService.java
```
@Service 클래스
- parseTasksFromText(String freeText, Long projectId): ParsedTaskResult
  1. 프로젝트의 멤버 목록, 도메인 시스템 목록 조회
  2. 시스템 프롬프트 + 컨텍스트(멤버/시스템 목록) + 사용자 텍스트 구성
  3. Anthropic API 호출
  4. JSON 응답 파싱
  5. ParsedTaskResult 반환
```

## 3. 시스템 프롬프트

```
당신은 프로젝트 관리 태스크 파서입니다.
사용자가 자유 형식으로 입력한 텍스트에서 태스크 정보를 추출하세요.

## 현재 프로젝트 컨텍스트
- 프로젝트명: {projectName}
- 참여 멤버: {memberList - 이름(역할)}
- 도메인 시스템: {domainSystemList}

## 추출 규칙
1. 도메인 시스템: 텍스트에서 도메인 시스템명을 식별합니다
2. 태스크명: 작업 내용을 식별합니다
3. 담당자: 멤버 이름을 매칭합니다 (부분 일치 허용)
4. 공수(MD): 숫자 + "md" 또는 "일" 패턴을 식별합니다
5. 의존관계: "→", "후", "다음" 등의 키워드로 순서를 식별합니다

## 출력 형식 (반드시 JSON)
{
  "domainSystems": [
    {
      "name": "시스템명",
      "tasks": [
        {
          "name": "태스크명",
          "assigneeName": "담당자명",
          "assigneeMatched": true,
          "manDays": 5.0,
          "dependsOn": ["선행 태스크명"]
        }
      ]
    }
  ]
}

주의:
- 멤버 목록에 없는 담당자는 assigneeName에 입력값 그대로 넣고 assigneeMatched: false로 설정
- 멤버 목록에 있는 담당자는 assigneeMatched: true로 설정
- 공수가 명시되지 않은 태스크는 manDays: null로 설정
- 의존관계가 불명확하면 dependsOn을 빈 배열로 설정
```

## 4. 응답 처리 흐름

```
1. 사용자 입력 → AiParsingController.parseText()
2. AiParsingService.parseTasksFromText() 호출
3. Anthropic API 호출 (Claude 모델)
4. JSON 응답 수신 및 파싱
5. assigneeMatched: false인 항목을 미매칭 경고로 표시 (Claude가 1차 매칭한 결과를 활용)
6. 도메인 시스템명 → DomainSystem ID 매칭 (DB에서 exact match 후 미매칭 시 경고)
7. ParsedTaskResult 반환 (미리보기용, 미매칭 항목 포함)
8. 사용자 확인 후 saveParsedTasks() 호출
9. Task 엔티티 생성 및 저장
10. 의존관계 설정 (dependsOn 태스크명 → 저장된 Task ID로 변환)
11. 날짜 자동 계산 (공수 기반, 담당자 일정 고려)
```

## 5. 날짜 자동 계산 로직

free-text에는 시작일/종료일이 없을 수 있으므로 자동 계산:

```
1. 기준 시작일 결정:
   - 프로젝트 start_date가 설정된 경우: 해당 날짜를 기준 시작일로 사용
   - 프로젝트 start_date가 null인 경우: 오늘 날짜(파싱 요청일)를 기준 시작일로 사용
2. 각 태스크의 공수(MD)를 영업일 기준으로 종료일 계산
   (예: 시작일이 월요일, MD=5이면 종료일은 금요일)
3. 의존관계가 있는 태스크는 선행 태스크 종료일 다음 영업일부터 시작
4. 같은 담당자의 태스크가 겹치지 않도록 순차 배치
5. 주말(토/일) 제외 (공휴일은 미고려)
```
