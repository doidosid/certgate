# ADR-004: 서비스 통신과 이벤트 전달 신뢰성

- **상태**: 확정
- **결정일**: 2026-08-13

## 결정

- Device와 Gateway는 mTLS 기반 HTTPS REST로 통신한다.
- Gateway와 Backend, Management API는 Docker 내부망에서 REST로 통신한다.
- Gateway가 인증된 Identity Header를 직접 생성한다.
- 인증서 상태 Cache는 기본 30초 TTL을 사용하고 폐기 시 즉시 무효화한다.
- Security Event 전송 실패 시 SQLite Durable Outbox에 보관한다.
- Alert Webhook 실패 시 Spring Notification Outbox에 보관한다.
- 각 Outbox는 지수 Backoff 재시도와 UUID 기반 중복 방지를 사용한다.

## 이유

REST를 사용하면 TLS 인증, Method·Path 정책, Backend Proxy를 하나의 흐름으로 구현하기 쉽다. Kafka·RabbitMQ는 제출 일정과 단일 노드 규모에 비해 운영 부담이 크므로, SQLite와 PostgreSQL Outbox로 필요한 영속성과 재시도를 구현한다.

## 결과

- 메시지 Broker 없이도 재시작과 일시 장애에서 Event를 보존할 수 있다.
- Gateway와 Spring 양쪽에 재시도·중복 방지 로직이 필요하다.
- 대규모 분산 환경으로 확장할 경우 별도의 Message Broker를 재검토한다.
