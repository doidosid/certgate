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

인증서 확보 후 `internal/client`가 `device.crt`+`device.key`로 Gateway에 mTLS 연결하고(`ca-chain.crt`를 서버 인증서 검증용 CA Pool로 사용, `InsecureSkipVerify` 미사용), `GATEWAY_URL` 기준 `POST /heartbeat`를 `HEARTBEAT_INTERVAL`(기본 30초) 주기로 반복 전송한다.

**Heartbeat 실패를 일시적 장애와 영구적 인증 실패로 구분한다**(`internal/client.FailureKind`):

- **일시적(`RETRYING`)**: Connection 실패·Timeout, HTTP 5xx, 그 외 알 수 없는 응답. `HEARTBEAT_INTERVAL`부터 시작해 실패마다 2배, 최대 5분(`maxBackoffInterval`)까지 늘어나는 Exponential Backoff로 재시도한다. 성공하면 즉시 기본 Interval로 복귀하고 `RUNNING` 상태가 된다. 동일한 오류가 반복되는 동안에는 상태 전이 로그를 한 번만 남기고 매 시도마다 다시 찍지 않는다.
- **영구적(`AUTH_FAILED`/`REENROLL_REQUIRED`)**: HTTP 401/403 중 Body의 `code`가 `CERTIFICATE_REVOKED`·`CERTIFICATE_EXPIRED`면 `REENROLL_REQUIRED`(새 인증서로만 복구 가능), 그 외 401/403(`DEVICE_DISABLED` 등)이면 `AUTH_FAILED`(재발급으로 해결 안 될 수 있음)로 분류한다. 또한 **자기 인증서의 `NotAfter`를 매 Heartbeat 전에 로컬에서 직접 확인**해, 실제로 만료됐으면 서버 응답을 기다리지 않고 바로 `REENROLL_REQUIRED`로 분류한다 — 달력상 만료된 인증서는 Gateway의 TLS Handshake 단계에서 거부되어 애초에 파싱 가능한 HTTP 응답으로 도달하지 않기 때문이다(`docs/security-design.md` §5). 두 상태 모두 도달 시 **Heartbeat 반복을 완전히 멈추고**, Agent 프로세스는 종료하지 않은 채 SIGINT/SIGTERM까지 조용히 대기한다(동일 오류의 무한 반복과 Gateway Security Event 양산을 막기 위함 — 재시작해도 로컬 유효성 검사만으로는 서버 측 폐기 여부를 알 수 없어 똑같은 상태로 돌아가므로, 재시작 자체가 해결책이 아니다).

상태는 `internal/client.State`(단순 문자열 상수: `STARTING`·`ENROLLING`·`RUNNING`·`RETRYING`·`AUTH_FAILED`·`REENROLL_REQUIRED`·`STOPPING`)로 로그에 남는다 — 별도 State Machine 프레임워크 없이, 전이 시점에만 로그를 찍는 수준으로 단순하게 구현했다. `RUNNING`도 예외가 아니다 — 매 Heartbeat 성공마다 찍지 않고 그 상태로 처음 들어올 때(기동 직후, 또는 `RETRYING`에서 복구된 직후)만 한 번 찍는다. 실 서비스 규모(장비 수천 대, 짧은 주기)에서 "계속 정상"이라는 똑같은 로그가 무한히 쌓이는 걸 막기 위함이다 — 생존 확인이 필요하면 Management API 쪽 "마지막 접속 시각"을 보는 게 맞는 방식이라고 판단했다.

SIGINT/SIGTERM 시 현재 반복(또는 대기)이 끝나는 대로 정상 종료한다.

**현재 한계**: `REENROLL_REQUIRED` 도달 후 자동으로 새 CSR을 제출하는 기능은 이번에 구현하지 않았다 — Agent를 멈추고 운영자가 새 Enrollment Token을 발급받아 수동으로 재실행해야 한다. 향후 자동 재발급을 붙인다면 `cmd/device-agent/main.go`의 `client.Run` 콜백에서 `client.StateReenrollRequired`를 받는 지점이 그 진입점이다.

## 개발 명령

~~~bash
go build ./...
go test ./...
gofmt -l .
~~~
