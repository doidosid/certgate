# Device Agent

Go 기반 가상 Device Client다.

첫 구현 범위:

1. 로컬 Private Key 생성
2. SAN URI를 포함한 CSR 생성
3. Enrollment Token으로 CSR 제출
4. 승인 상태 Polling과 Certificate·Chain 저장
5. mTLS Heartbeat·Telemetry 요청

Private Key와 Runtime Certificate는 이 Directory 아래가 아닌 Git 제외 Runtime 경로에 저장한다.

## 현재 상태

Foundation 단계: `cmd/device-agent`와 `internal/{config,identity,enrollment,client}` 골격, 환경변수 검증만 구현했다. Key·CSR 생성, Enrollment, mTLS 요청은 아직 구현하지 않았다.

## 개발 명령

~~~bash
go build ./...
go test ./...
gofmt -l .
~~~
