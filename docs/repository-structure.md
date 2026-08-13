# 저장소·모듈 구조

## 목표 구조

~~~text
certgate/
├─ device-agent/
│  ├─ cmd/device-agent/
│  └─ internal/{config,identity,enrollment,client}
├─ gateway/
│  ├─ cmd/gateway/
│  └─ internal/{config,tlsauth,access,policy,proxy,event,outbox,management}
├─ management-api/
│  └─ src/main/java/tech/certgate/
│     ├─ common
│     ├─ device
│     ├─ enrollment
│     ├─ certificate
│     ├─ policy
│     ├─ securityevent
│     └─ dashboard
├─ admin-console/
│  └─ src/{app,pages,features,shared,mocks}
├─ backend-service/
│  └─ cmd/backend-service/
├─ pki/
│  ├─ config/
│  └─ scripts/
├─ infra/
│  ├─ compose.yaml
│  └─ docker/
├─ tests/e2e/
├─ docs/
├─ .env.example
├─ .editorconfig
└─ .gitignore
~~~

## Go Device Agent

- <code>identity</code>: Key, CSR, SAN URI 생성
- <code>enrollment</code>: Token 기반 CSR 제출·상태 Polling·Certificate 수령
- <code>client</code>: mTLS Heartbeat·Telemetry·Command 요청
- <code>config</code>: CLI Flag와 환경변수 검증

Private Key 파일 권한과 저장 경로 처리는 identity Package 밖으로 노출하지 않는다.

## Go Gateway

- <code>tlsauth</code>: TLS Config, Certificate Chain·SAN URI 추출
- <code>access</code>: Management API Access Context와 TTL Cache
- <code>policy</code>: Role + Method + Path 평가
- <code>proxy</code>: Header 정리와 Reverse Proxy
- <code>event</code>: Security Event 생성
- <code>outbox</code>: SQLite 저장, Backoff, Batch 재전송
- <code>management</code>: 내부 API Client
- Handler는 위 Package를 조합하고 규칙을 직접 구현하지 않는다.

## Spring Management API

도메인별 Package는 <code>api / application / domain / infrastructure</code> 계층을 필요 이상으로 세분화하지 않는다. MVP 기준:

- Controller: HTTP·DTO 변환
- Service: Transaction과 상태 전이
- Repository: JPA 영속성
- Domain Model: 불변식
- 공통 오류·Trace·시간 처리는 common에 둔다.

도메인 간 직접 Repository 접근을 피하고 Service 경계를 사용한다.

## React Console

- <code>app</code>: Router, Query Client, SSE Provider
- <code>pages</code>: URL 단위 조립
- <code>features</code>: Device, CertificateRequest, Certificate, SecurityEvent
- <code>shared/api</code>: HTTP Client와 생성된 Type
- <code>shared/ui</code>: 공통 Table·Status·Dialog
- <code>mocks</code>: API 계약과 동일한 Fixture

페이지에 API 호출과 Enum 변환을 직접 흩뿌리지 않는다.

## 의존 방향

~~~text
Console → Management API
Device Agent → Enrollment API / Gateway
Gateway → Management API / Backend
Management API → PostgreSQL / Intermediate CA / Gateway Cache API
~~~

Management API는 Device Agent나 Gateway의 내부 Package를 공유하지 않는다. 계약은 HTTP JSON과 인증서 표준으로만 연결한다.
