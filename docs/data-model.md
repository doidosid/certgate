# 데이터 모델 초안

## Device

- `id`: UUID
- `device_key`: 외부에서 사용하는 고유 Device Identity
- `name`: Device 표시 이름
- `status`: ACTIVE, DISABLED
- `role_name`: 지정된 Role
- `created_at`: 등록 시각
- `last_seen_at`: 마지막 정상 접속 시각

## CertificateRequest

- `id`: UUID
- `device_id`: Device FK
- `csr_pem`: 제출된 CSR
- `status`: PENDING, APPROVED, REJECTED
- `requested_at`: 요청 시각
- `decided_at`: 결정 시각
- `decision_note`: 승인·거절 사유

## Certificate

- `id`: UUID
- `device_id`: Device FK
- `request_id`: CertificateRequest FK
- `serial_number`: 고유 Serial Number
- `subject_dn`: 인증서 Subject
- `fingerprint_sha256`: SHA-256 Fingerprint
- `not_before`, `not_after`: 유효기간
- `status`: VALID, EXPIRED, REVOKED
- `issued_at`: 발급 시각
- `revoked_at`: 폐기 시각
- `revocation_reason`: 폐기 사유

## Role

- `name`: Role 이름, PK
- `description`: 설명

## PolicyRule

- `id`: UUID
- `role_name`: Role FK
- `http_method`: 허용·차단 대상 Method
- `path_pattern`: 요청 Path 규칙
- `effect`: ALLOW 또는 DENY
- `priority`: 규칙 평가 순서

## SecurityEvent

- `id`: UUID
- `occurred_at`: 발생 시각
- `device_id`: Device FK, 식별 전 실패 시 null 가능
- `certificate_serial`: 인증서 Serial Number
- `http_method`, `request_path`
- `decision`: ALLOWED 또는 DENIED
- `reason_code`: 처리 사유
- `client_ip`: 접속 IP
- `latency_ms`: 처리 시간
- `trace_id`: 요청 추적 ID

## Alert

- `id`: UUID
- `created_at`: 최초 발생 시각
- `last_occurred_at`: 마지막 반복 발생 시각
- `severity`: CRITICAL, HIGH, MEDIUM
- `type`: Alert 종류
- `status`: OPEN, ACKNOWLEDGED, RESOLVED
- `source_key`: 중복 억제용 원인 식별자
- `occurrence_count`: 묶인 반복 발생 횟수
- `security_event_id`: 원인이 된 Event FK, null 가능
- `acknowledged_at`, `resolved_at`

## NotificationOutbox

- `id`: UUID
- `alert_id`: Alert FK
- `destination`: Webhook 대상 식별자
- `payload`: 발송 Payload
- `status`: PENDING, SENT, FAILED
- `attempt_count`: 시도 횟수
- `next_attempt_at`: 다음 재시도 시각
- `last_error`: 마지막 실패 사유
- `created_at`, `sent_at`

Gateway의 Security Event Outbox는 PostgreSQL이 아니라 Gateway 로컬 SQLite에 저장하고 Docker Volume으로 보존한다.

## 관계

```text
Device 1 ─── N CertificateRequest
Device 1 ─── N Certificate
Role   1 ─── N Device
Role   1 ─── N PolicyRule
Device 1 ─── N SecurityEvent
SecurityEvent 1 ─── 0..N Alert
Alert 1 ─── N NotificationOutbox
```

DB에는 인증서 메타데이터를 저장하되 Device 개인키는 저장하지 않는다. PEM 원문 보관과 Security Event 보존 기간은 MVP 구현 과정에서 다시 결정한다.
