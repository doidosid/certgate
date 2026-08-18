# Management API

Spring Boot와 PostgreSQL 기반 관리 영역이다.

도메인:

- Device·EnrollmentCredential
- CertificateRequest·Certificate
- Role·PolicyRule
- SecurityEvent·Dashboard·SSE

Root CA Key는 사용하지 않으며 Runtime에는 Intermediate CA 자료만 주입한다.

## 현재 상태

Foundation(Spring Boot 골격, PostgreSQL 연결, Actuator Health)에 이어 Enrollment·PKI 발급 흐름(Issue #1), Gateway용 내부 API(Issue #3 일부), Certificate 조회·다운로드·폐기(Issue #3 일부)를 구현했다.

- Flyway Migration으로 `role`(SENSOR/OPERATOR Seed), `device`, `enrollment_credential`, `certificate_request`, `certificate`, `policy_rule`, `security_event` Schema 생성 (필수 Unique·FK·부분 Index 포함)
- `POST /api/v1/devices`: Device 등록 + Enrollment Token 발급(평문은 응답에서 한 번만, DB에는 SHA-256 Hash만 저장) — 목록·상태변경·Role변경·Token 재발급은 Issue #3 잔여 작업
- `POST /api/v1/enrollments/certificate-requests`: Bearer Token으로 CSR 제출 — Token 검증 → CSR 자체서명 검증 → 공개키 정책(ECDSA P-256/RSA 2048+) → 단일 SAN URI와 Device Key 일치 확인 → PENDING 중복 방지 순서로 검증(api-spec.md §4)
- `GET /api/v1/enrollments/certificate-requests/{id}`, `.../certificate`: 상태 조회·Certificate+Chain 수령
- `POST /api/v1/certificate-requests/{id}/approve`: Intermediate CA(Bouncy Castle)로 서명, 유효기간은 Intermediate CA 잔여 기간을 넘지 않음(ADR-003)
- `GET /api/v1/certificates`, `/{id}`, `/{id}/download`: 목록(status/deviceId/expiresBefore 필터+Page)·상세·PEM 다운로드
- `POST /api/v1/certificates/{id}/revoke`: 폐기 — Transaction Commit 후(`@TransactionalEventListener(AFTER_COMMIT)`) Gateway `POST /internal/cache/invalidations` 호출, 실패해도 폐기 자체는 Rollback하지 않음(30초 TTL로 수렴)
- `GET /internal/access-context`, `POST /internal/security-events/batch`: Gateway 전용 내부 API(Bearer `GATEWAY_SERVICE_TOKEN`)
- CSR 승인/거절 목록 조회, Device 목록·상태변경·Role변경·Token재발급은 아직 미구현 (Issue #3 잔여)

`certgate.gateway.internal-url`/`internal-token`(`GATEWAY_INTERNAL_URL`/`GATEWAY_INTERNAL_TOKEN`)이 비어 있으면 `GatewayCacheClient`는 호출을 건너뛰고 로그만 남긴다 — Foundation 상태의 Health 테스트가 Gateway 없이도 계속 통과하도록 하기 위함이다.

`certgate.ca.*` 설정(`ROOT_CA_CERT_PATH`, `INTERMEDIATE_CA_CERT_PATH`, `INTERMEDIATE_CA_KEY_PATH`)은 CA 파일이 없어도 기동은 되고, 실제 서명 요청 시점에만 실패한다(`CA_SIGNING_FAILED`) — Foundation 상태의 Health 테스트가 CA 파일 없이도 계속 통과하도록 하기 위함이다.

## 개발 명령

~~~bash
./gradlew test
./gradlew build
./gradlew bootRun
~~~
