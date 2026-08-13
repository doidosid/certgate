# 전체 아키텍처

## 1. 컴포넌트

| 컴포넌트 | 기술 | 역할 |
|---|---|---|
| Device Agent | Go | 개인키·CSR 생성, 인증서 보관, mTLS 접속, Heartbeat·Telemetry 전송 |
| Security Gateway | Go | mTLS 종료, 인증서 신원 추출, 상태·정책 검사, 요청 전달, 이벤트 생성 |
| Management API | Java / Spring Boot | Device·CSR·인증서·Role·정책·보안 이벤트 관리 |
| Admin Console | React | 운영 현황 조회와 Device·인증서 관리 |
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

Administrator ──► React Console ── REST API ──► Management API
```

## 3. 신뢰 경계

- Device가 존재하는 외부 네트워크는 신뢰하지 않는다.
- Gateway만 Backend Service의 진입점으로 둔다.
- Management API와 PostgreSQL은 신뢰된 관리 영역에 둔다.
- CA 개인키는 일반 애플리케이션 데이터보다 높은 보호가 필요한 자산으로 취급한다.
- Device가 HTTP Header나 Payload로 주장하는 Identity는 신뢰하지 않는다.
- Device Identity는 검증된 Client Certificate에서만 추출한다.

## 4. Gateway 처리 순서

1. 설정된 Private CA가 발급한 Client Certificate로 TLS Handshake를 수행한다.
2. 인증서 Serial Number와 Device Identity를 추출한다.
3. 인증서 체인과 유효기간을 확인한다.
4. Management API에서 Device·인증서 상태와 Role을 조회한다.
5. 미등록·비활성·폐기 상태라면 차단한다.
6. Role, HTTP Method, Path를 기준으로 접근 정책을 평가한다.
7. 허용된 요청에만 Gateway가 신뢰된 내부 Identity Header를 붙여 Backend로 전달한다.
8. 결과와 처리 시간을 Security Event로 기록한다.

## 5. 저장소 구조

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

## 6. MVP의 기술적 한계

MVP에서는 인증서 폐기를 **TLS Handshake 이후, Backend 전달 이전**에 확인한다. CRL·OCSP를 이용한 Handshake 단계의 폐기 검증을 구현했다고 표현하지 않는다.
