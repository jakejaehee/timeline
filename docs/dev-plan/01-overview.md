# Timeline - Project Management & Gantt Chart Application

## 1. Overview

Backend Engineering Team Manager를 위한 프로젝트 관리 및 간트차트 애플리케이션.
16명의 엔지니어, 1명의 QA로 구성된 팀이 3개 도메인 시스템(scm-hub, scm-portal, pes)에서
동시에 여러 프로젝트(sku system, 사업과제, mukie)를 수행하는 환경을 관리한다.

## 2. 핵심 요구사항

### 2.1 프로젝트 관리
- 프로젝트 정의 (이름, 유형, 기간, 설명)
- 프로젝트 유형: SKU_SYSTEM, BUSINESS(사업과제), MUKIE(인턴 프로젝트)
- 프로젝트에 인력(멤버) 배정
- 프로젝트에 도메인 시스템 연결

### 2.2 멤버 관리
- 멤버 등록 (이름, 역할)
- 역할: ENGINEER, QA, PM(Product Manager)
- 한 멤버가 여러 프로젝트에 참여 가능
- 한 멤버가 한 프로젝트 내에서 여러 도메인 시스템 작업 가능

### 2.3 도메인 시스템 관리
- 도메인 시스템 등록 (이름, 설명)
- 기본 시스템: scm-hub, scm-portal, pes

### 2.4 태스크 관리
- 태스크는 프로젝트 + 도메인 시스템에 소속
- 태스크 속성: 이름, 시작일, 종료일, 공수(man-day), 상태, 담당자
- 태스크 간 의존관계 (선행 태스크 완료 후 후행 태스크 시작)
- **제약조건**: 한 담당자는 동시에 2개 이상 태스크 수행 불가

### 2.5 간트차트
- 프로젝트별 간트차트 시각화
- 도메인 시스템별 그룹핑
- 담당자, 공수(MD), QA 일정 한눈에 확인
- 태스크 의존관계 화살표 표시

### 2.6 AI 기반 Free-text 파싱
- 자유 형식 텍스트 입력 시 AI가 자동으로 태스크/담당자/공수 추출
- Anthropic API(Claude) 직접 호출 (Claude Code CLI 대신 SDK 사용)
- 애플리케이션 시작 시 API 클라이언트 초기화, 즉시 응답 가능

### 2.7 외부 서비스 연동 (MCP)
- Jira: 이슈 조회/생성, 상태 동기화
- Confluence: 문서 조회/생성
- GitHub: PR/이슈 조회
- Slack: 메시지 전송, 알림

## 3. 기술 스택

| 구분 | 기술 | 비고 |
|------|------|------|
| Backend | Spring Boot 3.5, Java 17 | 기존 설정 유지 |
| Database | PostgreSQL 16 | 기존 설정 유지, 관계형 데이터에 적합 |
| ORM | Hibernate (ddl-auto: update) | 기존 방식 유지 |
| AI | Anthropic Java SDK | Claude API 직접 호출 |
| Frontend | Vanilla JS + Bootstrap 5.3 | 기존 방식 유지 |
| Gantt Chart | frappe-gantt (CDN) | 경량 오픈소스 간트차트 라이브러리 |
| Cache | Caffeine | 기존 설정 유지 |

## 4. AI 통합 방식 결정

사용자가 제안한 "Claude Code CLI를 내부적으로 구동"하는 방식 대신 **Anthropic Java SDK를 통한 직접 API 호출** 방식을 채택한다.

### 이유:
1. **성능**: CLI 프로세스 관리 오버헤드 없이 직접 HTTP 호출
2. **안정성**: 프로세스 관리(시작/종료/재시작) 복잡성 제거
3. **제어력**: 프롬프트, 모델, 파라미터를 코드 레벨에서 정밀 제어
4. **비용**: 필요한 만큼만 API 호출, 불필요한 리소스 소비 없음

### 동작 방식:
1. 사용자가 free-text 입력
2. Backend에서 Anthropic API 호출 (시스템 프롬프트 + 사용자 텍스트)
3. Claude가 구조화된 JSON으로 태스크 목록 반환
4. JSON 파싱 후 Task 테이블에 저장
5. 간트차트 자동 갱신

## 5. 데이터베이스 선정: PostgreSQL 유지

이미 설정된 PostgreSQL 16을 그대로 사용한다.

### 적합한 이유:
- 프로젝트/멤버/태스크 간 복잡한 관계형 데이터 → RDBMS 최적
- JOIN 기반 집계 쿼리 (간트차트 데이터 조회) 성능 우수
- 날짜 범위 쿼리, 중복 검증 등 무결성 제약조건 지원
- Spring Data JPA와 완벽 호환
