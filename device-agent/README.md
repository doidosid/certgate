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

`internal/identity`에서 Device 로컬 Private Key(ECDSA P-256)·CSR 생성을 구현했다. CSR은 단일 SAN URI `urn:certgate:device:{device-key}`만 담고, Private Key는 `DEVICE_RUNTIME_DIR` 아래 `device.key`(0600)로 저장하며 재시작 시 재사용한다. Enrollment Token으로 CSR을 제출하고 상태를 Polling하는 부분과 mTLS 요청은 아직 구현하지 않았다.

## 개발 명령

~~~bash
go build ./...
go test ./...
gofmt -l .
~~~
