# 요구사항 정의 v1

## 프로젝트 목표

CertGate는 신뢰할 수 없는 네트워크에서 X.509 Certificate로 Device 신원을 확인하고, 인증·인가를 통과한 요청만 내부 서비스로 전달하는 보안 Gateway와 관리 플랫폼이다.

특정 회사 제품을 복제하지 않고 **“서버는 접속한 네트워크 Device를 어떻게 신뢰할 수 있는가?”**를 일반 장비 관리 환경으로 재해석한다.

## 행위자

- **Device Agent**: Private Key·CSR 생성, Certificate 수령·보관, mTLS 요청
- **Administrator**: Device 등록, CSR 승인·거절, Certificate 폐기, Role 지정, Event 확인
- **Security Gateway**: Certificate·Device·Policy 검증과 Backend Proxy
- **Backend Service**: Gateway가 허용한 요청만 수신

## 핵심 시나리오

1. 관리자가 Device를 등록하고 단기 Enrollment Token을 전달한다.
2. Device가 로컬에서 Private Key와 CSR을 생성한다.
3. Device가 Token으로 CSR을 제출한다.
4. 관리자가 CSR을 승인한다.
5. Intermediate CA가 Device Certificate를 발급한다.
6. Device가 Certificate와 CA Chain을 수령한다.
7. Device가 Gateway에 TLS 1.3 mTLS로 접속한다.
8. Gateway가 Certificate, Device 상태, Role Policy를 검증한다.
9. 허용 요청만 Backend로 전달한다.
10. 결과를 Security Event로 저장하고 CRITICAL Event는 SSE로 알린다.

## 기능 요구사항

- **FR-01**: 관리자는 Device를 등록·조회하고 단기 Enrollment Token을 재발급할 수 있다.
- **FR-02**: Device는 자기 Private Key와 CSR을 생성하고 Token으로 CSR을 제출할 수 있다.
- **FR-03**: 관리자는 CSR을 조회·승인·거절할 수 있다.
- **FR-04**: Device는 승인된 Certificate와 CA Chain을 수령할 수 있다.
- **FR-05**: Device는 TLS 1.3 mTLS로 Gateway에 접속한다.
- **FR-06**: Gateway는 CA Chain, 유효기간, SAN URI Identity, 등록 상태를 검증한다.
- **FR-07**: Gateway는 Role과 HTTP Method·Path Policy를 검증하며 기본 DENY를 적용한다.
- **FR-08**: 허용 요청만 Backend로 전달한다.
- **FR-09**: 접근 허용·차단·오류 결과를 Security Event로 기록한다.
- **FR-10**: 관리자는 Certificate를 폐기할 수 있고 폐기 Certificate는 접근할 수 없다.
- **FR-11**: Console은 Device, CSR, Certificate, Security Event를 조회한다.
- **FR-12**: CRITICAL Security Event를 접속 중인 Console에 SSE로 전송한다.
- **FR-13**: SSE 알림 클릭 시 원본 Security Event 상세로 이동한다.
- **FR-14**: 별도 Alert Resource와 상태 관리 화면은 만들지 않는다.

## 비기능 요구사항

- Device Private Key는 Device 밖으로 이동하지 않는다.
- Enrollment Token 평문은 생성 응답 외에 저장·로그 출력하지 않는다.
- Root·Intermediate CA Key, Service Token, 실제 .env는 Git에 올리지 않는다.
- Access Context를 확인할 수 없으면 Fail Closed한다.
- Management API 장애 중 Security Event를 Gateway SQLite Outbox에 보관한다.
- Event ID로 중복 저장을 방지한다.
- 핵심 정상·실패·장애 복구 시나리오는 자동 Test로 검증한다.
- 문서화된 명령으로 새 환경에서 흐름을 재현할 수 있어야 한다.
- 제출 버전은 단일 노드이며 상용 HA를 주장하지 않는다.

## MVP 제외 범위

- 관리자 로그인·권한과 인터넷 공개
- 실제 V2X·SCMS
- CRL·OCSP
- DTLS·VPN·IPSec
- HSM·KMS
- 자동 Certificate 갱신
- 외부 메신저·이메일·Webhook
- 멀티테넌시·HA·분산 Cache
