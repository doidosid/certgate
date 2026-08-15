# ADR-004: 서비스 통신과 Event 전달 신뢰성

- 상태: 승인
- 날짜: 2026-08-13

## 결정

- Device와 Gateway는 mTLS 기반 HTTPS REST로 통신한다.
- Gateway와 Backend, Management API는 Docker 내부망에서 REST로 통신한다.
- Gateway가 인증된 Identity Header를 직접 생성한다.
- 인증서 상태 Cache는 기본 30초 TTL을 사용하고 폐기 시 즉시 무효화한다.
- Gateway는 SQLite Durable Outbox를 WAL Mode로 운영하며, Security Event를 생성하고 Outbox에 저장하는 작업을 하나의 로컬 Transaction으로 처리한다.
- Outbox 저장이 Commit된 Event만 Management API로 전송하며, 성공 응답을 받은 뒤 삭제한다.
- 전송 실패 시 Event를 Outbox에 보존하고 지수 Backoff와 최대 간격을 적용해 재시도한다.
- Management API는 Event UUID Unique Constraint로 재전송을 멱등 처리한다.
- Security Event가 원본 데이터이며 CRITICAL Event만 SSE로 Admin Console에 전달한다.
- MVP에서는 별도 Alert Domain, 외부 Alert Webhook, Spring Notification Outbox를 만들지 않는다.

## 이유

REST를 사용하면 TLS 인증, Method·Path 정책, Backend Proxy를 하나의 흐름으로 구현하기 쉽다. Kafka·RabbitMQ는 제출 일정과 단일 노드 규모에 비해 운영 부담이 크므로, Gateway의 SQLite Durable Outbox와 Management API의 Event ID 중복 방지로 필요한 영속성과 멱등성을 구현한다. 전송 시도 전에 Event를 로컬 Transaction으로 저장하므로 Management API 장애나 Gateway 재시작 중에도 이미 생성된 Event를 보존할 수 있다.

## 결과

- 메시지 Broker 없이도 재시작과 일시 장애에서 Event를 보존할 수 있다.
- Gateway는 재시도를 담당하고 Management API는 중복 저장 방지를 담당한다.
- SSE는 CRITICAL Security Event의 실시간 전달 수단일 뿐 별도 저장소가 아니다.
- 대규모 분산 환경으로 확장할 경우 별도의 Message Broker를 재검토한다.

## 향후 확장

외부 Webhook이나 메신저 알림이 필요해지면 Security Event를 원본으로 사용하는 별도 전달 Adapter와 실패 보존 방식을 재검토한다. 이 확장 기능과 Notification Outbox는 MVP에 포함하지 않는다.
