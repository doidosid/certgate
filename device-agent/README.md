# Device Agent

Go 기반 가상 Device Client다.

첫 구현 범위:

1. 로컬 Private Key 생성
2. SAN URI를 포함한 CSR 생성
3. Enrollment Token으로 CSR 제출
4. 승인 상태 Polling과 Certificate·Chain 저장
5. mTLS Heartbeat·Telemetry 요청

Private Key와 Runtime Certificate는 이 Directory 아래가 아닌 Git 제외 Runtime 경로에 저장한다.
