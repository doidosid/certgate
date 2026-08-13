# 보안 설계

## 1. 인증서 생명주기

```text
PENDING ── 승인·서명 ──► VALID ── 폐기 ──► REVOKED
    └────── 거절 ──────► REJECTED
VALID ── 유효기간 종료 ──► EXPIRED
```

- **PENDING**: CSR이 제출되어 관리자 결정을 기다리는 상태
- **VALID**: 발급이 완료되어 인증에 사용할 수 있는 상태
- **EXPIRED**: 인증서 유효기간이 종료된 상태
- **REVOKED**: 관리자가 신뢰를 철회한 상태
- **REJECTED**: 관리자가 발급 요청을 거절한 상태

## 2. CA 계층 구조

```text
Root CA
  └─ Intermediate CA
       └─ Device Certificate
```

- **Root CA**는 최상위 Trust Anchor다. Intermediate CA 인증서 서명에만 사용하고 평상시 발급 과정에서는 사용하지 않는다.
- **Intermediate CA**가 승인된 Device CSR에 서명해 실제 Device Certificate를 발급한다.
- Gateway는 Root CA를 신뢰 기준으로 삼고 Device Certificate부터 Intermediate CA, Root CA까지 이어지는 Chain을 검증한다.
- Root CA 개인키와 Intermediate CA 개인키는 모두 Git에서 제외한다.
- 포트폴리오 MVP에서는 파일 기반으로 운영하지만, Root CA 개인키는 별도 위치에 보관하고 실행 중인 Management API에는 Intermediate CA Key만 주입한다.
- 상용 환경의 HSM·KMS, Key Ceremony, CA 감사 통제는 구현 범위가 아니며 한계로 명시한다.

### 인증서 유효기간

| 인증서 | 유효기간 | 목적 |
|---|---:|---|
| Root CA | 10년 | 장기간 유지되는 최상위 Trust Anchor |
| Intermediate CA | 3년 | 실제 발급을 담당하며 Root CA보다 짧게 운영 |
| Device Certificate | 30일 | 짧은 수명으로 만료·갱신 필요성을 명확히 검증 |

- 발급 시점에 상위 CA의 남은 유효기간을 넘는 인증서를 만들지 않는다.
- MVP에서는 자동 갱신을 구현하지 않고 만료 감지와 차단을 우선 검증한다.
- 유효기간 값은 개발·테스트 환경 설정으로 변경할 수 있게 하되 기본값은 위 표를 따른다.

## 4. 인증서 발급

1. Device가 로컬에서 개인키를 생성한다.
2. Device가 할당받은 Device Identity를 이용해 CSR을 생성한다.
3. CSR을 Management API에 제출한다.
4. 관리자가 CSR을 검토해 승인 또는 거절한다.
5. 승인되면 Management API가 Private CA를 통해 CSR에 서명한다.
6. Device에는 인증서와 CA Chain만 전달한다. 개인키는 Device 밖으로 이동하지 않는다.

## 3. 인증

- Gateway는 TLS 1.3과 Client Certificate 필수를 적용한다.
- Private CA를 Trust Anchor로 사용한다.
- Device Identity는 인증서의 SAN URI에서 추출한 뒤 등록 정보와 대조한다.
- SAN URI 형식은 `urn:certgate:device:{device-id}`로 고정한다.
- Common Name은 사람을 위한 표시 정보로만 사용하며 인증 판단에 사용하지 않는다.

## 5. 인증서 폐기

MVP는 Management DB를 기준으로 폐기를 처리한다.

1. 관리자가 인증서를 `REVOKED`로 변경한다.
2. Gateway가 TLS Handshake 후 인증서 Serial Number로 상태를 확인한다.
3. 폐기 상태라면 Backend로 전달하지 않고 `CERTIFICATE_REVOKED` 이벤트를 남긴다.
4. Gateway는 짧은 TTL Cache를 사용하고, 폐기 시 해당 Cache를 무효화한다.

CRL과 OCSP는 제출 이후 확장 기능으로 둔다.

## 6. 접근제어

접근제어는 Device Role과 HTTP Method·Path 규칙을 사용한다.

| Role | 허용 동작 |
|---|---|
| SENSOR | `POST /telemetry`, `POST /heartbeat` |
| OPERATOR | SENSOR 동작 + `GET /commands` |
| ADMIN_DEVICE | Device용 관리 동작. 상세 범위는 추후 확정 |

정책 원칙:

- 기본 결과는 **DENY**다.
- mTLS 인증 성공이 모든 API 접근 허용을 의미하지 않는다.
- Gateway가 Method와 정규화된 Path를 이용해 정책을 평가한다.
- Backend에 전달하는 신뢰된 Identity Header는 Gateway만 생성한다.

## 7. Security Event 사유 코드

- `CERTIFICATE_REQUIRED`
- `INVALID_CERTIFICATE`
- `CERTIFICATE_EXPIRED`
- `CERTIFICATE_REVOKED`
- `DEVICE_NOT_REGISTERED`
- `DEVICE_DISABLED`
- `ACCESS_DENIED`
- `REQUEST_ALLOWED`
- `INTERNAL_ERROR`

이벤트에는 발생 시각, Device ID, 인증서 Serial Number, Method, Path, 처리 결과, 사유, Client IP, 처리 시간을 기록한다.

## 8. 명시적인 한계

CertGate는 상용 CA 보안을 구현했다고 주장하지 않는다. CA Key 보호, 감사 로그 무결성, 분산 폐기 검증, 자동 갱신, Rate Limit, Replay Protection, HA는 후속 개선 사항으로 문서화한다.
