# ADR-004: 서비스 통신과 Event 전달 신뢰성

- 상태: 승인
- 날짜: 2026-08-13

## 결정

- Device와 Gateway는 TLS 1.3 mTLS 기반 HTTPS REST로 통신한다.
- Gateway, Backend, Management API는 Docker 내부망에서 REST로 통신한다.
- Gateway가 검증된 Identity Header를 직접 생성한다.
- Access Context Cache는 30초 TTL을 사용하고 Certificate 폐기 시 즉시 무효화한다.
- Security Event 전송 실패 시 Gateway SQLite Durable Outbox에 보관한다.
- Management API는 Event ID Unique Constraint로 재전송을 멱등 처리한다.
- CRITICAL Event는 별도 Alert 저장소 없이 원본 Security Event를 SSE로 Console에 전달한다.
- SSE 연결 중 누락된 Event는 최근 CRITICAL Event REST 조회로 보완한다.
- 외부 Webhook과 Notification Outbox는 MVP에서 제외한다.

## 이유

REST는 TLS 인증, Method·Path Policy, Backend Proxy를 하나의 흐름으로 구현하기 쉽다. Kafka·RabbitMQ는 제출 일정과 단일 노드 규모에 비해 운영 부담이 크다. SQLite Outbox는 Management API 장애와 Gateway 재시작에서도 Event를 보존하면서 추가 Infrastructure를 줄인다.

SSE는 서버에서 Console로 단방향 Critical Event를 전달하는 요구에 충분하고 WebSocket보다 구현 범위가 작다.

## 결과

- Message Broker 없이 핵심 장애 복구를 증명할 수 있다.
- Gateway에 Outbox 재시도·정리 로직이 필요하다.
- SSE는 영속 Queue가 아니므로 REST 보완 조회가 필요하다.
- 다중 Gateway·대규모 Event 처리 시 Redis Streams나 Message Broker를 재검토한다.
