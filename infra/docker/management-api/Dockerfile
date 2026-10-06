FROM gradle:9.7.0-jdk21 AS build
WORKDIR /src
COPY . .
RUN gradle bootJar --no-daemon -x test

FROM eclipse-temurin:21.0.12.1_1-jre-jammy
# 태그가 갱신되기 전에 공개된 OS 패키지 보안 수정(예: libssl3)을 반영한다. CI
# image-scan은 수정본이 있는 HIGH·CRITICAL을 실패로 본다.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
