# CertGate

X.509 인증서와 mTLS를 이용해 네트워크 디바이스의 신원을 검증하고, 인증·인가된 요청만 내부 서비스로 전달하는 보안 게이트웨이 및 관리 플랫폼입니다.

> CertGate는 신뢰할 수 없는 네트워크에서 접속한 디바이스를 인증서로 식별하고, 접근 정책을 통과한 요청만 Backend Service에 전달합니다.

## 기술 스택

현재 설계를 기준으로 한 구현 기술입니다. 실제 구현 진행에 따라 변경 사항을 계속 반영합니다.

| 영역 | 기술 | 사용 목적 |
| --- | --- | --- |
| Device Agent | **Go** | 키·CSR 생성, 인증서 보관, mTLS 요청 및 가상 디바이스 테스트 |
| Security Gateway | **Go** | TLS 핸드셰이크, X.509 인증서 검증, 접근 정책 적용, 요청 프록시 |
| Management API | **Java, Spring Boot** | 디바이스·CSR·인증서·정책·이벤트·알림 관리 API |
| Admin Console | **React, TypeScript, Vite, MUI** | 운영 대시보드와 디바이스·인증서·보안 이벤트 관리 화면 |
| Database | **PostgreSQL** | 디바이스, 인증서, 접근 정책, 보안 이벤트 및 알림 저장 |
| Event Outbox | **SQLite** | Gateway 이벤트 전송 실패 시 로컬 영속 보관 및 재전송 |
| PKI / Network Security | **OpenSSL, X.509, mTLS, HTTPS/TLS** | Private CA 구성, 인증서 발급·폐기, 디바이스 상호 인증 |
| Authorization | **RBAC, HTTP Method/Path Policy** | 디바이스 역할별 API 접근 허용 및 기본 거부 정책 |
| Infrastructure | **Docker Compose** | Gateway, API, Console, PostgreSQL의 로컬 통합 실행 |
| CI / Collaboration | **GitHub, GitHub Actions** | 버전 관리, 이슈 기반 작업 관리, 빌드·테스트·비밀정보 검사 |
| Development | **AI Agent 기반 개발** | 설계·구현 보조 후 테스트와 문서로 결과 검증 |

## 설계 문서

- [요구사항](docs/requirements.md)
- [전체 아키텍처](docs/architecture.md)
- [보안 설계](docs/security-design.md)
- [Management API 초안](docs/api-spec.md)
- [데이터 모델 초안](docs/data-model.md)
- [개발 로드맵](docs/roadmap.md)
- [테스트 전략](docs/testing.md)
- [배포·운영 설계](docs/operations.md)
- [AI 활용 및 검증 기록](docs/ai-usage.md)

## 현재 상태

**설계 단계입니다. 아직 구현 완료를 주장하지 않습니다.**

제출용 MVP는 다음 흐름을 우선 완성합니다.

```text
CSR 제출 → 인증서 발급 → mTLS 인증 → 접근 정책 검증
→ Backend 전달 또는 차단 → Security Event 기록 → 관리 콘솔 확인
```
