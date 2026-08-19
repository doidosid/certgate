# Security Gateway

Go 기반 mTLS Reverse Proxy다.

첫 구현 범위:

1. TLS 1.3과 Client Certificate 필수
2. SAN URI Device Identity 추출
3. Management API Access Context 조회와 30초 Cache
4. Role + Method + Path 기본 DENY
5. 외부 Identity Header 제거·재생성
6. Security Event 생성과 SQLite Outbox

## 현재 상태

Phase 2("정상 mTLS 접근", Issue #2) 구현 완료:

- TLS 1.3 mTLS Listener (`tlsauth`): Client Certificate 필수, SAN URI에서 Device Key·Serial 추출
- Access Context 조회와 30초 TTL Cache (`access`, `management`): 유효한 Cache가 없고 조회도 실패하면 Fail Closed
- SENSOR·OPERATOR Method/Path 정책과 기본 DENY (`policy`)
- 외부 `X-CertGate-Device-Key`/`X-CertGate-Role` Header 제거 후 Gateway가 재생성, Backend Reverse Proxy (`proxy`)
- Security Event 생성과 WAL Mode SQLite Durable Outbox, Batch 재전송(지수 Backoff) (`event`, `outbox`)
- Gateway 내부 Cache 무효화 API(`POST /internal/cache/invalidations`)

Phase 4("Event 신뢰성", Issue #6) Gateway 잔여 구현 완료:

- Outbox 자기 관찰(`outbox.Monitor`): 10초마다 대기 수·최고 지연을 **한 SQL로 함께** 읽어 임계치(100건, 60초)를 새로 넘는 순간 CRITICAL SYSTEM Security Event(`EVENT_OUTBOX_BACKLOG`, `EVENT_DELIVERY_DELAYED`)를 만든다. 같은 장애가 계속되는 동안 매 Tick마다 Event를 쌓지 않도록 Edge Trigger로 동작하고, 값이 임계치 아래로 내려가면 다시 무장한다. 저장에 실패한 Event는 그 사이 Outbox가 비워져 임계치가 해소되더라도 저장에 성공할 때까지 재시도한다 — 한 번 발생한 breach는 기록이 남아야 한다.
- Outbox 쓰기 실패는 `outboxPersisted=false`를 포함한 구조화 로그로 남긴다(`docs/architecture.md` 장애 원칙: 실패한 Event를 보존됐다고 간주하지 않는다).
- Outbox 상태 조회 API(`GET /internal/outbox/stats`): Dashboard의 `outbox` 항목(`pendingCount`, `oldestAgeSeconds`)을 Management API가 채울 수 있게 노출한다. Cache 무효화와 같은 Internal Token을 쓰고 내부 Listener에만 붙는다.

Monitor가 만든 Event도 자신이 관찰하는 그 Outbox를 통해 전송된다. 전송이 막혀 있는 동안에는 다른 Event와 함께 Outbox에 남아 있다가 복구 후 Management API에 도착하며, 그 사이에도 Gateway 구조화 로그에는 즉시 남는다.

아직 없는 것(Issue #3에 Certificate 폐기 API가 추가되어야 실제로 동작):

- Certificate 폐기 자체가 없어 `certificateStatus=REVOKED` 경로는 Access Context가 그 값을 내려줄 때만 검증된다(단위/통합 테스트에서는 확인됨).
- TLS Handshake 단계 실패(다른 CA, 인증서 없음)는 Go 표준 라이브러리의 기본 Handshake 오류 로그로만 기록되고, 구조화된 Security Event로는 전환하지 않는다(docs/security-design.md §5의 명시적 범위 제한).

## 아키텍처 메모

Handler(`accessHandler`, `cmd/gateway`)는 SAN URI 추출 → Access Context 조회 → 정책 판정 → Header 재생성 → Proxy 순으로 위 Package들을 조합만 하고, 판정 규칙 자체는 각 Package(`policy`, `access`)에 있다.

## 개발 명령

~~~bash
go build ./...
go test ./...
gofmt -l .
~~~
