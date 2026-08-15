# ADR-001: Device Identity를 SAN URI에 저장

- **상태**: 확정
- **결정일**: 2026-08-13

## 배경

Gateway는 mTLS 인증을 마친 인증서에서 Device Identity를 안전하고 일관되게 추출해야 한다. HTTP Header나 Payload의 Device Key는 Device가 임의로 작성할 수 있으므로 신뢰하지 않는다.

## 결정

Device Identity는 X.509 인증서의 **Subject Alternative Name(SAN) URI**에 저장한다.

```text
urn:certgate:device:{device-key}
```

예시:

```text
urn:certgate:device:sensor-floor-01
```

Device Key는 Management API에 등록되는 변경 불가 식별자다. Management API 내부 Resource UUID인 `deviceId`와 구분하며, 인증 판단에는 Device Key를 사용한다.

Gateway는 SAN URI 중 `urn:certgate:device:` Prefix와 정확히 일치하는 값을 하나만 허용하고, 뒤의 Device Key를 Management API의 등록 정보와 대조한다.

Common Name(CN)은 표시용으로만 사용하고 인증 판단에는 사용하지 않는다.

## 선택 이유

- 인증서의 Identity 용도를 명확하게 표현할 수 있다.
- CN과 달리 구조화된 식별자를 담기 적합하다.
- 향후 Device 종류나 Tenant 식별 체계를 확장하기 쉽다.
- Device가 요청에 직접 넣은 값이 아니라, CA가 서명한 인증서에서 Identity를 얻을 수 있다.

## 검증 규칙

- 허용 Prefix는 `urn:certgate:device:` 하나다.
- SAN URI가 없거나 두 개 이상이면 인증을 거부한다.
- Prefix 뒤의 Device Key가 비어 있으면 인증을 거부한다.
- SAN URI의 Device Key가 등록된 변경 불가 `deviceKey`와 정확히 일치하지 않으면 인증을 거부한다.
