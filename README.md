# CertGate

X.509 인증서와 mTLS를 이용해 네트워크 디바이스의 신원을 검증하고, 인증·인가된 요청만 내부 서비스로 전달하는 보안 게이트웨이 및 관리 플랫폼입니다.

> 특정 제품을 복제하지 않고, “서버는 접속한 네트워크 디바이스를 어떻게 신뢰할 수 있는가?”라는 문제를 일반 네트워크 장비 관리 환경으로 재해석합니다.

## 핵심 흐름

~~~text
Device 등록 → 단기 Enrollment Token 발급 → Device에서 Key·CSR 생성
→ 관리자 CSR 승인 → Device 인증서 발급 → Gateway mTLS 인증
→ Device·Certificate·Policy 검증 → Backend 전달 또는 차단
→ Security Event 저장 → Critical Event SSE 알림
~~~

## 기술 스택

| 영역 | 기술 | 사용 목적 |
| --- | --- | --- |
| Device Agent | Go | 개인키·CSR 생성, 인증서 보관, mTLS 요청, 가상 디바이스 테스트 |
| Security Gateway | Go | TLS 1.3, X.509 검증, 접근 정책, Reverse Proxy, Event Outbox |
| Management API | Java, Spring Boot | Device·Enrollment·CSR·Certificate·Policy·Event API와 SSE |
| Admin Console | React, TypeScript, Vite, MUI | 운영 정보 조회와 인증서 관리 |
| Database | PostgreSQL | 운영 메타데이터와 Security Event 저장 |
| Gateway Outbox | SQLite | Management API 장애 중 Event 영속 보관·재전송 |
| PKI | OpenSSL, X.509 | Root·Intermediate CA와 Device 인증서 발급 |
| Infrastructure | Docker Compose, GitHub Actions | 통합 실행, 빌드·테스트·비밀정보 검사 |

## 개발 기준 문서

- [요구사항](docs/requirements.md)
- [전체 아키텍처](docs/architecture.md)
- [보안 설계](docs/security-design.md)
- [API 구현 계약](docs/api-spec.md)
- [데이터 모델](docs/data-model.md)
- [저장소·모듈 구조](docs/repository-structure.md)
- [개발 환경과 규칙](docs/development-guide.md)
- [구현 계획과 일정](docs/implementation-plan.md)
- [테스트 전략](docs/testing.md)
- [배포·운영 설계](docs/operations.md)
- [ADR 목록](docs/adr)
- [AI 활용 및 검증 기록](docs/ai-usage.md)

초기 화면 정보 구조는 [UI 설계](docs/ui-design.md)와 [와이어프레임](docs/wireframes/certgate-console-wireframe.html)에 보관합니다. 실제 구현 화면은 개발 과정에서 변경합니다.

## 현재 상태

**설계 기준선과 개발 준비 문서를 확정한 상태이며 기능 구현 전입니다.**

구현은 [Foundation 이슈 #5](https://github.com/doidosid/certgate/issues/5)부터 시작합니다. README는 구현이 완료될 때마다 <code>완료 / 진행 중 / 예정</code>을 구분해 갱신합니다.

## 제출 목표

2026년 8월 23일까지 다음 최소 흐름을 실제 코드와 테스트로 증명합니다.

- Device가 자기 개인키와 CSR을 생성하고 인증서를 발급받는다.
- 정상 인증서는 Gateway를 통과하고 폐기·만료·권한 없음은 차단된다.
- Management API 장애 중에도 Security Event가 유실되지 않는다.
- 관리 콘솔에서 Device·Certificate·Security Event를 확인한다.
- Critical Security Event를 접속 중인 콘솔에 SSE로 알린다.
