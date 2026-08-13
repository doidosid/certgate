# 보안 설계 v1

## 1. 신뢰 모델

- 외부 Device 네트워크는 신뢰하지 않는다.
- Device가 Header나 Payload로 주장한 Identity는 신뢰하지 않는다.
- Device Identity는 검증된 Client Certificate의 SAN URI에서만 추출한다.
- Gateway만 Backend Service의 외부 진입점이다.
- Management API와 PostgreSQL은 Docker 내부 관리 영역에 둔다.
- 관리자 인증이 없는 MVP Management API는 인터넷에 공개하지 않는다.

## 2. 최초 Enrollment

인증서가 없는 Device를 안전하게 등록하기 위해 단기 Enrollment Token을 사용한다.

1. 관리자가 Device를 등록한다.
2. Management API가 24시간 유효한 Token을 생성하고 평문을 한 번만 반환한다.
3. DB에는 Token의 SHA-256 Hash만 저장한다.
4. Device Agent는 로컬에서 개인키와 CSR을 만든다.
5. Agent가 Bearer Token으로 CSR을 제출한다.
6. 서버는 Token 대상 Device Key와 CSR SAN URI의 정확한 일치를 검증한다.
7. 관리자가 승인하면 Intermediate CA가 서명한다.
8. Device는 같은 Enrollment 범위에서 Certificate와 CA Chain을 내려받는다.

Token은 CSR 제출·상태 조회·인증서 수령에만 사용할 수 있다. 재발급 시 기존 활성 Token은 폐기한다.

## 3. CA 계층

~~~text
Root CA (10년)
  └─ Intermediate CA (3년)
       └─ Device Certificate (30일)
~~~

- Root CA Key는 Intermediate CA 서명에만 사용한다.
- 실행 중인 Management API에는 Intermediate CA Certificate와 Key만 주입한다.
- CA와 Device Private Key는 Git에 올리지 않는다.
- 발급 인증서의 유효기간은 상위 CA의 남은 유효기간을 넘지 않는다.
- 상용 HSM·KMS·Key Ceremony는 MVP 범위가 아니다.

## 4. CSR 검증

승인 전에 다음을 모두 검증한다.

- CSR 자체 서명
- 허용 공개키: ECDSA P-256 또는 RSA 2048 이상
- SAN URI 단 하나가 <code>urn:certgate:device:{device-key}</code>와 일치
- Common Name은 인증 판단에 사용하지 않음
- 등록되고 ACTIVE인 Device
- 동일 Device의 PENDING 요청 중복 없음

## 5. Gateway mTLS 인증

- TLS 1.3 사용
- Client Certificate 필수
- Root CA 기준 Chain·서명·유효기간 검증
- SAN URI에서 Device Key 추출
- Certificate Serial로 Management API Access Context 조회
- Device ACTIVE, Certificate 유효, Identity 일치 여부 확인
- 검증 실패 시 Backend로 전달하지 않음

TLS Handshake 단계에서 끝난 실패는 Gateway 구조화 로그에 우선 기록한다. 안정적으로 Event 정보를 추출할 수 있는 실패부터 Outbox에 저장하며, 구현하지 않은 Handshake Event 수집을 완료 기능으로 표현하지 않는다.

## 6. 인증서 폐기

1. Management API Transaction에서 revokedAt과 사유를 저장한다.
2. Commit 후 Gateway Cache 무효화 API를 호출한다.
3. 무효화 실패 시 30초 TTL로 최종 수렴한다.
4. Gateway는 Handshake 후 Backend 전달 전에 폐기 상태를 확인한다.
5. 폐기된 인증서는 차단하고 CRITICAL Security Event를 생성한다.

CRL·OCSP는 제출 이후 확장 기능이다.

## 7. 접근 정책

| Role | 허용 |
|---|---|
| SENSOR | POST /telemetry, POST /heartbeat |
| OPERATOR | SENSOR 권한 + GET /commands |

- 일치하는 ALLOW 규칙이 없으면 DENY
- Path 정규화 후 평가
- 외부의 <code>X-CertGate-Device-ID</code>, <code>X-CertGate-Role</code> 삭제
- 검증 성공 후 Gateway가 신뢰 Header를 새로 생성
- Backend는 Gateway 내부망 요청만 수신

## 8. Service 인증

- Gateway → Management API: Gateway Service Token
- Management API → Gateway Cache API: 별도 Internal Token
- Token은 환경변수 또는 Secret File로 주입
- Token 값을 로그에 남기지 않음
- 개발 기본값을 운영 값으로 사용하지 않음

## 9. Security Event와 Critical 판정

별도 Alert Domain은 만들지 않는다. Security Event가 원본이며 CRITICAL Event만 SSE로 실시간 전달한다.

CRITICAL 조건:

- 폐기 인증서 접속
- 동일 IP의 Invalid Certificate가 1분에 5회 이상
- CA 서명 실패
- Outbox 대기 100건 이상
- 가장 오래된 Outbox Event 지연 1분 이상

첫 구현 우선순위는 폐기 인증서, CA 서명 실패, Outbox 상태다. Handshake 실패 반복 집계는 안정적인 Client IP 수집이 확인된 뒤 추가한다.

## 10. 로그·데이터 최소화

기록:

- 시간, Trace ID, Device ID, Certificate Serial
- Method, Path, Decision, Reason Code
- Client IP, Latency

기록 금지:

- Private Key
- Token·비밀번호
- Certificate 전체 원문
- 전체 CSR 원문
- 전체 Telemetry Payload

## 11. 명시적 한계

상용 CA 보안, 관리자 인증, CRL·OCSP, 자동 갱신, 감사 로그 변조 방지, Rate Limit, Replay Protection, HA는 MVP 범위가 아니다.
