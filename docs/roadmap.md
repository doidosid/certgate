# 개발 로드맵

지원서 제출 목표: **2026년 8월 23일**

## 제출 가능한 상태의 기준

- Device가 CSR을 생성하고 승인된 인증서를 발급받는다.
- 정상 Device가 mTLS 인증 후 Gateway를 통해 Backend에 접근한다.
- 인증서 없음, 다른 CA, 만료, 폐기 인증서는 Backend에 접근하지 못한다.
- 정상 인증서라도 권한이 없는 요청은 차단된다.
- Device·인증서·Security Event가 React 관리 콘솔에 표시된다.
- 핵심 시나리오를 명령 또는 자동 테스트로 재현할 수 있다.
- README에서 구현 완료·진행 중·예정 기능을 명확히 구분한다.
- CA 개인키, Device 개인키, Credential, 개인정보가 Git에 포함되지 않는다.

## Phase 0 - 설계

- 요구사항, 아키텍처, 보안 정책, API, 데이터 모델 확정
- 인증서 Identity와 폐기 Cache 방식 ADR 작성
- 설계를 GitHub Issue로 분해

## Phase 1 - 핵심 보안 흐름

- Go Device의 개인키·CSR 생성
- Private CA 초기화 Script
- Go Gateway의 TLS 1.3·mTLS
- 최소 Backend Service
- 정상·비정상 인증서 테스트

## Phase 2 - 관리 영역

- Spring Boot와 PostgreSQL 구성
- Device 등록
- CSR 승인과 인증서 발급
- 인증서 상태 조회와 폐기
- Gateway용 Access Context 조회
- SQLite Durable Event Outbox와 재전송
- Security Event 중복 방지 저장
- Critical Security Event 판정과 SSE 실시간 전송

## Phase 3 - 관리 콘솔

- Dashboard
- Devices
- Certificate Requests
- Certificates
- Security Events
- 전역 Critical Event 토스트 알림

## Phase 4 - 포트폴리오 완성도 강화

- Docker Compose
- End-to-End 시나리오 Script
- 가상 Device A~F를 이용한 정상·실패 시나리오
- Management API 장애·복구와 Outbox 재전송 테스트
- 패킷 캡처와 TLS 실패 원인 분석
- 화면 캡처와 아키텍처 다이어그램
- 구현 상태, 한계, 기술 선택 문서화
- AI 활용 및 직접 검증 기록

## 제출 이후

- 정책 수정 UI
- Cloud 배포와 운영 Monitoring
- 외부 메신저·이메일·Webhook 알림
- Rate Limit과 성능 테스트
- CRL·OCSP
- Message Signing과 Replay Protection
- C++ Test Client 또는 Linux Network Stack 심화 학습

## 범위 원칙

연결되지 않은 기능 여러 개보다 **처음부터 끝까지 동작하는 하나의 흐름**을 우선한다. 완료되지 않은 기능은 반드시 진행 중 또는 예정으로 표시한다.
