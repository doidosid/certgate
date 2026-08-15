# Management API

Spring Boot와 PostgreSQL 기반 관리 영역이다.

도메인:

- Device·EnrollmentCredential
- CertificateRequest·Certificate
- Role·PolicyRule
- SecurityEvent·Dashboard·SSE

Root CA Key는 사용하지 않으며 Runtime에는 Intermediate CA 자료만 주입한다.

## 현재 상태

Foundation 단계: Spring Boot 애플리케이션 골격, 실제 PostgreSQL 연결(JPA/Flyway), Actuator Health(`/actuator/health`)를 구성했다. PostgreSQL이 응답하지 않으면 Health가 `DOWN`(503)을 반환한다 (Testcontainers 기반 `HealthIntegrationTests`로 검증). 도메인 Entity·API·Migration Schema는 아직 구현하지 않았다 — Device·Certificate 등 실제 Schema는 Enrollment·PKI 이슈에서 Migration으로 추가한다. 도메인 패키지는 `src/main/java/tech/certgate/{common,device,enrollment,certificate,policy,securityevent,dashboard}`에 책임만 문서화된 상태다.

## 개발 명령

~~~bash
./gradlew test
./gradlew build
./gradlew bootRun
~~~
