# Backend Service

Gateway가 허용한 요청만 도착하는지 검증하는 최소 HTTP Service다.

Endpoint:

- POST /heartbeat
- POST /telemetry
- GET /commands
- GET /health

외부 Port는 공개하지 않고 Gateway가 생성한 신뢰 Header를 응답과 Test에서 확인한다.
