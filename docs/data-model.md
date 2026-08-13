# Data Model Draft

## Device

- `id`: UUID
- `device_key`: unique external identity
- `name`
- `status`: ACTIVE, DISABLED
- `role_name`
- `created_at`
- `last_seen_at`

## CertificateRequest

- `id`: UUID
- `device_id`: FK
- `csr_pem`
- `status`: PENDING, APPROVED, REJECTED
- `requested_at`
- `decided_at`
- `decision_note`

## Certificate

- `id`: UUID
- `device_id`: FK
- `request_id`: FK
- `serial_number`: unique
- `subject_dn`
- `fingerprint_sha256`: unique
- `not_before`
- `not_after`
- `status`: VALID, EXPIRED, REVOKED
- `issued_at`
- `revoked_at`
- `revocation_reason`

## Role

- `name`: PK
- `description`

## PolicyRule

- `id`: UUID
- `role_name`: FK
- `http_method`
- `path_pattern`
- `effect`: ALLOW or DENY
- `priority`

## SecurityEvent

- `id`: UUID
- `occurred_at`
- `device_id`: nullable FK
- `certificate_serial`: nullable
- `http_method`
- `request_path`
- `decision`: ALLOWED or DENIED
- `reason_code`
- `client_ip`
- `latency_ms`
- `trace_id`

## Initial relationships

```text
Device 1 ─── N CertificateRequest
Device 1 ─── N Certificate
Role   1 ─── N Device
Role   1 ─── N PolicyRule
Device 1 ─── N SecurityEvent
```

Large PEM contents and event retention will be revisited after the MVP. The database stores certificate metadata; the implementation must avoid storing device private keys.
