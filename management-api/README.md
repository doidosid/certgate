# Management API

Spring Boot와 PostgreSQL 기반 관리 영역이다.

도메인:

- Device·EnrollmentCredential
- CertificateRequest·Certificate
- Role·PolicyRule
- SecurityEvent·Dashboard·SSE

Root CA Key는 사용하지 않으며 Runtime에는 Intermediate CA 자료만 주입한다.
