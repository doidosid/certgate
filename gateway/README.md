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

Foundation 단계: `cmd/gateway`가 내부 Port에서 `GET /healthz`만 제공한다. TLS 1.3 mTLS Listener, Access Context 조회, Policy 평가, Proxy, Outbox는 아직 구현하지 않았다.

## 개발 명령

~~~bash
go build ./...
go test ./...
gofmt -l .
~~~
