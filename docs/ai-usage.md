# AI 활용 및 검증 기록

이 문서는 CertGate 개발에서 AI Agent를 어떻게 사용했고 결과를 어떻게 직접 검증했는지 기록한다.

## 원칙

- AI는 코드·Test·문서·설계 대안을 제안할 수 있다.
- 보안 결정과 최종 코드의 책임은 개발자에게 있다.
- 암호·인증 코드는 공식 Library 문서와 Test로 검증하기 전 채택하지 않는다.
- 직접 설명할 수 없는 코드는 병합하지 않는다.
- Private Key, Token, 비밀번호, 운영 데이터, 개인정보를 AI에 제공하지 않는다.
- 틀린 제안은 숨기지 않고 발견·수정 과정을 기록한다.

## 기록 양식

### YYYY-MM-DD - 작업명

- 목표:
- AI가 도운 부분:
- 내가 내린 결정:
- 검증 방법:
- 틀렸거나 채택하지 않은 제안:
- 관련 Commit 또는 PR:

## 2026-08-13 - 구현 전 설계 기준선

- **목표**: 채용 요구와 제출 일정에 맞는 Network·PKI Portfolio 범위 확정
- **AI가 도운 부분**: 요구사항, CA 계층, mTLS Gateway, Policy, Event Outbox, API 계약 초안
- **내가 내린 결정**: 실제 제품 복제가 아닌 Device Trust 문제 재해석, Go·Spring·React 구성, SQLite Durable Outbox 채택
- **검증 방법**: 요구사항·아키텍처·API·데이터 모델·이슈의 용어와 흐름을 상호 대조
- **틀렸거나 채택하지 않은 제안**:
  - 원격 Redis를 장애 중 Event 보관소로 쓰는 안은 Gateway 로컬 장애 내구성이 약해 채택하지 않음
  - 별도 Alert Table, 상태 관리, Webhook Outbox는 MVP에 과해 제거
  - Certificate 없는 Device의 CSR 제출 인증이 빠져 있어 단기 Enrollment Token과 Hash 저장을 추가
  - Gateway Cache 무효화 API 방향이 모호해 Management API → Gateway 호출로 명확화
- **관련 Commit**: 설계 기준선과 구현 계약 Commit

## 2026-08-20~21 - Console 실제 API 연동 마무리 (Issue #7 Task 8~18)

- **목표**: Admin Console 5개 화면을 Mock에서 실제 Management API로 연결
- **AI가 도운 부분**: 목록·상세·승인/거절/폐기/등록 화면 구현, MSW Mock Handler, Dashboard 차트, SSE 전역 CRITICAL Toast
- **내가 내린 결정**: Console이 서버 message 표를 복제하지 않고 reasonCode를 그대로 노출, Toast는 실제 anchor(`Link component`)로 구현, 동시 표시 Toast를 5개로 제한, 재연결 시 서버가 준 `occurredAt`을 커서로 써서 보완 조회
- **검증 방법**: PR #46·47·49에서 Codex 리뷰(High 1건·Medium 6건 등) 받아 반영, mutation Test로 검출력 확인, 실제 Compose 스택에 가상 Device 7대를 등록해 화면 캡처
- **틀렸거나 채택하지 않은 제안**: 별도 Alert 화면·상태 관리·Webhook Outbox·Prometheus/Grafana 실도입은 이미 검토 후 기각(2026-08-13 결정과 동일선상)
- **관련 PR**: #44·#46·#47·#49

## 2026-08-20~21 - 가상 Device E2E (Issue #4)

- **목표**: Mock 없이 실제 Compose 스택으로 mTLS 핵심 흐름(Enrollment→발급→허용/차단→Outbox→SSE)을 검증
- **AI가 도운 부분**: `tests/e2e/run.sh`(11개 시나리오·50개 단언) 작성
- **내가 내린 결정**: `set -e`를 쓰지 않고 끝까지 돌려 실패를 한 번에 보고, Key·Certificate·Token은 임시 디렉터리에 격리하고 종료 시 삭제
- **검증 방법**: 실제 스택에서 최초 실행 시 실패한 3건을 분석해 테스트 쪽 버그였음을 확인 후 수정(서버는 맞았음). Codex 크레딧 소진으로 서브에이전트 5개(CLAUDE.md 준수·얕은 버그 스캔·git 히스토리·이전 PR 코멘트·코드 주석 준수) 병렬 리뷰로 대체해 8건 반영, 2건(SSE 재연결 재조회, Cache 무효화 실패 시 TTL 수렴)은 Issue #55로 분리
- **틀렸거나 채택하지 않은 제안**: 없음(리뷰에서 반박된 항목 없음)
- **관련 PR**: #54

## 2026-08-21 - 남은 Low~Medium Issue 일괄 정리 (Issue #6·#36·#39·#25·#27·#30)

- **목표**: 마감 전 남은 Issue를 최대한 처리
- **AI가 도운 부분**: Gateway Readiness Endpoint(`/readyz`), 미매핑 경로 404 처리, 동시성/순서 회귀 테스트 3건 결정성 강화
- **내가 내린 결정**: Compose healthcheck는 의도적으로 안 바꿈(Readiness로 바꾸면 일시적 장애에도 Container가 재시작돼 Outbox 전송이 끊김 — 재시작 정책과의 상호작용을 이 작업을 진행한 기기에 Docker가 없어 검증할 수 없어 보류)
- **검증 방법**: 이 기기에 Docker·python3가 없어 Testcontainers 기반 통합 테스트를 로컬로 못 돌렸다. `./gradlew compileTestJava`로 컴파일만 확인하고 push한 뒤 CI(Docker 있음)를 실제 검증 게이트로 썼다 — 실제로 CI가 새 테스트의 JDBC UUID 파라미터 바인딩 버그(`PSQLException`)를 잡아냈고 `java.util.UUID.fromString()`으로 수정했다. Codex 크레딧 소진으로 다시 서브에이전트 5개 병렬 리뷰로 대체(CLAUDE.md 준수·버그 스캔·git 히스토리·이전 PR 코멘트·코드 주석 준수) — 실질적 문제 없음을 소스 대조로 확인
- **틀렸거나 채택하지 않은 제안**: 없음
- **관련 PR**: #56·#57

## 2026-08-22 - Issue #50·#55 마감 전 마지막 두 Issue 정리

- **목표**: 제출 전 남은 Issue를 모두 처리해 #8(제출 패키지)만 남긴다
- **AI가 도운 부분**:
  - Issue #50: `CertificateResponse`에 subjectDn·sanUri·fingerprintSha256(Entity에는 있었지만 getter가 없던 것 포함)·issuerDn(신규)을, `CertificateRequestResponse`에 sanUri·publicKeyAlgorithm을 추가(management-api PR #62). Admin Console의 인증서 목록·상세, 인증서 요청 목록에 새 필드를 반영하고 "서버 응답에 없어서 만들지 않는다"던 기존 주석·테스트 단언을 지움(PR #64).
  - Issue #55: `tests/e2e/run.sh`에 SSE 재연결 후 CRITICAL Event 재조회, Cache 무효화 실패 시 30초 TTL 수렴 시나리오 2개를 추가(PR #63) — 별도 병렬 작업(Sub-agent)으로 진행
- **내가 내린 결정**:
  - Issue #50 방향은 "서버 DTO 확장"으로 직접 선택(문서(ui-design.md) 계약을 축소하는 대안 대신). 이미 완성한 화면 계약을 지키는 쪽이 Portfolio 완성도에 맞다고 판단
  - "발급 CA" 식별자(issuerDn)는 별도 CA 테이블·enum을 새로 만들지 않고, `IntermediateCertificateAuthority.sign()`이 서명 시점에 이미 계산해 두는 Intermediate CA 자신의 Subject DN을 그대로 저장하는 쪽으로 결정 — 이 프로젝트는 Intermediate CA가 항상 하나뿐이라(ADR-002) 여러 CA를 구분하는 모델은 지금 범위에 없는 요구다(YAGNI)
  - Migration은 `ALTER TABLE ... ADD COLUMN issuer_dn ... DEFAULT '' → DROP DEFAULT` 패턴으로, 기존 행이 있는 배포에서도 깨지지 않게 함
  - 두 PR 모두 Codex 리뷰를 건너뛰기로 결정 — 순수 조회 노출/테스트 코드로 새 보안 경계·쓰기 경로가 없고, 근거를 각 PR 본문에 남김(Codex는 이 시점 크레딧 소진 상태였음)
- **검증 방법**:
  - management-api: `./gradlew test` 23개 스위트 전부 통과(Testcontainers 실제 Postgres 포함, CertificateIntegrationTests가 새 필드 4개가 실제 서명 흐름부터 HTTP 응답까지 흘러나오는지 확인)
  - admin-console: `npm run typecheck`, `npm test` 20개 파일·203개 테스트 전부 통과
  - E2E: `./tests/e2e/run.sh`를 실제 Compose 스택(Docker·Postgres·SQLite Outbox)에서 실행, 12개 시나리오·65개 단언 전부 통과
  - 제출 전 `gitleaks detect`로 전체 Git 히스토리(146 Commit) 재검사, 결과 없음(Leak 0)
- **틀렸거나 채택하지 않은 제안**: 없음. 다만 진행 중 작업 방식의 실수 하나를 기록한다 — Issue #50과 #55를 같은 작업 디렉터리에서 격리 없이 병렬로 진행하다가, 브랜치를 전환하는 동안 서로의 미Commit 변경이 뒤섞일 뻔했다. Commit 자체는 안전했지만 이후로는 병렬 작업마다 별도 `git worktree`로 분리했다
- **관련 PR**: #62·#63·#64

실제 코드 작성 이후에는 AI가 생성한 코드, 직접 수정한 오류, 실행한 Test 명령과 결과를 작업별로 추가한다.
