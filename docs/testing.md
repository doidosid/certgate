# 테스트 전략

## 1. 테스트 방식

실제 물리 장비 대신 Go로 만든 가상 Device Agent를 사용한다. 가상 Device도 실제 TCP/TLS 연결과 실제 인증서를 사용하므로 mTLS Handshake, 인증서 검증, 접근 정책을 실제 흐름으로 검증할 수 있다.

## 2. 가상 Device

| Device | 조건 | 기대 결과 |
|---|---|---|
| Device A | 정상 SENSOR | Heartbeat·Telemetry 허용 |
| Device B | 폐기 인증서 | 접근 차단·Critical Alert |
| Device C | 다른 CA 인증서 | TLS Handshake 실패 |
| Device D | 만료 인증서 | 접근 차단 |
| Device E | 정상 SENSOR | `/commands` 차단 |
| Device F | 정상 OPERATOR | `/commands` 허용 |

실행 예시:

```bash
device-agent \
  --device-id=device-a \
  --cert=certs/device-a.crt \
  --key=certs/device-a.key \
  --action=heartbeat
```

## 3. 테스트 계층

- **Unit Test**: 인증서 Parsing, SAN URI Identity 추출, Policy Matching, Alert Rule
- **Integration Test**: Gateway와 Management API, Spring과 PostgreSQL, Webhook 연결
- **E2E Test**: Device → Gateway → Backend 전체 흐름
- **Failure Test**: 인증서 없음·다른 CA·만료·폐기·권한 없음·서비스 장애

## 4. 필수 E2E 시나리오

1. 정상 SENSOR의 Heartbeat 허용
2. 정상 SENSOR의 Telemetry 허용
3. 인증서 없는 Device 차단
4. 다른 CA 인증서 차단
5. 만료 인증서 차단
6. 폐기 인증서 차단
7. SENSOR의 `/commands` 접근 차단
8. OPERATOR의 `/commands` 접근 허용
9. Management API 중단 중 Event를 SQLite Outbox에 보관
10. Management API 복구 후 Event 재전송과 중복 방지
11. Gateway 재시작 이후에도 미전송 Event 보존
12. 폐기 인증서 접속 시 Critical Alert 생성
13. 반복 공격 시 5분 중복 억제와 Webhook 발송
14. Webhook 장애 중 Notification Outbox 보관과 복구 후 재전송

## 5. 완료 기준

- 허용된 요청만 Backend Service에 도착한다.
- 차단 사유가 정확한 Reason Code로 기록된다.
- 재전송 후 동일 Event UUID가 한 번만 저장된다.
- Critical Alert가 DB·Dashboard·Webhook에 표시된다.
- 테스트 인증서와 개인키는 실행 중 임시 생성되며 Git에 포함되지 않는다.
- 문서화된 명령 한 번으로 핵심 결과를 재현할 수 있다.
