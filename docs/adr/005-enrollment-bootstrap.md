# ADR-005: 단기 Enrollment Token으로 최초 인증서 요청 보호

- 상태: 승인
- 날짜: 2026-08-13

## 배경

인증서가 없는 Device는 아직 mTLS로 자신을 증명할 수 없다. 등록된 Device Key만 CSR에 넣는 방식은 공격자가 다른 Device를 사칭해 CSR을 제출할 수 있다.

## 결정

- Device 등록 시 24시간 유효한 무작위 Enrollment Token을 발급한다.
- 평문 Token은 생성 응답에서 한 번만 보여주고 DB에는 SHA-256 Hash만 저장한다.
- Token은 해당 Device의 CSR 제출·상태 조회·Certificate 수령에만 사용한다.
- CSR의 SAN URI가 Token에 연결된 Device Key와 정확히 일치해야 한다.
- Token 재발급 시 이전 활성 Token을 폐기한다.
- 관리자 로그인은 별도 과제로 두고 MVP API는 외부에 공개하지 않는다.

## 결과

장점:

- 최초 인증서 발급 전에 최소한의 Device 소유 증명을 제공한다.
- Private Key는 Device 밖으로 이동하지 않는다.
- Enrollment 권한 범위를 인증서 발급 흐름으로 제한한다.

비용:

- Token 전달과 만료·폐기 상태가 추가된다.
- 상용 환경의 제조 시점 Provisioning이나 Hardware Identity를 대체하지는 못한다.
