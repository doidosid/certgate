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

`internal/identity`에서 Device 로컬 Private Key(ECDSA P-256)·CSR 생성을 구현했다. CSR은 단일 SAN URI `urn:certgate:device:{device-key}`만 담고, Private Key는 `DEVICE_RUNTIME_DIR` 아래 `device.key`(0600)로 저장하며 재시작 시 재사용한다.

`internal/enrollment`에서 Enrollment Token으로 CSR을 제출하고, 관리자 승인까지 상태를 Polling한 뒤 Certificate·CA Chain을 수령하는 흐름을 구현했다(`docs/api-spec.md` §4, ADR-005). 수령한 Certificate·Chain은 `DEVICE_RUNTIME_DIR` 아래 `device.crt`·`ca-chain.crt`(0644)로 저장한다. 승인 대기 중에는 SIGINT/SIGTERM으로 정상 종료할 수 있다. mTLS Heartbeat·Telemetry 요청(`internal/client`)은 아직 구현하지 않았다(Gateway 구현 이후 진행).

## 개발 명령

~~~bash
go build ./...
go test ./...
gofmt -l .
~~~
