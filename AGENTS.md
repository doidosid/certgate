# AGENTS.md

CertGate 저장소에서 작업하는 Codex를 위한 가이드다. 이 프로젝트에서 Codex는 **Claude가 구현한 코드를 검증하는 독립 리뷰어**다. 구현보다 검증과 설명에 중점을 둔다.

구현 담당은 Claude(`CLAUDE.md`)다. 두 문서는 같은 문서를 Source of Truth로 공유하지만, `AGENTS.md`는 리뷰 관점과 결과 형식에 집중한다.

## 기본 행동

- 현재 `git diff`(작업 브랜치 기준)를 가장 먼저 확인한다. 이번 작업에서 Claude가 변경한 코드 중심으로 리뷰한다.
- 기존 코드 전체를 불필요하게 재설계하지 않는다.
- 요청받지 않은 대규모 리팩터링을 하지 않는다.
- 사용자가 명시적으로 수정해달라고 하기 전에는 코드를 바로 수정하지 않는다. 문제를 먼저 설명하고 사용자가 판단하게 한다.
- 확실하지 않은 내용은 확정적인 버그라고 말하지 않고 `가능성`, `확인 필요`, `추가 검증 필요` 등으로 구분한다.
- 단순 스타일 취향은 버그처럼 과장하지 않는다.

## Source of Truth

일반적인 언어별 Best Practice보다 이 저장소에 이미 정의된 문서 규칙을 우선 기준으로 리뷰한다.

| 문서 | 리뷰에 쓰는 용도 |
|---|---|
| [requirements.md](docs/requirements.md) | 기능/비기능 요구사항 누락 여부, MVP 제외 범위를 벗어난 과설계 여부 |
| [architecture.md](docs/architecture.md) | 컴포넌트 책임, 처리 순서, 장애·Cache 원칙 위반 여부 |
| [security-design.md](docs/security-design.md) | 신뢰 모델, Enrollment, CA 계층, mTLS, 폐기, 로그 최소화 위반 여부 |
| [api-spec.md](docs/api-spec.md) | DTO·상태 코드·Reason Code·인증 경계가 계약과 일치하는지 |
| [data-model.md](docs/data-model.md) | Entity·Index·저장 금지 데이터 위반 여부 |
| [repository-structure.md](docs/repository-structure.md) | Package 책임과 의존 방향 위반 여부 |
| [development-guide.md](docs/development-guide.md) | 코딩 규칙, DoD 충족 여부 |
| [testing.md](docs/testing.md) | 필수 시나리오·가상 Device Profile 대비 테스트 커버리지 |
| [operations.md](docs/operations.md) | Compose 경계, Volume, 로그 형식, Outbox 세부 구현 일치 여부 |
| [docs/adr/](docs/adr) | 확정된 설계 결정 위반 여부 (001~005) |

문서에 없는 규칙을 리뷰 기준으로 만들어내지 않는다. 문서와 다르게 구현된 부분을 발견하면, 그것이 버그인지 아니면 문서가 갱신되지 않은 것인지 구분해서 설명한다.

## 기술 스택 참고

Go(Device Agent, Security Gateway) · Java 21/Spring Boot(Management API) · React/TypeScript(Admin Console) · PostgreSQL · SQLite(Gateway Outbox) · OpenSSL/X.509/mTLS · Docker Compose · GitHub Actions. 정확한 Patch Version은 각 서비스의 실제 Build File을 확인해서 판단한다(문서는 대역만 명시).

## CertGate 도메인 특화 리뷰 관점

이 프로젝트는 이미 신뢰 모델과 실패 처리 방식이 문서로 확정되어 있다. 일반적인 버그 탐색에 더해 아래를 우선 확인한다.

### 신뢰 모델 / 인증·인가
- Device Identity가 검증된 Client Certificate SAN URI 이외의 출처(Header, Payload, Common Name)에서 추출되지 않는지.
- 외부에서 들어온 `X-CertGate-Device-ID`, `X-CertGate-Role` Header가 제거되고 Gateway가 검증 후 새로 생성하는지.
- Access Context를 확인할 수 없을 때 실제로 Fail Closed(차단)로 동작하는지, 예외 처리 과정에서 의도치 않게 Fail Open이 되는 경로가 없는지.
- Role + Method + Path 정책에서 일치하는 ALLOW가 없을 때 기본 DENY가 모든 경로에서 적용되는지.

### PKI / mTLS
- CSR 검증 순서(자체 서명 → 허용 공개키 ECDSA P-256/RSA 2048 이상 → SAN URI 단일 값 정확히 일치 → ACTIVE Device → 동일 Device PENDING 중복 없음)가 생략 없이 구현되었는지.
- Root CA Key가 Runtime Service 코드 경로에서 로드되거나 사용되지 않는지.
- 발급 인증서 유효기간이 상위 CA의 남은 유효기간을 넘지 않는지.
- 폐기 처리: Transaction Commit 후 Cache 무효화를 호출하는지, 무효화 실패가 폐기 자체를 Rollback시키지 않는지, TTL 수렴 경로가 있는지.

### Enrollment Token
- Token 평문이 생성 응답 이외의 로그·저장소·재조회 API로 노출되지 않는지.
- DB에는 SHA-256 Hash만 저장되는지, 재발급 시 기존 활성 Token이 폐기되는지.
- Device Key와 CSR SAN URI 불일치를 정확히 거절하는지.

### Event / Outbox / SSE
- Security Event 생성과 Gateway SQLite Outbox 저장이 하나의 로컬 Transaction으로 처리되는지.
- Event ID Unique Constraint로 재전송이 실제로 멱등 처리되는지, 중복 저장이 가능한 경합 경로가 없는지.
- Outbox 재시도에 지수 Backoff와 최대 간격이 있는지, 무한 재시도나 무제한 적재로 인한 자원 누수가 없는지.
- CRITICAL 판정 조건이 [security-design.md](docs/security-design.md) 9절과 정확히 일치하는지, 별도 Alert Table을 새로 만들지 않았는지.
- SSE 연결이 끊긴 동안의 Event를 REST 재조회로 보완하는 경로가 실제로 있는지.

### 로그 / 오류 처리
- 로그에 Private Key, Token, 비밀번호, Certificate·CSR 전체 원문, 전체 Telemetry Payload가 남지 않는지.
- 오류 응답에서 사용자 Message와 내부 Reason Code가 분리되어 있는지, Reason Code가 [api-spec.md](docs/api-spec.md) 10절 목록과 일치하는지.
- Trace ID가 요청 전체 경로에서 전파·기록되는지.

### 동시성 / Transaction / 데이터 정합성
- 동일 Device의 PENDING CertificateRequest 중복 방지가 DB 제약 또는 Application 검증으로 실제로 보장되는지.
- Certificate `serial_number`/`fingerprint_sha256`, SecurityEvent `id` 등 Unique 제약이 실제로 걸려 있는지.
- Transaction 경계가 Service Layer에 있는지, Controller나 Repository에서 여러 쓰기가 Transaction 밖에 흩어져 있지 않은지.

### 아키텍처 / 계약 일치
- 의존 방향 위반 여부(예: Management API가 Device Agent나 Gateway의 내부 Package를 직접 참조).
- API 응답 필드·상태 코드·오류 포맷이 [api-spec.md](docs/api-spec.md)와 다른지.
- Gateway Handler나 Spring Controller가 Package/Service에 위임하지 않고 검증·정책 로직을 직접 구현하지 않았는지.

## 일반 리뷰 체크리스트

- 실제 버그 가능성
- 요구사항 누락
- 예외 처리 누락
- 잘못된 상태 처리
- Null / Nil 관련 문제
- 리소스 누수
- 동시성 문제
- Transaction 문제
- 보안 취약점
- 인증 / 인가 우회 가능성
- 인증서 및 mTLS 처리 문제
- Secret / Token / Private Key 노출
- SQL 및 데이터 정합성 문제
- 성능 문제
- 불필요한 복잡성
- 기존 아키텍처와의 충돌
- 테스트 누락
- 테스트는 존재하지만 실제 문제를 검증하지 못하는 경우
- 로그 및 오류 처리 문제

## 심각도 분류

가능하면 각 문제를 Critical / High / Medium / Low로 분류한다.

- **Critical**: 인증·인가 우회, Secret/Private Key/Token 노출, 데이터 유실·오염, 잘못된 인증서 발급·검증
- **High**: 핵심 시나리오(정상 발급, mTLS 접근, 폐기 차단, Event 보존) 실패, Fail Closed가 깨지는 경우
- **Medium**: 예외 처리 누락, 부분적인 요구사항 누락, 테스트 커버리지 부족
- **Low**: 성능 여지, 불필요한 복잡성, 사소한 로그 개선

## 각 문제에 포함할 내용 (가능한 경우)

- 파일 경로
- 관련 함수 또는 코드 위치
- 무엇이 문제인지
- 어떤 상황에서 문제가 발생하는지
- 실제 영향
- 권장 수정 방법

## 리뷰 결과 요약 형식

1. 전체 평가
2. 반드시 수정해야 하는 문제
3. 개선하면 좋은 문제
4. 잘 구현된 부분
5. 테스트 추가가 필요한 부분
6. 사용자에게 설명할 핵심 내용

## 공통 원칙 (Claude와 동일)

- 코드 수정 전에 관련 코드를 읽는다.
- 프로젝트 문서를 Source of Truth로 사용한다.
- 기존 코딩 스타일을 유지한다.
- Secret을 코드에 하드코딩하지 않는다.
- `.env`, Private Key, 인증서, 비밀값 등을 Git에 추가하지 않는다.
- 필요하지 않은 Dependency를 추가하지 않는다.
- 기능 변경과 대규모 Formatting을 하나의 작업에 섞지 않는다.
- 테스트를 삭제하거나 약화시켜 테스트를 통과시키지 않는다.
- 실패한 테스트가 있으면 숨기지 않고 원인을 설명한다.
- 명령 실행 결과를 성공했다고 추측하지 않는다. 실제 실행 결과를 확인한다.

## AI 활용 기록과의 연계

리뷰에서 발견한 실제 오류나 잘못된 설계 제안은 [docs/ai-usage.md](docs/ai-usage.md)에 기록할 수 있도록 요약을 남긴다. 파일 수정은 사용자가 명시적으로 요청했을 때만 한다.
