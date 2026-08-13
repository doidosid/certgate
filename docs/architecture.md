# 전체 아키텍처

## 1. 컴포넌트

| 컴포넌트 | 기술 | 역할 |
|---|---|---|
| Device Agent | Go | 개인키·CSR 생성, 인증서 보관, mTLS 접속, Heartbeat·Telemetry 전송 |
| Security Gateway | Go | mTLS 종료, 인증서 신원 추출, 상태·정책 검사, 요청 전달, 이벤트 생성 |
| Management API | Java / Spring Boot | Device·CSR·인증서·Role·정책·보안 이벤트 관리, Critical Event SSE 전송 |
| Admin Console | React | 운영 현황 조회와 Device·인증서 관리, 실시간 Critical 알림 표시 |
| Database | PostgreSQL | 운영 메타데이터와 보안 이벤트 저장 |
| Private CA | 초기 OpenSSL | 승인된 CSR 서명. CA 개인키는 실행 환경에서만 사용 |
| Backend Service | 최소 HTTP 서비스 | 신뢰된 요청만 Gateway를 통과하는지 검증 |

## 2. 전체 흐름

```text
Device Agent
    │ TLS 1.3 / mTLS
    ▼
Security Gateway ── Device·인증서·정책 조회 ──► Management API
    │                                                │
    │ 허용된 요청                                    ▼
    ▼                                            PostgreSQL
Backend Service

Gateway 내부
  └─ SQLite Durable Outbox ── 재시도 ──► Management API

Management API ── Critical Event / SSE ──► React Console

Administrator ──► React Console ── REST API ──► Management API
```

## 3. 서비스 간 통신

- Device → Gateway: mTLS가 적용된 HTTPS REST
- Gateway → Backend: Docker 내부망의 HTTP Proxy
- Gateway → Management API: Service Token으로 보호된 내부 REST API
- Console → Management API: REST API와 Critical Event 수신용 SSE. 관리자 인증은 제출 이후에 추가
- SSE 연결이 끊긴 동안의 Critical Event는 재접속 후 Security Event API로 조회한다.
- Gateway는 외부 요청의 `X-CertGate-Device-ID`, `X-CertGate-Role`을 삭제하고 검증 결과로 다시 생성한다.
- 인증서 상태 Cache 기본 TTL은 30초이며 인증서 폐기 시 해당 항목을 즉시 무효화한다.

## 4. 신뢰 경계

- Device가 존재하는 외부 네트워크는 신뢰하지 않는다.
- Gateway만 Backend Service의 진입점으로 둔다.
- Management API와 PostgreSQL은 신뢰된 관리 영역에 둔다.
- CA 개인키는 일반 애플리케이션 데이터보다 높은 보호가 필요한 자산으로 취급한다.
- Device가 HTTP Header나 Payload로 주장하는 Identity는 신뢰하지 않는다.
- Device Identity는 검증된 Client Certificate에서만 추출한다.

## 5. Gateway 처리 순서

1. 설정된 Private CA가 발급한 Client Certificate로 TLS Handshake를 수행한다.
2. 인증서 Serial Number와 Device Identity를 추출한다.
3. 인증서 체인과 유효기간을 확인한다.
4. Management API에서 Device·인증서 상태와 Role을 조회한다.
5. 미등록·비활성·폐기 상태라면 차단한다.
6. Role, HTTP Method, Path를 기준으로 접근 정책을 평가한다.
7. 허용된 요청에만 Gateway가 신뢰된 내부 Identity Header를 붙여 Backend로 전달한다.
8. 결과와 처리 시간을 Security Event로 기록한다.

## 6. 저장소 구조

```text
certgate/
├─ device-agent/
├─ gateway/
├─ management-api/
├─ admin-console/
├─ backend-service/
├─ pki/
├─ infra/
├─ tests/e2e/
└─ docs/
```

## 7. 이벤트 전달 신뢰성

- Gateway는 Security Event에 UUID를 부여한다.
- 전송 실패 시 Docker Volume에 저장된 SQLite Durable Outbox에 보관한다.
- Background Worker가 지수 Backoff로 재전송한다.
- Management API는 Event UUID에 Unique Constraint를 적용해 중복 저장을 막는다.
- 전송 성공이 확인된 항목만 Outbox에서 삭제한다.
- 가장 오래된 미전송 Event와 대기 건수를 운영 지표로 노출한다.

## 8. MVP의 기술적 한계

MVP에서는 인증서 폐기를 **TLS Handshake 이후, Backend 전달 이전**에 확인한다. CRL·OCSP를 이용한 Handshake 단계의 폐기 검증을 구현했다고 표현하지 않는다.
