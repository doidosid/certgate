# 배포·운영 설계

## 1. 제출용 배포 구조

```text
외부
 ├─ 8443 → Go Gateway(mTLS)
 └─ 개발 환경에서만 Admin Console / Management API 접근

Docker 내부망
 ├─ Spring Management API
 ├─ PostgreSQL
 ├─ Backend Service
 └─ Webhook Receiver
```

- Backend Service와 PostgreSQL은 외부 포트를 공개하지 않는다.
- Gateway만 Backend Service에 접근할 수 있다.
- 관리자 인증 구현 전에는 Management API를 인터넷에 공개하지 않는다.
- 제출 기본 환경은 Docker Compose 단일 서버다.

## 2. 영속 데이터

Docker Volume으로 다음을 보존한다.

- PostgreSQL 데이터
- Gateway SQLite Event Outbox
- 발급된 인증서 메타데이터
- Spring Notification Outbox

CA와 Device 개인키는 Git에서 제외된 별도 Runtime Directory에 둔다. Management API에는 Intermediate CA Key만 주입한다.

## 3. 구조화 로그

모든 서비스는 JSON 로그를 출력한다.

```json
{
  "timestamp": "...",
  "level": "WARN",
  "service": "gateway",
  "traceId": "...",
  "deviceId": "...",
  "reasonCode": "CERTIFICATE_REVOKED",
  "latencyMs": 12
}
```

개인키, 비밀번호, 인증서 원문, 전체 Telemetry Payload는 기록하지 않는다.

## 4. 상태 확인과 지표

- Gateway Health
- Spring Boot Actuator Health
- PostgreSQL 연결 상태
- Gateway Event Outbox 대기 건수
- 가장 오래된 미전송 Event의 지연 시간
- Notification Outbox 실패 건수
- Webhook 발송 성공·실패 건수

## 5. 환경

- `dev`: 개발용
- `test`: E2E용 임시 인증서와 격리 데이터
- `prod`: 실제 배포용 환경변수와 Key 분리. 제출 이후 확장

## 6. CI

GitHub Actions에서 다음을 자동 검증한다.

- Go Test
- Spring Test
- React Build/Test
- Secret·Private Key·`.env` 포함 여부
- E2E는 초기 수동 실행 후 안정화되면 CI에 추가한다.
