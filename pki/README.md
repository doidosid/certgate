# PKI

개발·테스트용 Root CA, Intermediate CA, Gateway·Device Certificate Script를 둔다.

규칙:

- Script와 OpenSSL Config만 Commit
- Private Key, CSR, Certificate 산출물은 Runtime Directory에 생성
- Root CA Key는 Intermediate CA 발급 외 과정에서 사용하지 않음
- Test는 매 실행마다 임시 PKI를 생성

## 현재 상태

Root CA(10년)·Intermediate CA(3년) 초기화와 Gateway 서버 인증서(1년) 발급 Script를 구현했다. Device Certificate는 Management API가 CSR 승인 시 Intermediate CA로 발급하므로 별도 Script가 없다.

## 실행

~~~bash
./scripts/init-ca.sh                        # pki/runtime(Git 제외)에 CA 생성
./scripts/init-ca.sh /tmp/some-dir          # 임의 출력 경로 지정
./scripts/issue-gateway-cert.sh             # 같은 디렉터리에 gateway.crt/key 발급
./scripts/test_init_ca.sh                   # 임시 디렉터리에 생성 후 Chain 검증
./scripts/test_issue_gateway_cert.sh        # Gateway 인증서 Chain·SAN·확장 검증
~~~

`init-ca.sh`는 Root CA Key로 Intermediate CA만 서명하고 종료한다. 출력물: `root-ca.crt`, `root-ca.key`, `intermediate-ca.key`, `intermediate-ca.crt`, `ca-chain.crt`.

`issue-gateway-cert.sh`는 Intermediate CA로 Gateway의 TLS 서버 인증서를 서명한다(Root CA Key를 읽지 않는다). SAN은 `DNS:gateway`(Compose 네트워크), `DNS:localhost`·`IP:127.0.0.1`(Host)이다.

유효기간 1년은 [ADR-003](../docs/adr/003-certificate-validity.md)에 없는 값이다. 그 ADR은 Root CA(10년)·Intermediate CA(3년)·Device Certificate(30일)만 정하고 Gateway 서버 인증서를 다루지 않으므로, "발급 인증서의 유효기간은 상위 CA의 남은 유효기간을 넘지 않는다"는 규칙만 지켜 정했다.

## Compose 주입

`infra/compose.yaml`은 `pki/runtime`의 파일을 **파일 단위 읽기 전용**으로 mount한다. 디렉터리를 통째로 mount하지 않는 이유는 그 안에 `root-ca.key`가 함께 있기 때문이다.

| 서비스 | 주입되는 자료 |
|---|---|
| `gateway` | `root-ca.crt`, `gateway.crt`, `gateway.key` |
| `management-api` | `root-ca.crt`, `intermediate-ca.crt`, `intermediate-ca.key` |

`root-ca.key`는 어느 실행 서비스에도 들어가지 않는다([security-design.md §3](../docs/security-design.md)). `compose-smoke` CI Job이 두 컨테이너에 그 파일이 없는지 매번 확인한다.

Compose로 스택을 띄우기 전에 위 두 Script를 먼저 실행해야 한다. CI는 `compose-smoke` Job이 Job 실행 중에 생성하고 Artifact로 올리지 않는다([operations.md](../docs/operations.md) "CI 준비").
