# 개발 로드맵

상세 일정과 완료 증거는 [implementation-plan.md](implementation-plan.md)를 기준으로 한다.

~~~text
Foundation
  → Enrollment·PKI
  → 정상 mTLS 접근
  → 차단·폐기
  → Event Outbox·SSE
  → Console 실제 API 연결
  → E2E·제출 문서
~~~

## 제출 기준

- 실제 Key·CSR·Certificate 발급
- TLS 1.3 mTLS 성공과 실패
- 기본 DENY 접근 정책
- 폐기 Certificate 차단
- Event 장애 보존·재전송·중복 방지
- 실제 API 데이터가 표시되는 Console
- 단일 명령으로 재현 가능한 핵심 시나리오
- 구현 상태와 한계의 정직한 구분

## 제출 이후

- 관리자 인증·권한
- CRL·OCSP
- 자동 Certificate 갱신
- 외부 메신저·Webhook
- Cloud 배포·Monitoring
- Rate Limit·Replay Protection
- HA와 분산 Cache
