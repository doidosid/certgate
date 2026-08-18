# API 구현 계약 v1

이 문서는 화면 초안이 아니라 구현 시 DTO, 상태 코드, 인증 경계를 맞추기 위한 계약이다.

## 1. 공통 규칙

- Management API 기본 경로: <code>/api/v1</code>
- JSON 필드명: <code>camelCase</code>
- 시간: UTC ISO 8601. 예: <code>2026-08-13T05:32:18Z</code>
- ID: UUID 문자열
- 목록 기본값: <code>page=0</code>, <code>size=20</code>, 최대 <code>size=100</code>
- 정렬: <code>sort=필드,asc|desc</code>
- 쓰기 응답에는 <code>Location</code> Header를 가능한 경우 포함한다.
- 요청 추적 ID는 <code>X-Trace-Id</code>로 전달하고 없으면 서버가 생성한다.
- Enum은 API에서 영문 대문자로 전달하고 Console에서 한국어로 변환한다.
- 단건 응답은 불필요한 공통 Envelope 없이 Resource JSON을 반환한다.
- <code>deviceId</code>는 Management API Resource UUID이고, <code>deviceKey</code>는 인증서 Identity에 사용하는 변경 불가 식별자다.
- X.509 SAN URI는 단 하나의 <code>urn:certgate:device:{device-key}</code> 형식만 허용한다. 예: <code>urn:certgate:device:sensor-floor-01</code>.

### 페이지 응답

~~~json
{
  "content": [],
  "page": 0,
  "size": 20,
  "totalElements": 0,
  "totalPages": 0
}
~~~

### 오류 응답

~~~json
{
  "code": "CERTIFICATE_REVOKED",
  "message": "폐기된 인증서입니다.",
  "traceId": "5f4020d6-5f1e-4d9e-80c7-5cd451624dda",
  "fieldErrors": []
}
~~~

주요 HTTP 상태:

- <code>400</code>: 입력값·CSR·상태 전이 오류
- <code>401</code>: Enrollment Token 또는 Service Token 오류
- <code>403</code>: 접근 권한 부족
- <code>404</code>: Resource 없음
- <code>409</code>: Device Key, Serial, Event ID 중복 또는 잘못된 상태 전이
- <code>422</code>: CSR 서명 검증, SAN URI, 공개키 정책 오류
- <code>500</code>: CA 서명 또는 내부 처리 실패

## 2. 인증 경계

| API 구분 | 보호 방식 | MVP 노출 |
|---|---|---|
| 관리자 API | 개발 환경의 localhost·Docker 내부망으로 제한 | 인터넷 공개 금지 |
| Enrollment API | Device별 단기 Bearer Token | CSR 제출·상태·다운로드만 허용 |
| Gateway 내부 API | <code>Authorization: Bearer SERVICE_TOKEN</code> | Docker 내부망만 |
| Gateway Cache API | 별도 내부 Service Token | Docker 내부망만 |

관리자 로그인 UI는 MVP 제외 범위다. 따라서 관리자 API는 인증이 없다는 사실보다 **외부에 공개하지 않는 배포 제한**이 보안 경계가 된다.

## 3. Device API

### Device 등록

<code>POST /devices</code>

~~~json
{
  "deviceKey": "sensor-floor-01",
  "name": "1층 온도 센서",
  "roleName": "SENSOR"
}
~~~

<code>201 Created</code>

~~~json
{
  "id": "0d6515ae-d560-4777-b102-054e71f98ef9",
  "deviceKey": "sensor-floor-01",
  "name": "1층 온도 센서",
  "status": "ACTIVE",
  "roleName": "SENSOR",
  "enrollmentToken": "cg_enroll_xxx",
  "enrollmentExpiresAt": "2026-08-14T05:32:18Z",
  "createdAt": "2026-08-13T05:32:18Z"
}
~~~

<code>enrollmentToken</code>은 생성 응답에서 한 번만 반환하고 평문으로 저장하거나 로그에 남기지 않는다.

### 목록·상세·상태·Role

| Method | Path | 설명 |
|---|---|---|
| GET | <code>/devices?query=&status=&roleName=&page=&size=&sort=</code> | 목록 |
| GET | <code>/devices/{deviceId}</code> | 인증서·정책·최근 Event를 포함한 상세 |
| PATCH | <code>/devices/{deviceId}/status</code> | <code>{"status":"ACTIVE|DISABLED"}</code> |
| PUT | <code>/devices/{deviceId}/role</code> | <code>{"roleName":"SENSOR"}</code> |
| POST | <code>/devices/{deviceId}/enrollment-token</code> | 이전 Token 폐기 후 새 Token 발급 |

목록 항목:

~~~json
{
  "id": "0d6515ae-d560-4777-b102-054e71f98ef9",
  "deviceKey": "sensor-floor-01",
  "name": "1층 온도 센서",
  "status": "ACTIVE",
  "roleName": "SENSOR",
  "certificateStatus": "VALID",
  "certificateExpiresAt": "2026-09-12T05:32:18Z",
  "lastSeenAt": "2026-08-13T05:31:54Z"
}
~~~

## 4. Enrollment·CSR API

### Device의 CSR 제출

<code>POST /enrollments/certificate-requests</code>

Header: <code>Authorization: Bearer cg_enroll_xxx</code>

~~~json
{
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----..."
}
~~~

검증 순서:

1. Token Hash, 만료, 폐기 여부 확인
2. CSR 서명 유효성 확인
3. 공개키 알고리즘과 최소 강도 확인
4. 단일 SAN URI가 <code>urn:certgate:device:{device-key}</code> 형식이고 그 Device Key가 Token 대상 Device의 <code>deviceKey</code>와 정확히 일치하는지 확인
5. 같은 Device의 PENDING 요청 중복 방지

<code>202 Accepted</code>

~~~json
{
  "id": "241a9ba8-b4d0-4a20-8684-486847ae98a4",
  "deviceId": "0d6515ae-d560-4777-b102-054e71f98ef9",
  "status": "PENDING",
  "requestedAt": "2026-08-13T05:40:00Z"
}
~~~

### Device의 상태 조회와 인증서 수령

| Method | Path | 설명 |
|---|---|---|
| GET | <code>/enrollments/certificate-requests/{requestId}</code> | Token 소유 Device의 요청 상태 |
| GET | <code>/enrollments/certificate-requests/{requestId}/certificate</code> | 승인 완료 후 Certificate와 Chain 반환 |

인증서 수령 응답:

~~~json
{
  "certificatePem": "-----BEGIN CERTIFICATE-----...",
  "caChainPem": "-----BEGIN CERTIFICATE-----...",
  "serialNumber": "7F28A109",
  "notAfter": "2026-09-12T05:45:00Z"
}
~~~

### 관리자 CSR 관리

| Method | Path | 설명 |
|---|---|---|
| GET | <code>/certificate-requests?status=&deviceId=&page=&size=</code> | 요청 목록 |
| GET | <code>/certificate-requests/{requestId}</code> | CSR 상세 |
| POST | <code>/certificate-requests/{requestId}/approve</code> | 검증 후 Intermediate CA 서명 |
| POST | <code>/certificate-requests/{requestId}/reject</code> | 거절 사유 저장 |

승인·거절 요청은 <code>{"decisionNote":"..."}</code>를 사용한다. PENDING 상태에서만 처리할 수 있으며 재호출은 <code>409</code>를 반환한다.

## 5. Certificate API

| Method | Path | 설명 |
|---|---|---|
| GET | <code>/certificates?status=&deviceId=&expiresBefore=&page=&size=</code> | 목록 |
| GET | <code>/certificates/{certificateId}</code> | 상세 |
| GET | <code>/certificates/{certificateId}/download</code> | 공개 인증서 다운로드 |
| POST | <code>/certificates/{certificateId}/revoke</code> | 폐기 |

폐기 요청:

~~~json
{
  "reason": "KEY_COMPROMISE",
  "note": "Device 분실 신고"
}
~~~

<code>reason</code>은 필수이며 비어 있으면 <code>400 REVOCATION_REASON_REQUIRED</code>를 반환한다. <code>reason</code>은 최대 64자, <code>note</code>는 최대 500자이며 초과 시 각각 <code>400 REVOCATION_REASON_TOO_LONG</code>, <code>400 REVOCATION_NOTE_TOO_LONG</code>을 반환한다.

상태는 DB의 <code>revokedAt</code>, <code>notBefore</code>, <code>notAfter</code>로 계산한다.

- <code>REVOKED</code>: revokedAt 존재
- <code>EXPIRED</code>: 현재 시각이 notAfter 이후
- <code>EXPIRING_SOON</code>: 만료까지 7일 이하
- <code>VALID</code>: 나머지

폐기 Transaction이 Commit된 뒤 Management API가 Gateway Cache 무효화를 요청한다. 무효화 실패 시 폐기 자체는 Rollback하지 않으며 30초 TTL이 최종 수렴을 보장한다.

## 6. Policy API

| Method | Path | 설명 |
|---|---|---|
| GET | <code>/roles</code> | Role과 규칙 목록 |
| GET | <code>/roles/{roleName}</code> | Role 상세 |

MVP의 정책 수정 API는 제공하지 않고 Seed Data로 관리한다.

~~~json
{
  "name": "SENSOR",
  "rules": [
    {"httpMethod":"POST","pathPattern":"/telemetry","effect":"ALLOW","priority":10},
    {"httpMethod":"POST","pathPattern":"/heartbeat","effect":"ALLOW","priority":20}
  ]
}
~~~

일치하는 ALLOW가 없으면 DENY다.

## 7. Gateway용 Management API

모든 요청에 <code>Authorization: Bearer GATEWAY_SERVICE_TOKEN</code>이 필요하다. Token이 없거나 일치하지 않으면 <code>401 SERVICE_TOKEN_INVALID</code>를 반환한다. Access Context에서 <code>serialNumber</code>에 해당하는 Certificate가 없으면 <code>404 CERTIFICATE_NOT_FOUND</code>다(§4의 같은 Code를 재사용— 미승인 요청이든 미등록 Serial이든 "그런 Certificate Record가 없다"는 동일한 의미).

### Access Context

<code>GET /internal/access-context?serialNumber=7F28A109</code>

~~~json
{
  "certificateId": "74ecff78-d52a-4f80-ae54-ac688b1c93ad",
  "serialNumber": "7F28A109",
  "certificateStatus": "VALID",
  "deviceId": "0d6515ae-d560-4777-b102-054e71f98ef9",
  "deviceKey": "sensor-floor-01",
  "deviceStatus": "ACTIVE",
  "roleName": "SENSOR",
  "rules": [
    {"httpMethod":"POST","pathPattern":"/telemetry","effect":"ALLOW","priority":10}
  ]
}
~~~

### Security Event Batch

<code>POST /internal/security-events/batch</code>

Gateway는 Security Event 생성과 SQLite Durable Outbox 저장을 하나의 로컬 Transaction으로 Commit한 뒤 이 API로 전송한다. <code>200 OK</code>를 받은 Event만 Outbox에서 삭제하며, 전송 실패 Event는 보존 후 재시도한다. `id`·`occurredAt`·`type`·`severity`·`decision`·`reasonCode`·`traceId` 중 하나라도 없으면 Batch 전체를 <code>400 SECURITY_EVENT_INVALID</code>로 거절한다(부분 저장하지 않음).

~~~json
{
  "events": [
    {
      "id": "c8c78370-174f-4f88-b230-784e2d9115be",
      "occurredAt": "2026-08-13T05:50:00Z",
      "type": "ACCESS",
      "severity": "INFO",
      "deviceId": "0d6515ae-d560-4777-b102-054e71f98ef9",
      "certificateSerial": "7F28A109",
      "httpMethod": "POST",
      "requestPath": "/telemetry",
      "decision": "ALLOWED",
      "reasonCode": "REQUEST_ALLOWED",
      "clientIp": "203.0.113.21",
      "latencyMs": 12,
      "traceId": "8a6ba949-f3ec-4916-aae2-d55bd787893d"
    }
  ]
}
~~~

<code>200 OK</code>

~~~json
{
  "acceptedCount": 1,
  "duplicateCount": 0
}
~~~

Event ID Unique Constraint로 재전송을 멱등 처리한다.

## 8. Gateway 내부 Cache API

이 API는 Go Gateway가 제공하고 Management API가 호출한다.

<code>POST http://gateway:8081/internal/cache/invalidations</code>

~~~json
{
  "type": "CERTIFICATE",
  "key": "7F28A109"
}
~~~

성공은 <code>204 No Content</code>다. 별도 내부 Service Token을 사용한다.

## 9. Console 조회 API

| Method | Path | 설명 |
|---|---|---|
| GET | <code>/dashboard/summary?from=&to=</code> | 요약, 요청 추이, Health, Outbox, 최근 Critical Event |
| GET | <code>/security-events?from=&to=&deviceId=&decision=&reasonCode=&severity=&page=&size=</code> | 검색 |
| GET | <code>/security-events/{eventId}</code> | 상세 |
| GET | <code>/security-events/stream</code> | Critical Event SSE |

### Dashboard 응답 핵심 형태

~~~json
{
  "devices": {"active":24,"total":27},
  "certificates": {"valid":22,"expiringSoon":2},
  "pendingCertificateRequests": 3,
  "criticalEvents24h": 2,
  "requestBuckets": [
    {"startedAt":"2026-08-13T04:00:00Z","allowed":208,"denied":4}
  ],
  "services": [
    {"name":"gateway","status":"UP","latencyMs":12}
  ],
  "outbox": {"pendingCount":12,"oldestAgeSeconds":24},
  "recentCriticalEvents": []
}
~~~

### SSE 형식

~~~text
event: critical-security-event
id: c8c78370-174f-4f88-b230-784e2d9115be
data: {"eventId":"c8c78370-174f-4f88-b230-784e2d9115be","occurredAt":"2026-08-13T05:50:00Z","deviceKey":"sensor-floor-03","reasonCode":"CERTIFICATE_REVOKED","message":"폐기된 인증서의 접근이 차단되었습니다."}
~~~

Security Event가 원본 데이터이며 SSE는 저장된 CRITICAL Event의 전달 수단일 뿐 원본 저장소가 아니다. 연결이 끊긴 동안의 Event는 Console이 마지막 확인 시각 이후의 <code>severity=CRITICAL</code> 목록을 다시 조회해 보완한다. MVP에서는 별도 Alert Domain, 외부 Webhook과 Notification Outbox를 제공하지 않는다.

## 10. Reason Code

- <code>CERTIFICATE_REQUIRED</code>
- <code>INVALID_CERTIFICATE</code>
- <code>CERTIFICATE_EXPIRED</code>
- <code>CERTIFICATE_REVOKED</code>
- <code>DEVICE_NOT_REGISTERED</code>
- <code>DEVICE_DISABLED</code>
- <code>ACCESS_DENIED</code>
- <code>REQUEST_ALLOWED</code>
- <code>CA_SIGNING_FAILED</code>
- <code>EVENT_OUTBOX_BACKLOG</code>
- <code>EVENT_DELIVERY_DELAYED</code>
- <code>SERVICE_TOKEN_INVALID</code>: Gateway 내부 API(§7) Bearer Service Token 없음·불일치 (401)
- <code>SECURITY_EVENT_INVALID</code>: Security Event Batch 필수 필드 없음 (400)
- <code>INTERNAL_ERROR</code>

### Management API 오류 Code

위 목록은 Gateway 접근 판정·Security Event 분류 중심이라 Management API의 Enrollment CSR 제출(§4)·Device 등록(§3)·Certificate 폐기(§5) 오류에 대응하는 항목이 없었다. Issue #1, #3 구현 중 아래를 추가해 오류 응답의 <code>code</code> 필드로 사용한다.

- <code>ENROLLMENT_TOKEN_INVALID</code>: Token 없음·형식 오류·만료·폐기 (401)
- <code>CSR_SIGNATURE_INVALID</code>: CSR 형식 오류 또는 자체 서명 검증 실패 (422)
- <code>PUBLIC_KEY_POLICY_VIOLATION</code>: ECDSA P-256·RSA 2048 이상이 아닌 공개키 (422)
- <code>SAN_URI_INVALID</code>: SAN URI 없음·2개 이상·형식 오류·Token 대상 Device Key 불일치 (422)
- <code>CERTIFICATE_REQUEST_DUPLICATE</code>: 동일 Device의 PENDING 요청 중복 (409)
- <code>CERTIFICATE_REQUEST_NOT_FOUND</code>: 요청 ID 없음 또는 Token 소유 Device 불일치 (404)
- <code>CERTIFICATE_REQUEST_NOT_PENDING</code>: PENDING이 아닌 요청에 승인 시도 (409)
- <code>CERTIFICATE_NOT_FOUND</code>: 아직 승인되지 않아 Certificate가 없음 (404)
- <code>DEVICE_KEY_DUPLICATE</code>: 이미 등록된 <code>deviceKey</code> (409)
- <code>DEVICE_KEY_REQUIRED</code>, <code>DEVICE_NAME_REQUIRED</code>, <code>ROLE_NAME_REQUIRED</code>, <code>ROLE_NOT_FOUND</code>: Device 등록 입력값 오류 (400)
- <code>MALFORMED_REQUEST_BODY</code>: 요청 본문이 없거나 JSON 형식이 아님 (400)
- <code>ENROLLMENT_TOKEN_CONFLICT</code>: Token 재발급 요청이 동시에 처리되어 경합 발생 (409)
- <code>REVOCATION_REASON_REQUIRED</code>: Issue #3 Certificate 폐기 구현 중 추가. 폐기 요청의 <code>reason</code>이 없거나 빈 값 (400)
- <code>REVOCATION_REASON_TOO_LONG</code>: 폐기 요청의 <code>reason</code>이 64자 초과 (400)
- <code>REVOCATION_NOTE_TOO_LONG</code>: 폐기 요청의 <code>note</code>가 500자 초과 (400)
- <code>INVALID_REQUEST_PARAMETER</code>: Issue #3 CSR 관리자 목록 조회 구현 중 추가. Query Parameter 또는 Path Variable을 선언된 타입(Enum, UUID 등)으로 변환할 수 없음 (400)
- <code>CONFLICT</code>: 위 목록에 없는 DB 제약 위반(동시 요청 경합) 일반 응답 (409). Certificate 재폐기 시도도 이 Code를 사용한다
