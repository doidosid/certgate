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

- PostgreSQL과 Backend Service는 Host Port를 공개하지 않는다. 로컬 디버깅용 <code>infra/compose.local.yaml</code> Override를 함께 쓸 때만 PostgreSQL을 Host loopback(<code>127.0.0.1:${POSTGRES_PORT}</code>)에 연다. CI와 기본 실행은 이 Override를 쓰지 않는다.
- 관리자 인증 구현 전 Management API는 개발 PC 밖에 공개하지 않는다.
- Gateway 외부 Port와 내부 관리 Port를 분리한다.

## Volume

- <code>postgres-data</code>
- <code>gateway-outbox</code>
- Runtime Certificate·Key Directory는 Git 밖에서 Mount

Root CA Key는 실행 Compose에 Mount하지 않는다. Management API에는 Intermediate CA 자료만 주입한다.

## Health

- Gateway: `GET /healthz`(내부 Port, Process Liveness — 항상 200)와 `GET /readyz`(내부 Port, Readiness — Management API에 주기적으로(10초) `/actuator/health`를 Ping해 마지막 결과를 반영, 실패 시 503)를 분리한다(Issue #36). Compose healthcheck는 `/healthz`를 그대로 쓴다 — Readiness를 Compose healthcheck에 물리면 일시적인 Management API 장애에도 Gateway Container가 재시작되어 Outbox 전송이 끊긴다.
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
  "deviceKey": "sensor-floor-03",
  "reasonCode": "CERTIFICATE_REVOKED",
  "latencyMs": 8
}
~~~

Secret, Token, Private Key, 전체 CSR·Certificate·Telemetry는 로그에서 제외한다.

## Event Outbox

- SQLite WAL Mode
- Event 생성과 Outbox 저장을 하나의 로컬 Transaction으로 처리
- Outbox Transaction Commit 후 Management API 전송 시도
- 재시도: 지수 Backoff + 최대 간격
- Batch 크기와 Timeout은 환경변수
- 성공 응답 뒤 삭제
- 전송 실패 시 삭제하지 않고 보존
- Process 재시작 후 PENDING 항목 재개

## Security Event 보관

- `SECURITY_EVENT_RETENTION_DAYS`로 보관 기간(일)을 정한다. `0`이면 무기한 보관하며, 설정하지 않았을 때의 기본값이다. `.env.example`은 `90`이다.
- `0`이 아니면 최소 7일이다. 음수나 1~6이면 Management API가 기동하지 않는다. Management API가 며칠 멈춰도 Gateway Outbox에 쌓인 Event가 복구 뒤 버려지지 않게 하기 위해서다.
- 기준은 `occurred_at`(Gateway가 Event를 만든 시각)이다. 매일 03:30 UTC에 `occurred_at`이 보관 기간보다 오래된 Event를 1,000건씩 나눠 각각 별도 Transaction으로 삭제한다.
- 보관 기간이 이미 지난 Event가 Batch로 늦게 도착하면 저장하지 않고 `200 OK`로 응답한다(`expiredCount`). Gateway는 이 Event를 Outbox에서 지운다. 저장하지 않으므로 CRITICAL SSE 알림과 Device `last_seen_at` 갱신도 일어나지 않는다.
- 관리자 인증이 생긴 뒤 ADMIN만 바꿀 수 있는 Console 설정 화면을 추가한다(`docs/deployment-roadmap.md` Phase 1 이후). 그 전에는 환경변수로만 바꾼다.

## CI 준비

- 서비스별 Build·Test
- Compose Config
- Secret·Private Key·Environment File 검사
- E2E 임시 Key는 Job 실행 중 생성하고 Artifact로 업로드하지 않음
