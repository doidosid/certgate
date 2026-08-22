# 데이터 모델 v1

PostgreSQL은 관리 영역의 Source of Truth다. Gateway 전송 대기는 별도 SQLite Outbox가 담당한다.

## Device

- <code>id</code>: UUID, PK
- <code>device_key</code>: varchar, Unique, 변경 불가
- <code>name</code>: varchar
- <code>status</code>: ACTIVE, DISABLED
- <code>role_name</code>: Role FK
- <code>created_at</code>, <code>updated_at</code>
- <code>last_seen_at</code>: 마지막 허용 요청 시각, null 가능

## EnrollmentCredential

- <code>id</code>: UUID, PK
- <code>device_id</code>: Device FK
- <code>token_hash</code>: SHA-256 Hash, Unique
- <code>expires_at</code>
- <code>revoked_at</code>: 재발급·수동 폐기 시각
- <code>created_at</code>
- <code>last_used_at</code>

평문 Token은 저장하지 않는다. Device별 활성 Credential은 하나만 허용한다.

## CertificateRequest

- <code>id</code>: UUID, PK
- <code>device_id</code>: Device FK
- <code>enrollment_credential_id</code>: EnrollmentCredential FK
- <code>csr_pem</code>: 공개 정보인 CSR 원문
- <code>subject_dn</code>
- <code>san_uri</code>
- <code>public_key_algorithm</code>
- <code>fingerprint_sha256</code>
- <code>status</code>: PENDING, APPROVED, REJECTED
- <code>requested_at</code>, <code>decided_at</code>
- <code>decision_note</code>

같은 Device에는 PENDING 요청을 하나만 허용한다.

## Certificate

- <code>id</code>: UUID, PK
- <code>device_id</code>: Device FK
- <code>request_id</code>: CertificateRequest FK, Unique
- <code>serial_number</code>: Unique
- <code>certificate_pem</code>: 공개 인증서 원문
- <code>subject_dn</code>, <code>san_uri</code>
- <code>issuer_dn</code>: 서명한 Intermediate CA의 Subject DN
- <code>fingerprint_sha256</code>: Unique
- <code>not_before</code>, <code>not_after</code>
- <code>issued_at</code>
- <code>revoked_at</code>
- <code>revocation_reason</code>, <code>revocation_note</code>

VALID, EXPIRING_SOON, EXPIRED, REVOKED는 별도 상태 Column이 아니라 시각과 revokedAt으로 계산한다.

## Role

- <code>name</code>: PK
- <code>description</code>

MVP Seed: SENSOR, OPERATOR. ADMIN_DEVICE는 실제 규칙이 생길 때 추가한다.

## PolicyRule

- <code>id</code>: UUID, PK
- <code>role_name</code>: Role FK
- <code>http_method</code>
- <code>path_pattern</code>
- <code>effect</code>: ALLOW
- <code>priority</code>
- Unique: role_name + http_method + path_pattern

MVP는 ALLOW List와 기본 DENY만 사용한다.

## SecurityEvent

- <code>id</code>: UUID, PK. Gateway가 생성
- <code>occurred_at</code>
- <code>type</code>: ACCESS, TLS, SYSTEM, PKI
- <code>severity</code>: INFO, WARNING, CRITICAL
- <code>device_id</code>: Device FK, null 가능
- <code>certificate_serial</code>: null 가능
- <code>http_method</code>, <code>request_path</code>: null 가능
- <code>decision</code>: ALLOWED, DENIED, ERROR
- <code>reason_code</code>
- <code>client_ip</code>: null 가능
- <code>latency_ms</code>: null 가능
- <code>trace_id</code>
- <code>created_at</code>: Management API 저장 시각

Event는 수정·삭제 API를 제공하지 않는다. Critical 알림은 별도 Alert Table 없이 이 데이터의 severity로 표현한다.

## 필수 Index

- Device: Unique(device_key)
- EnrollmentCredential: Unique(token_hash), Index(device_id, expires_at)
- CertificateRequest: Index(status, requested_at), Index(device_id, requested_at)
- Certificate: Unique(serial_number), Unique(fingerprint_sha256), Index(device_id, not_after)
- SecurityEvent: Index(occurred_at desc), Index(device_id, occurred_at desc), Index(severity, occurred_at desc), Index(reason_code, occurred_at desc)

## SQLite EventOutbox

Gateway 로컬 DB:

- <code>event_id</code>: UUID, PK
- <code>payload_json</code>
- <code>attempt_count</code>
- <code>next_attempt_at</code>
- <code>last_error</code>
- <code>created_at</code>

전송 성공 응답을 받은 뒤에만 삭제한다. SQLite 파일은 Docker Volume으로 보존한다.

## 관계

~~~text
Role 1 ── N Device
Role 1 ── N PolicyRule
Device 1 ── N EnrollmentCredential
Device 1 ── N CertificateRequest
Device 1 ── N Certificate
Device 1 ── N SecurityEvent
CertificateRequest 1 ── 0..1 Certificate
~~~

## 저장 금지 데이터

- Device 개인키
- Root·Intermediate CA 개인키 원문
- Enrollment Token 평문
- 비밀번호와 Service Token
- 전체 Telemetry Payload
