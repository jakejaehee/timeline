# Implementation Phases

## Phase 1: 기반 구조 (Entity, Repository, Enum)

### 파일 목록:
```
src/main/java/com/timeline/domain/enums/
  MemberRole.java           - ENGINEER, QA, PM
  ProjectType.java          - SKU_SYSTEM, BUSINESS, MUKIE
  ProjectStatus.java        - PLANNING, IN_PROGRESS, COMPLETED, ON_HOLD
  TaskStatus.java           - PENDING, IN_PROGRESS, COMPLETED

src/main/java/com/timeline/domain/entity/
  Member.java               - 팀원 엔티티
  DomainSystem.java         - 도메인 시스템 엔티티
  Project.java              - 프로젝트 엔티티
  ProjectMember.java        - 프로젝트-멤버 연결 엔티티
  ProjectDomainSystem.java  - 프로젝트-도메인시스템 연결 엔티티
  Task.java                 - 태스크 엔티티
  TaskDependency.java       - 태스크 의존관계 엔티티

src/main/java/com/timeline/domain/repository/
  MemberRepository.java
  DomainSystemRepository.java
  ProjectRepository.java
  ProjectMemberRepository.java
  ProjectDomainSystemRepository.java
  TaskRepository.java
  TaskDependencyRepository.java
```

## Phase 2: DTO, Service, Controller (CRUD)

### 파일 목록:
```
src/main/java/com/timeline/dto/
  MemberDto.java            - 멤버 요청/응답 DTO
  DomainSystemDto.java      - 도메인 시스템 요청/응답 DTO
  ProjectDto.java           - 프로젝트 요청/응답 DTO
  TaskDto.java              - 태스크 요청/응답 DTO
  GanttDataDto.java         - 간트차트 데이터 응답 DTO

src/main/java/com/timeline/service/
  MemberService.java
  DomainSystemService.java
  ProjectService.java
  TaskService.java

src/main/java/com/timeline/controller/
  MemberController.java
  DomainSystemController.java
  ProjectController.java
  TaskController.java
```

## Phase 3: AI 파싱 기능

### 파일 목록:
```
src/main/java/com/timeline/config/
  AnthropicConfig.java       - Anthropic 클라이언트 Bean 설정
  AnthropicProperties.java   - 설정 프로퍼티 클래스

src/main/java/com/timeline/dto/
  ParseRequestDto.java       - 파싱 요청 DTO
  ParsedTaskDto.java         - 파싱 결과 DTO

src/main/java/com/timeline/service/
  AiParsingService.java      - AI 파싱 서비스

src/main/java/com/timeline/controller/
  AiParsingController.java   - AI 파싱 API
```

### build.gradle 수정:
- Anthropic Java SDK 의존성 추가

### application.yml 수정:
- anthropic 설정 추가

### .env 수정:
- ANTHROPIC_API_KEY 추가

## Phase 4: Frontend (UI + 간트차트)

### 파일 수정/생성:
```
src/main/resources/static/
  index.html                 - 전체 레이아웃 재구성 (좌우 분할)
  js/app.js                  - 전체 UI 로직 구현
  css/styles.css             - 스타일 업데이트
```

### index.html CDN 추가:
- frappe-gantt JS/CSS

## 각 Phase 구현 시 원칙

1. **기존 컨벤션 준수**:
   - Lombok 사용 (@Data, @Builder, @RequiredArgsConstructor)
   - @CreatedDate/@LastModifiedDate 감사 필드
   - ResponseEntity<?> with Map.of() 응답
   - 프론트엔드 JS: 변수 선언은 `var` 사용 (ES6 let/const 미사용), 비동기 처리는 `async/await` 사용

2. **에러 처리**:
   - GlobalExceptionHandler에 필요한 예외 타입 추가
   - 담당자 충돌 시 명확한 에러 메시지

3. **성능**:
   - 간트차트 데이터 조회 시 JOIN FETCH 사용
   - N+1 문제 방지
