# 테스트 전략 v1

## 원칙

물리 장비 대신 Go Device Agent Profile을 사용하지만 실제 TCP/TLS 연결과 실제로 생성한 Certificate를 사용한다.

## 테스트 계층

- Unit: CSR·SAN, Certificate 상태 계산, Policy Matching, Backoff, Critical 판정
- Integration: Spring + PostgreSQL, Gateway + Management API, SQLite Outbox
- Contract: 문서의 JSON Fixture와 Server·Console Type 일치
- E2E: Device → Gateway → Backend
- Failure: 인증서·권한·서비스 중단·재시작

## 가상 Device

| Profile | 조건 | 기대 |
|---|---|---|
| A | 정상 SENSOR | Heartbeat·Telemetry 허용 |
| B | 폐기 Certificate | 차단·CRITICAL Event |
| C | 다른 CA | TLS 실패 |
| D | 만료 Certificate | 차단 |
| E | SENSOR /commands | ACCESS_DENIED |
| F | OPERATOR /commands | 허용 |

## 필수 시나리오

1. Enrollment Token으로 CSR 제출
2. 잘못된 Token 거절
3. Device Key와 SAN URI 불일치 거절
4. CSR 승인과 Chain 검증
5. 정상 SENSOR Heartbeat·Telemetry 허용
6. 다른 CA·만료·폐기 차단
7. SENSOR /commands 차단, OPERATOR 허용
8. 외부 Identity Header 제거·재생성
9. Management API 중단 중 SQLite Outbox 보존
10. Gateway 재시작 후 Outbox 보존
11. API 복구 후 재전송과 Event ID 중복 방지
12. Certificate 폐기 후 Cache 무효화
13. CRITICAL Event 저장과 SSE 표시
14. SSE 재연결 후 최근 Event 재조회

## 완료 기준

- 허용 요청만 Backend에 도착
- 실패 원인과 Reason Code 일치
- 동일 Event ID는 PostgreSQL에 한 번만 존재
- Test Key·Certificate·Token은 Git과 로그에 없음
- 핵심 E2E는 문서화된 단일 명령으로 실행

## E2E 실행

~~~bash
./tests/e2e/run.sh
~~~

이 한 줄이 위 "필수 시나리오"를 실제 스택에서 검증한다. Mock이나 Stub을 쓰지 않는다 — Compose로 5개 서비스를 띄우고, 실제 Device Agent가 만든 Key·CSR로 인증서를 발급받아, 실제 mTLS로 Gateway에 요청한다.

주의할 점:

- **DB Volume을 지우고 시작한다**(`down -v`). 개발 중인 데이터가 있으면 먼저 백업한다.
- Key·Certificate·Token은 전부 임시 디렉터리 안에만 만들고 종료 시 지운다. 마지막 시나리오가 컨테이너 로그와 작업 트리에 그것들이 남지 않았는지 직접 확인한다.
- Access Context Cache TTL(30초)과 서비스 재시작을 실제로 기다리므로 **5분 안팎** 걸린다.
- 실패해도 멈추지 않고 끝까지 돈 뒤 한 번에 보고한다. 한 시나리오가 깨졌을 때 나머지 상태도 같이 봐야 원인을 좁힐 수 있다.
- 스택을 남겨 두고 직접 들여다보려면 `E2E_KEEP_STACK=1 ./tests/e2e/run.sh`.

아직 CI에 넣지 않았다(development-guide.md "E2E는 안정화 후 CI에 포함"). 실행 시간이 길고 Docker·Go·OpenSSL 3.2 이상을 요구하며, 만료 인증서 시나리오는 OpenSSL이 낮으면 SKIP된다.
