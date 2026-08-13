# 배포·운영 설계 v1

## Docker Compose 경계

~~~text
Host
 ├─ 8443 → Gateway mTLS
 ├─ 5173 → Admin Console (dev)
 └─ 8080 → Management API (dev)

Docker internal network
 ├─ Gateway internal cache API
 ├─ Management API
 ├─ PostgreSQL
 └─ Backend Service
~~~

- PostgreSQL과 Backend Service는 Host Port를 공개하지 않는다.
- 관리자 인증 구현 전 Management API는 개발 PC 밖에 공개하지 않는다.
- Gateway 외부 Port와 내부 관리 Port를 분리한다.

## Volume

- <code>postgres-data</code>
- <code>gateway-outbox</code>
- Runtime Certificate·Key Directory는 Git 밖에서 Mount

Root CA Key는 실행 Compose에 Mount하지 않는다. Management API에는 Intermediate CA 자료만 주입한다.

## Health

- Gateway: Process, Management API 연결은 별도 Readiness
- Management API: Spring Actuator, PostgreSQL
- Backend Service: HTTP Health
- Console: 정적 Serving Health
- Dashboard는 Gateway Outbox 대기 수·최고 지연과 서비스 상태를 조회

## 로그

JSON 구조화 로그 공통 필드:

~~~json
{
  "timestamp": "2026-08-13T05:50:00Z",
  "level": "WARN",
  "service": "gateway",
  "traceId": "8a6ba949-f3ec-4916-aae2-d55bd787893d",
  "deviceId": "sensor-floor-03",
  "reasonCode": "CERTIFICATE_REVOKED",
  "latencyMs": 8
}
~~~

Secret, Token, Private Key, 전체 CSR·Certificate·Telemetry는 로그에서 제외한다.

## Event Outbox

- SQLite WAL Mode
- Event 생성과 Outbox 저장을 하나의 로컬 Transaction으로 처리
- 재시도: 지수 Backoff + 최대 간격
- Batch 크기와 Timeout은 환경변수
- 성공 응답 뒤 삭제
- Process 재시작 후 PENDING 항목 재개

## CI 준비

- 서비스별 Build·Test
- Compose Config
- Secret·Private Key·Environment File 검사
- E2E 임시 Key는 Job 실행 중 생성하고 Artifact로 업로드하지 않음
