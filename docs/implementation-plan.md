# 구현 계획

지원서 제출 목표: **2026년 8월 23일**

## 구현 원칙

화면별 완성이 아니라 실제 데이터가 처음부터 끝까지 흐르는 Vertical Slice로 진행한다. 각 단계가 실패하면 다음 단계보다 현재 흐름의 Test를 먼저 통과시킨다.

## 순서

### 0. Foundation — Issue #5

- Monorepo Directory, Build File, Compose Network·Volume
- PostgreSQL과 각 서비스 Health
- 환경변수 검증, Git Ignore, CI 최소 Build

완료 증거: 빈 서비스라도 전체 Build와 Compose Config가 성공한다.

### 1. Enrollment·PKI — Issue #1, #3 일부

- Device 등록과 단기 Enrollment Token
- Device Agent Key와 단일 SAN URI `urn:certgate:device:{device-key}` CSR 생성
- CSR 서명·SAN Device Key 검증
- 관리자 승인
- Certificate와 CA Chain 수령

완료 증거: Device 개인키가 서버로 이동하지 않고 Root CA 기준 Chain 검증이 성공한다.

### 2. 정상 mTLS 접근 — Issue #2, #3 일부

- Gateway TLS 1.3과 Client Certificate
- Access Context API
- SENSOR 정책
- Backend Proxy와 신뢰 Header
- REQUEST_ALLOWED Event

완료 증거: 정상 SENSOR의 Heartbeat가 Backend에 도착한다.

### 3. 차단·폐기 — Issue #2, #3

- 만료, 미등록, 비활성, 폐기, Role 불일치 차단
- Certificate 폐기와 Cache 무효화
- Reason Code 구조화 로그

완료 증거: 차단 요청이 Backend에 도착하지 않고 정확한 Reason Code가 남는다.

### 4. Event 신뢰성·SSE — Issue #6

- WAL Mode SQLite Durable Outbox에서 Security Event 생성·저장의 로컬 Transaction
- Commit된 Event 전송, 성공 시 삭제, 실패 시 보존·재시도
- Batch 재전송과 PostgreSQL 중복 방지
- Critical 판정
- React SSE 연결과 토스트

완료 증거: Management API 중단 전에 Event가 SQLite Durable Outbox에 보존되고, 복구 후 PostgreSQL에 한 번만 저장되며 CRITICAL Security Event가 SSE로 Console에 표시된다.

### 5. Console 연결 — Issue #7

- API 계약 기반 Mock을 실제 API로 교체
- Dashboard, Devices, Certificate Requests, Certificates, Security Events
- 승인·거절·폐기 동작
- 로딩·빈 상태·오류 상태

완료 증거: 핵심 관리 흐름이 Console에서 끝까지 동작한다.

### 6. E2E·제출 패키지 — Issue #4, #8

- 가상 Device A~F
- Docker Compose 단일 실행
- 정상·실패·장애 복구 시나리오
- README 실행법, 실제 화면, Test 결과, 한계
- AI 활용과 직접 검증 기록

## 날짜 기준 목표

| 날짜 | 목표 |
|---|---|
| 8/13 | 설계 기준선·개발 준비 완료 |
| 8/14 | Foundation |
| 8/15 | Device·Enrollment API |
| 8/16 | PKI 발급 흐름 |
| 8/17 | Gateway·Device 정상 mTLS |
| 8/18 | 정책·폐기·차단 |
| 8/19 | Event Outbox·중복 방지 |
| 8/20 | Console API 연결·SSE |
| 8/21 | E2E·Docker Compose |
| 8/22 | README·실제 캡처·지원 자료 |
| 8/23 | 최종 검증·제출 |

## 범위 Cut Line

반드시 완료:

- 정상 Certificate 발급과 mTLS 접근
- 폐기 Certificate 차단
- Role 기반 접근 차단
- Security Event 저장
- 5개 Console 화면의 실제 데이터 조회
- Docker Compose와 핵심 E2E

시간이 부족할 때 후순위:

- Invalid Certificate 반복 집계
- 복잡한 Chart
- Packet Capture 설명
- Cloud 배포
- 정책 수정 UI

MVP 제외:

- 외부 Webhook·메신저 알림
- Notification Outbox와 별도 Alert Domain

## 다음 작업

첫 구현 작업은 [Issue #5 Foundation](https://github.com/doidosid/certgate/issues/5)이다. UI 추가 설계는 하지 않고 API 계약과 실제 데이터에 맞춰 구현 중 조정한다.
