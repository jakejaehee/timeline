# Timeline 설치 가이드

## 1. 요구 환경

| 구분 | 최소 버전 | 비고 |
|------|----------|------|
| **Docker Compose 방식** | Docker 20.10+, Docker Compose V2 | `docker compose version` 으로 확인 |
| **로컬 직접 실행** | Java 17, PostgreSQL 16 | Gradle Wrapper 포함 (별도 설치 불필요) |

---

## 2. 빠른 시작 (Docker Compose)

Docker와 Docker Compose만 설치되어 있으면 3단계로 실행할 수 있습니다.

```bash
# 1) 소스 코드 클론
git clone <repository-url> timeline
cd timeline

# 2) 환경 변수 파일 생성 (선택 - 기본값으로 즉시 실행 가능)
cp .env.example .env
# 필요 시 .env 파일의 DB_PASSWORD 등을 수정하세요.

# 3) 컨테이너 빌드 및 실행
docker compose up --build
```

첫 빌드는 Gradle 의존성 다운로드로 수분이 소요될 수 있습니다. 이후 빌드는 Docker 레이어 캐시로 빠르게 완료됩니다.

정상 기동 후 브라우저에서 접속합니다:

```
http://localhost:2403
```

### 종료 및 재시작

```bash
# 종료
docker compose down

# 데이터 유지하며 재시작
docker compose up -d

# 데이터 포함 전체 삭제
docker compose down -v
```

---

## 3. 로컬 직접 실행

### 3.1 사전 준비

1. **Java 17** 설치 확인:
   ```bash
   java -version
   # openjdk version "17.x.x" 이상
   ```

2. **PostgreSQL 16** 설치 및 데이터베이스 생성:
   ```bash
   # PostgreSQL 접속
   psql -U postgres

   # 데이터베이스 생성
   CREATE DATABASE timeline;
   ```

### 3.2 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성합니다:

```bash
cp .env.example .env
```

`.env` 파일을 열어 PostgreSQL 연결 정보를 환경에 맞게 수정합니다:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=timeline
DB_USERNAME=postgres
DB_PASSWORD=postgres
```

### 3.3 실행

```bash
# 빌드 및 실행
./gradlew bootRun
```

브라우저에서 접속합니다:

```
http://localhost:2403
```

### 3.4 AI Parser 기능 (선택)

AI Parser 기능을 사용하려면 Claude CLI가 설치되어 있어야 합니다. `.env` 파일에 경로를 설정합니다:

```env
CLAUDE_CLI_PATH=/usr/local/bin/claude
```

> Docker 환경에서는 AI Parser 기능이 지원되지 않습니다.

---

## 4. 환경 변수 목록

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `DB_HOST` | `localhost` | PostgreSQL 호스트 주소 |
| `DB_PORT` | `5432` | PostgreSQL 포트 |
| `DB_NAME` | `timeline` | 데이터베이스 이름 |
| `DB_USERNAME` | `postgres` | 데이터베이스 사용자 |
| `DB_PASSWORD` | `postgres` | 데이터베이스 비밀번호 |
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI 실행 경로 (AI Parser용) |

---

## 5. 포트 정보

| 서비스 | 포트 | 설명 |
|--------|------|------|
| Timeline 앱 | `2403` | 웹 UI 및 REST API |
| PostgreSQL | `5432` | 데이터베이스 (Docker Compose 시 호스트에 노출) |

---

## 6. 자주 묻는 문제

### Q: `docker compose up` 시 DB 연결 실패

PostgreSQL healthcheck가 통과될 때까지 앱이 대기합니다. 로그에 `Connection refused`가 보이면 DB가 아직 준비 중인 상태입니다. 잠시 기다리면 자동으로 재시도합니다.

### Q: 포트 충돌 (`Bind for 0.0.0.0:2403 failed`)

이미 해당 포트를 사용 중인 프로세스가 있습니다. 다음 명령으로 확인 후 종료하세요:

```bash
lsof -i :2403
```

### Q: Gradle 빌드 실패

Java 17이 설치되어 있는지 확인하세요:

```bash
java -version
```

### Q: Docker 빌드 시 시간이 오래 걸림

첫 빌드 시 Gradle 의존성 다운로드로 수분이 소요됩니다. `build.gradle`이 변경되지 않는 한 이후 빌드는 Docker 캐시를 활용하여 빠르게 완료됩니다.

### Q: 데이터를 초기화하고 싶음

```bash
docker compose down -v
docker compose up --build
```

`-v` 플래그가 PostgreSQL 데이터 볼륨을 삭제합니다.
