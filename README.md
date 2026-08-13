# CertGate

X.509 인증서와 mTLS를 이용해 네트워크 디바이스의 신원을 검증하고, 인증·인가된 요청만 내부 서비스로 전달하는 보안 게이트웨이 및 관리 플랫폼입니다.

> CertGate는 신뢰할 수 없는 네트워크에서 접속한 디바이스를 인증서로 식별하고, 접근 정책을 통과한 요청만 Backend Service에 전달합니다.

## 예정 기술 스택

- **Go**: Device Agent, Security Gateway
- **Java / Spring Boot**: Management API
- **React**: Admin Console
- **PostgreSQL**: Device·인증서·정책·보안 이벤트 저장
- **OpenSSL**: 초기 Private CA 구성과 인증서 발급
- **Docker Compose**: 로컬 통합 실행 환경

## 설계 문서

- [요구사항](docs/requirements.md)
- [전체 아키텍처](docs/architecture.md)
- [보안 설계](docs/security-design.md)
- [Management API 초안](docs/api-spec.md)
- [데이터 모델 초안](docs/data-model.md)
- [개발 로드맵](docs/roadmap.md)
- [AI 활용 및 검증 기록](docs/ai-usage.md)

## 현재 상태

**설계 단계입니다. 아직 구현 완료를 주장하지 않습니다.**

제출용 MVP는 다음 흐름을 우선 완성합니다.

```text
CSR 제출 → 인증서 발급 → mTLS 인증 → 접근 정책 검증
→ Backend 전달 또는 차단 → Security Event 기록 → 관리 콘솔 확인
```
