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
