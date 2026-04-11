# Stage 1: Build
FROM gradle:8.14-jdk17 AS builder
WORKDIR /app
COPY build.gradle settings.gradle ./
# 의존성 레이어 캐시를 위해 소스 전 dependencies 다운로드
RUN gradle dependencies --no-daemon || true
COPY src/ src/
RUN gradle bootJar --no-daemon -x test

# Stage 2: Runtime
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar
EXPOSE 2403
ENTRYPOINT ["java", "-jar", "app.jar"]
