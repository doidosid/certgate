# 전체 아키텍처 v1

## 컴포넌트

| 컴포넌트 | 기술 | 책임 |
|---|---|---|
| Device Agent | Go | Enrollment, Key·CSR 생성, Certificate 저장, mTLS 요청 |
| Security Gateway | Go | TLS 종료, X.509·Device·Policy 검증, Proxy, Event Outbox |
| Management API | Spring Boot | Device·Enrollment·PKI·Policy·Event 관리, SSE |
| Admin Console | React | 관리 API 소비와 Critical Event 표시 |
| PostgreSQL | PostgreSQL | 관리 영역 Source of Truth |
| Private CA | OpenSSL 기반 | 승인 CSR에 대한 Intermediate CA 서명 |
| Backend Service | Go 최소 HTTP | 허용 요청 도착 여부 검증 |

## 발급 흐름

~~~text
Administrator → Management API: Device 등록
Management API → Administrator: Enrollment Token 한 번 반환
Device Agent → Device Agent: Private Key + CSR 생성
Device Agent → Management API: Token으로 단일 SAN URI urn:certgate:device:{device-key} CSR 제출
Administrator → Management API: CSR 승인
Management API → Intermediate CA: CSR 서명
Device Agent → Management API: Certificate + Chain 수령
~~~

## 접근 흐름

~~~text
Device Agent
    │ HTTPS / TLS 1.3 / mTLS
    ▼
Security Gateway ── Access Context 조회 ──► Management API ──► PostgreSQL
    │
    │ 허용 요청 + Gateway 생성 Identity Header
    ▼
Backend Service

Security Gateway ── SQLite Durable Outbox(WAL) 저장 ── Batch 전송 ──► Management API
Management API ── Security Event 저장·CRITICAL 판단 ── SSE ──► Admin Console
~~~

## Gateway 처리 순서

1. TLS 1.3 Client Certificate 검증
2. Certificate Serial과 단일 SAN URI `urn:certgate:device:{device-key}`의 Device Key 추출
3. Access Context 조회 또는 30초 Cache 사용
4. Device 상태, Certificate 상태, Identity 일치 확인
5. Method·정규화 Path 정책 평가
6. 외부 Identity Header 제거
7. 허용 요청에 신뢰 Header를 생성해 Backend로 전달
8. 처리 결과 Security Event 생성
9. Security Event 생성과 SQLite Durable Outbox 저장을 하나의 로컬 Transaction으로 Commit
10. Commit된 Event의 Batch 전송 시도
11. 성공 시 Outbox에서 삭제하고 실패 시 보존 후 지수 Backoff로 재시도

## 통신 경계

- 외부 공개: Gateway 8443
- 개발 PC 공개: Console과 Management API
- Docker 내부 전용: PostgreSQL, Backend Service, Gateway 내부 Cache API
- Gateway → Management API와 Management API → Gateway는 서로 다른 Token 사용
- Root CA Key는 Runtime Service에 주입하지 않음

## Cache 일관성

- Access Context TTL: 30초
- Certificate 폐기 Commit 후 해당 Serial 즉시 무효화
- 무효화 호출 실패 시 TTL로 수렴
- Cache 장애는 인증 우회가 아니라 Management API 직접 조회 또는 Fail Closed로 처리

## 장애 원칙

- Access Context를 확인할 수 없고 유효 Cache가 없으면 요청 차단
- Backend 장애는 502와 INTERNAL_ERROR Event
- Management API 장애는 사용자 요청 판단과 분리하고, 먼저 저장된 Event를 SQLite Durable Outbox에 보존
- Gateway 재시작 후에도 Outbox의 PENDING Event 전송 재개
- SQLite Outbox 로컬 Transaction 자체가 실패하면 구조화 로그로 기록하고 Event가 보존되었다고 간주하지 않음
- CA 서명 실패는 CertificateRequest를 APPROVED로 바꾸지 않고 CRITICAL Event 기록

## 저장소 구조

상세 구조와 Package 책임은 [repository-structure.md](repository-structure.md)를 따른다.

## MVP 한계

폐기 검증은 TLS Handshake 이후 Backend 전달 이전에 수행한다. CRL·OCSP 기반 Handshake 폐기를 구현했다고 표현하지 않는다.

외부 Webhook, Notification Outbox와 별도 Alert Domain은 MVP 범위가 아니다. Security Event를 원본으로 유지하고 저장된 CRITICAL Event만 SSE로 Admin Console에 전달한다.
