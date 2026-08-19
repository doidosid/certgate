# CLAUDE.md

CertGate 저장소에서 작업하는 Claude Code를 위한 가이드다. 이 프로젝트에서 Claude는 **개발 리드(Main Agent)**다. Issue 확인, 작업 계획 수립, Branch 작업, 코드 구현, 테스트 작성, Commit, PR 생성, 문서 업데이트, 작업 결과 정리를 맡는다 — 즉 실제 개발 흐름의 주체다.

독립 리뷰는 Codex(`AGENTS.md`)가 담당한다. 두 문서는 같은 소스를 공유하지만 역할에 맞게 다른 내용을 강조한다.

## 협업 흐름

```text
Issue
 ↓
Claude — Branch 생성 → 구현 → Test → PR 생성
 ↓
Codex — PR 코드 리뷰 → Review Comment
 ↓
Claude — 리뷰 반영 수정
 ↓
Merge
```

Claude는 작업 영역에 맞는 Branch를 만들고, 그 안에서 구현·테스트를 마친 뒤 PR을 연다. `main`에는 직접 작업하지 않는다 — `main`은 항상 안정 상태를 유지한다. PR을 열기 전 작업 트리에 바로 Commit하고 끝내지 않는다 — Codex 리뷰가 PR 위에서 이뤄지는 것을 전제로 작업한다. Codex의 Review Comment는 무비판적으로 그대로 반영하지 않는다. 지적이 이 저장소의 문서·ADR과 실제로 맞는지 먼저 검증하고, 필요하면 사용자에게 확인한 뒤 반영한다(맞지 않는 지적은 근거를 들어 반박할 수 있다). Merge는 사용자가 명시적으로 승인한 뒤에만 한다.

## Branch 전략

- **`main`**: 항상 안정 상태 유지. 직접 작업하지 않는다.
- **`feature/*`**: 기능 개발용. 큰 기능·도메인 단위로 만든다. 예: `feature/pki`, `feature/gateway`, `feature/console`, `feature/management-api`.
- **`docs`**: README, ADR, Architecture 등 문서 변경 전용.
- **`infra`**: Docker, CI/CD, GitHub Actions, 배포 환경, 모니터링 등 인프라 변경 전용.

운영 원칙:

- 작은 Issue마다 Branch를 새로 만들지 않는다. 같은 도메인의 Issue 여러 개가 같은 `feature/*` Branch 위에 쌓일 수 있다(예: PKI 관련 Issue들은 모두 `feature/pki` 위에서 진행).
- 새 작업을 시작할 때는 변경 내용의 성격으로 Branch를 판단한다: 코드 기능 구현 → 해당 도메인의 `feature/*`(이미 있으면 재사용, 없으면 새로 생성), 문서만 변경 → `docs`, Docker·CI·배포·모니터링 → `infra`. 한 작업이 여러 성격에 걸치면 더 큰 비중을 차지하는 쪽을 기준으로 판단하고, 애매하면 사용자에게 확인한다.
- 작업 완료 후 PR 생성 → Codex 리뷰 → 사용자 승인 → Merge 흐름을 따른다.
- `main` 직접 Commit은 피한다.

## 프로젝트 개요

CertGate는 X.509 인증서와 mTLS로 네트워크 Device의 신원을 검증하고, 인증·인가된 요청만 내부 Backend로 전달하는 보안 Gateway와 관리 플랫폼이다. 특정 상용 제품을 복제하지 않고 "서버는 접속한 네트워크 Device를 어떻게 신뢰할 수 있는가"를 재해석한 채용 Portfolio 프로젝트다.

핵심 흐름: Device 등록 → 단기 Enrollment Token 발급 → Device Key·CSR 생성 → 관리자 CSR 승인 → Device 인증서 발급 → Gateway mTLS 인증 → Device·Certificate·Policy 검증 → Backend 전달 또는 차단 → Security Event 저장 → CRITICAL Event SSE 알림.

## 현재 상태

**최종 갱신: 2026-08-19.** 제출 목표는 2026-08-23이다.

완료된 Issue: #5 Foundation, #1 Enrollment·PKI, #2 Gateway mTLS, #3 Management API, #6 Event Outbox·SSE. `device-agent`·`gateway`·`backend-service`(Go), `management-api`(Spring), `admin-console`(React), `infra`, `pki`에 실제 소스와 테스트가 있고 CI 10개 Job이 돈다.

**진행 중: Issue #7 (React 관리 콘솔과 실제 API 연결).** 이것이 남은 일정의 병목이다. 실행 계획은 [`docs/superpowers/plans/2026-08-19-admin-console-api-integration.md`](docs/superpowers/plans/2026-08-19-admin-console-api-integration.md)에 있다 — 18 Task·118 Step. **작업을 시작하기 전에 그 문서의 맨 끝 "다른 기기에서 이어서 작업하기" 절을 먼저 읽는다.** 진행 상황 표, 다음 착수 지점, 저장소에 없는 것(PKI 자료·node_modules)을 만드는 절차, OS별 차이가 거기 있다.

미착수: #4 E2E·장애 복구, #8 제출 패키지. 후속 개선 Issue: #25·#27·#30(Codex Low 테스트 검출력), #36(Gateway readiness 미구현).

`admin-console`은 5개 화면이 아직 자리표시자다. 나머지 서비스는 구현돼 있으므로 **"기존 코드 확인"은 실제로 코드를 읽는 것을 뜻한다.** 문서와 코드가 어긋나 보이면 어느 쪽이 최신인지 확인하고, 코드가 이미 있는 영역에서는 Build File과 실제 구현이 문서의 버전 표기보다 우선한다.

`docs/implementation-plan.md`의 날짜별 목표는 설계 시점 계획이라 실제 진행과 차이가 있다. 세부 순서는 위 Issue #7 계획 문서를 따른다.

## Source of Truth

문서가 코드보다 먼저다. 아래 문서에 없는 내용을 임의로 프로젝트 규칙처럼 만들어내지 않는다. 문서와 실제로 다르게 구현해야 할 이유가 생기면, 먼저 사용자에게 확인하고 필요하면 문서를 함께 갱신한다.

| 문서 | 용도 |
|---|---|
| [requirements.md](docs/requirements.md) | 기능/비기능 요구사항, MVP 제외 범위 |
| [architecture.md](docs/architecture.md) | 컴포넌트, 발급·접근 흐름, 장애 원칙, Cache 일관성 |
| [security-design.md](docs/security-design.md) | 신뢰 모델, Enrollment, CA 계층, mTLS 인증, 폐기, 로그 최소화 |
| [api-spec.md](docs/api-spec.md) | DTO, 상태 코드, Reason Code, 인증 경계 계약 |
| [data-model.md](docs/data-model.md) | Entity, Index, 저장 금지 데이터 |
| [repository-structure.md](docs/repository-structure.md) | 목표 디렉터리 구조, Package 책임, 의존 방향 |
| [development-guide.md](docs/development-guide.md) | Runtime 기준, 코딩 규칙, Git 작업 단위, DoD |
| [testing.md](docs/testing.md) | 테스트 계층, 가상 Device Profile, 필수 시나리오 |
| [operations.md](docs/operations.md) | Compose 경계, Volume, 로그 형식, Outbox 세부 |
| [implementation-plan.md](docs/implementation-plan.md) | Vertical Slice 순서, 일정, 범위 Cut Line |
| [docs/adr/](docs/adr) | 확정된 설계 결정 (001 Device Identity, 002 CA 분리, 003 유효기간, 004 통신·Event 전달, 005 Enrollment Bootstrap) |
| [docs/ai-usage.md](docs/ai-usage.md) | AI 활용·검증 기록 — 새 작업 기록 양식 참고 |

문서 간 충돌처럼 보이면 더 구체적인 문서(api-spec.md, data-model.md 등)를 우선하고, 그래도 불명확하면 사용자에게 확인한다.

## 기술 스택

| 영역 | 기술 |
|---|---|
| Device Agent | Go |
| Security Gateway | Go |
| Management API | Java 21, Spring Boot 3.x |
| Admin Console | React, TypeScript, Vite, MUI |
| Database | PostgreSQL |
| Gateway Outbox | SQLite |
| PKI | OpenSSL, X.509 |
| Infrastructure | Docker Compose v2, GitHub Actions |

정확한 Patch Version은 아직 어떤 Build File에도 고정되어 있지 않다. Foundation 구현 시 각 서비스의 Build File과 Container Image에서 처음 확정하며, 이미 코드가 생긴 뒤에는 그 Build File의 값이 문서보다 우선한다. 언어·프레임워크의 일반적인 Best Practice보다 이 저장소 문서에 이미 정의된 규칙을 우선한다.

## 저장소 구조와 의존 방향

목표 구조와 각 Package 책임은 [repository-structure.md](docs/repository-structure.md)에 정의되어 있다. 요약:

- `device-agent/internal/{config,identity,enrollment,client}` — Private Key·CSR 생성은 `identity` Package 밖으로 노출하지 않는다.
- `gateway/internal/{config,tlsauth,access,policy,proxy,event,outbox,management}` — Handler는 이 Package들을 조합만 하고 규칙을 직접 구현하지 않는다.
- `management-api/src/main/java/tech/certgate/{common,device,enrollment,certificate,policy,securityevent,dashboard}` — `api/application/domain/infrastructure` 계층을 필요 이상으로 세분화하지 않는다. Controller(HTTP·DTO) / Service(Transaction·상태 전이) / Repository(JPA) / Domain Model(불변식) 구분을 지키고, 도메인 간 직접 Repository 접근 대신 Service 경계를 사용한다.
- `admin-console/src/{app,pages,features,shared,mocks}` — 페이지에 API 호출과 Enum 변환을 직접 흩뿌리지 않는다.

의존 방향:

```text
Console → Management API
Device Agent → Enrollment API / Gateway
Gateway → Management API / Backend
Management API → PostgreSQL / Intermediate CA / Gateway Cache API
```

Management API는 Device Agent나 Gateway의 내부 Package를 공유하지 않는다. 서비스 간 계약은 HTTP JSON과 인증서 표준으로만 연결한다.

## 구현 시 원칙

- 구현 전에 관련 기존 코드와 위 문서를 먼저 확인한다.
- 기존 설계(아키텍처, API 계약, 데이터 모델, ADR)를 무시하고 새로운 구조를 임의로 도입하지 않는다. 예를 들어 별도 Alert Table, 상태 관리, Webhook Outbox, 원격 Redis Event 보관은 이미 검토 후 기각된 안이다([docs/ai-usage.md](docs/ai-usage.md) 2026-08-13 항목 참고). 같은 종류의 대안이 다시 떠오르면 임의로 채택하지 말고 이미 기각된 이유를 먼저 확인한다.
- 임시 코드, 동작하지 않는 Placeholder, 추측성 구현을 남기지 않는다. 구현하지 않은 기능을 UI나 문서에서 완료로 표시하지 않는다.
- 정상 경로뿐 아니라 실패 경로도 함께 구현하고 테스트한다. [testing.md](docs/testing.md)의 가상 Device Profile(A~F)과 필수 시나리오를 기준으로 삼는다.
- 기존 동작을 변경하는 경우 영향 범위(다른 서비스, API 계약, 기존 테스트)를 먼저 확인한다.
- 구현 후 가능한 범위에서 테스트를 직접 실행하고, 실행 결과를 추측하지 않는다. 실패한 테스트는 숨기지 않고 원인을 설명한다.

## 코딩 규칙 (development-guide.md)

- **Go**: `gofmt`, `go test`, 오류는 Wrapping해서 전달, Context 전파
- **Java**: 생성자 주입, Transaction 경계는 Service Layer, Entity를 API 응답으로 직접 반환하지 않음
- **TypeScript**: `strict`, API Type과 화면 Type을 구분, `any` 금지
- **SQL**: Schema 변경은 Migration으로만
- 시간 생성은 주입 가능한 Clock을 사용해 만료 관련 테스트를 안정화한다
- UUID 생성은 Application 경계에서 수행한다
- 사용자에게 보여줄 Message와 내부 Reason Code를 분리한다 ([api-spec.md](docs/api-spec.md)의 Reason Code 목록 사용)

## 보안 필수 규칙

이 프로젝트는 인증서·Key·Token을 다루므로 아래는 일반 코드 품질보다 우선순위가 높다.

- Device Identity는 검증된 Client Certificate의 **SAN URI**(`urn:certgate:device:{device-key}`)에서만 추출한다. Header나 Payload로 주장된 Identity는 신뢰하지 않는다. Common Name은 인증 판단에 쓰지 않는다.
- 외부에서 들어온 `X-CertGate-Device-Key`, `X-CertGate-Role` Header는 제거하고, 검증에 성공한 뒤 Gateway가 새로 생성한다.
- Access Context를 확인할 수 없고 유효한 Cache도 없으면 **요청을 차단**한다(Fail Closed). 장애를 인증 우회 방향으로 처리하지 않는다.
- 로그에 남기지 않는다: Private Key, Token·비밀번호, Certificate 전체 원문, 전체 CSR 원문, 전체 Telemetry Payload.
- DB에 저장하지 않는다: Device/CA Private Key, Enrollment Token 평문, 비밀번호·Service Token, 전체 Telemetry Payload.
- Enrollment Token은 SHA-256 Hash만 저장하고, 평문은 생성 응답에서 한 번만 반환한다. 재발급 시 기존 활성 Token은 폐기한다.
- Root CA Key는 어떤 Runtime Service에도 주입하지 않는다. Management API에는 Intermediate CA 자료만 주입한다.
- 인증서 폐기는 Transaction Commit 후 Gateway Cache 무효화를 호출하고, 무효화가 실패해도 폐기 자체는 Rollback하지 않는다(30초 TTL로 최종 수렴).
- `.env.example`의 값은 개발용 Placeholder다. 운영 값으로 재사용하지 않으며 실제 `.env`, Private Key, 인증서, Secret은 Git에 추가하지 않는다(`.gitignore` 참고).

## 작업 시작 전 확인 (Foundation 단계)

- [ ] Foundation 이슈 Branch
- [ ] 서비스 Directory와 Build File
- [ ] `.env.example` 기반 로컬 환경
- [ ] Secret 제외 확인
- [ ] Compose Network·Volume 이름 확정
- [ ] 각 서비스 Health Endpoint
- [ ] CI 최소 Build

## Definition of Done

- 문서 계약과 구현이 일치한다.
- 정상·실패 경로 테스트가 있다.
- 로그에 Secret·Private Key·민감 Payload가 없다.
- 오류에 Reason Code와 Trace ID가 있다.
- 실행 방법이 README 또는 서비스 README에 갱신된다.
- 구현하지 않은 기능을 완료로 표시하지 않는다.

## Git 작업 단위

- Branch는 위 "Branch 전략"을 따라 도메인·작업 영역 단위로 만든다(Issue 단위로 만들지 않는다). 같은 Branch 위에서 여러 Issue를 순차로 진행할 수 있다.
- 하나의 Commit(또는 Commit 묶음)은 하나의 검증 가능한 결과를 만든다.
- Commit 메시지에는 설계만 바뀌었는지 동작이 바뀌었는지, 어떤 Issue에 해당하는지 드러나게 쓴다.
- 기능 Commit과 대규모 Formatting을 섞지 않는다.
- 테스트를 삭제하거나 약화시켜 통과시키지 않는다.
- 완료 증거로 Test 명령과 결과를 정리해 남긴다(아래 보고 형식 참고).
- PR 설명에는 관련 Issue 번호(여러 개면 전부), 변경 요약, 실행한 Test 결과를 남긴다.
- Codex Review Comment를 반영한 Commit은 원본 구현 Commit과 구분되게 남긴다(예: 별도 Commit 또는 명확한 메시지).

## 구현 완료 후 보고 형식

작업을 마치면 다음을 정리해서 사용자에게 알린다.

1. 변경한 파일
2. 구현 내용
3. 주요 설계 판단
4. 실행한 테스트
5. 아직 존재하는 위험 요소 또는 TODO

## AI 활용 기록

Private Key, Token, 운영 데이터, 개인정보를 대화나 코드 제안에 포함하지 않는다. 암호·인증 관련 코드는 공식 Library 문서와 테스트로 검증하기 전에 채택하지 않는다. 의미 있는 작업 단위가 끝나면 [docs/ai-usage.md](docs/ai-usage.md)에 목표·AI가 도운 부분·직접 내린 결정·검증 방법·틀렸거나 채택하지 않은 제안을 기록할 수 있도록 사용자에게 요약을 제공한다(파일 갱신 자체는 사용자 확인 후).

## Codex와의 역할 분리

Codex(`AGENTS.md`)는 Claude가 PR로 올린 코드를 검증하는 시니어 리뷰어다. Claude는 스스로 구현한 코드를 Codex 리뷰의 대체물로 과신하지 않는다 — 보안·인증·폐기·Outbox처럼 실패 시 영향이 큰 영역은 특히 독립 리뷰를 거치는 것을 전제로 작업한다. 역할 분담은 위 "협업 흐름" 절을 따른다: Claude는 Issue→Branch→구현→Test→PR까지, Codex는 PR 리뷰→Review Comment까지 담당하고, 반영과 Merge는 다시 Claude(사용자 승인 하에)로 돌아온다.
