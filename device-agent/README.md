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

`internal/enrollment`에서 Enrollment Token으로 CSR을 제출하고, 관리자 승인까지 상태를 Polling한 뒤 Certificate·CA Chain을 수령하는 흐름을 구현했다(`docs/api-spec.md` §4, ADR-005). 수령한 Certificate·Chain은 `DEVICE_RUNTIME_DIR` 아래 `device.crt`·`ca-chain.crt`(0644)로 저장한다. 승인 대기 중에는 SIGINT/SIGTERM으로 정상 종료할 수 있다.

시작 시 `DEVICE_RUNTIME_DIR`에 `device.key`·`device.crt`·`ca-chain.crt`가 모두 있고, `device.crt`가 로컬 Private Key 및 설정된 `DEVICE_KEY`의 SAN URI(`urn:certgate:device:{device-key}`)와 일치하며, 아직 만료되지 않았으면(`internal/identity.HasValidCertificate`) Enrollment를 건너뛰고 기존 인증서를 그대로 쓴다. 그렇지 않으면(인증서가 없거나, 다른 Device Key의 것이거나, 실제로 만료됐으면) 위 Enrollment 흐름을 다시 수행하며, 이때만 `DEVICE_ENROLLMENT_TOKEN`이 필요하다 — 이미 유효한 인증서로 재사용만 하는 경우에는 설정하지 않아도 된다. 만료 전에 미리 갱신을 시도하는 로직은 의도적으로 두지 않았다(자동 Certificate 갱신은 MVP 제외 범위 — `docs/requirements.md`, `docs/adr/003-certificate-validity.md` "제출용 MVP는 자동 갱신보다 만료 감지와 접속 차단을 우선 구현한다"). 인증서가 실행 중 만료되면 Gateway가 그 시점의 mTLS Handshake에서 차단한다.

인증서 확보 후 `internal/client`가 `device.crt`+`device.key`로 Gateway에 mTLS 연결하고(`ca-chain.crt`를 서버 인증서 검증용 CA Pool로 사용, `InsecureSkipVerify` 미사용), `GATEWAY_URL` 기준 `POST /heartbeat`를 `HEARTBEAT_INTERVAL`(기본 30초) 주기로 반복 전송한다. Gateway 연결 실패는 다음 주기에 재시도할 뿐 Tight Loop를 돌지 않으며, SIGINT/SIGTERM 시 현재 반복이 끝나는 대로 정상 종료한다.

**현재 한계**: 실행 중 인증서가 만료되면 재시작 전까지는 Heartbeat 실패가 계속된다 — 자동 갱신은 위에서 설명한 대로 의도적으로 범위 밖이다. 재시도는 고정 Interval 방식이며 지수 Backoff는 두지 않았다(`gateway`의 기존 주기 작업들과 동일한 방식).

## 개발 명령

~~~bash
go build ./...
go test ./...
gofmt -l .
~~~
