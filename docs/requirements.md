# 요구사항 정의

## 1. 프로젝트 목표

CertGate는 신뢰할 수 없는 네트워크에서 X.509 인증서로 디바이스의 신원을 확인하고, 인증과 인가를 통과한 요청만 내부 서비스로 전달하는 보안 게이트웨이 및 관리 플랫폼이다.

특정 회사의 제품을 복제하는 것이 아니라, 기업 분석 과정에서 발견한 **“서버는 접속한 네트워크 디바이스를 어떻게 신뢰할 수 있는가?”**라는 문제를 일반 네트워크 장비 관리 환경에 맞게 재해석한다.

## 2. 주요 행위자

- **Device Agent**: 개인키와 인증서를 보유하고 Gateway에 접속하여 Heartbeat·Telemetry를 전송한다.
- **Administrator**: Device 등록, CSR 승인, 인증서 폐기, Role 지정, 보안 이벤트 확인을 수행한다.
- **Backend Service**: Gateway가 허용한 요청만 전달받는 내부 서비스다.

## 3. 핵심 시나리오

1. 관리자가 Device를 등록한다.
2. Device가 개인키와 CSR(Certificate Signing Request)을 생성한다.
3. 관리자가 콘솔에서 CSR을 승인한다.
4. Private CA가 CSR에 서명하여 Device 인증서를 발급한다.
5. Device가 인증서를 이용해 Gateway에 mTLS로 접속한다.
6. Gateway가 인증서·Device 상태·접근 정책을 검증한다.
7. 허용된 요청만 Backend Service로 전달한다.
8. 허용 또는 차단 결과를 Security Event로 기록한다.

## 4. 기능 요구사항

- **FR-01**: 관리자는 Device를 등록하고 조회할 수 있다.
- **FR-02**: Device는 개인키와 CSR을 생성하고, 관리자는 CSR을 승인·거절하고 발급된 인증서를 내려받을 수 있다.
- **FR-03**: Device는 TLS 1.3과 mTLS를 이용해 Gateway에 접속한다.
- **FR-04**: Gateway는 발급 CA, 유효기간, 등록된 Device Identity를 검증한다.
- **FR-05**: Gateway는 Device Role과 HTTP Method·Path 기반 접근 정책을 검증한다.
- **FR-06**: 허용된 요청만 Backend Service로 전달한다.
- **FR-07**: 인증 실패와 접근 허용·차단 결과를 Security Event로 기록한다.
- **FR-08**: 관리자는 발급된 인증서를 폐기할 수 있다.
- **FR-09**: 폐기된 인증서는 Backend Service에 접근할 수 없다.
- **FR-10**: 관리 콘솔에서 Device·CSR·인증서·보안 이벤트를 확인할 수 있다.
- **FR-11**: Critical 등급의 Security Event가 발생하면 접속 중인 관리 콘솔에 SSE로 실시간 알림을 전송한다.
- **FR-12**: 실시간 알림을 클릭하면 원인이 된 Security Event 상세로 이동하며, 별도의 Alert 데이터나 상태는 관리하지 않는다.

## 5. 비기능 요구사항

- Device 개인키는 Device에서 생성하며 Management API가 생성하거나 저장하지 않는다.
- CA 개인키는 실행 환경에 별도로 주입하며 Git에 올리지 않는다.
- 새 환경에서도 문서화된 명령으로 실행 과정을 재현할 수 있어야 한다.
- 핵심 허용·차단 시나리오는 자동 테스트로 검증한다.
- Management API 장애 중에도 Security Event가 유실되지 않도록 Gateway의 영속 Outbox에 보관한다.
- Security Event는 고유 ID를 기준으로 중복 저장을 방지하고 전송 실패 시 재시도한다.
- 로그에 개인키, 비밀번호, 전체 민감 Payload를 남기지 않는다.
- 제출 버전은 단일 노드 포트폴리오 시스템이며 상용 수준의 HA를 목표로 하지 않는다.

## 6. 제출용 MVP 제외 범위

- 실제 V2X 프로토콜 또는 SCMS 구현
- CRL 배포와 OCSP Responder
- DTLS, VPN, IPSec
- HSM·KMS 연동
- 멀티테넌시와 관리자 로그인·권한 관리
- 외부 메신저·이메일·Webhook 알림
- 고가용성, 자동 인증서 갱신
