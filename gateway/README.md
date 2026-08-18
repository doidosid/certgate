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
