# Security Gateway

Go 기반 mTLS Reverse Proxy다.

첫 구현 범위:

1. TLS 1.3과 Client Certificate 필수
2. SAN URI Device Identity 추출
3. Management API Access Context 조회와 30초 Cache
4. Role + Method + Path 기본 DENY
5. 외부 Identity Header 제거·재생성
6. Security Event 생성과 SQLite Outbox
