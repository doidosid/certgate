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

실제 코드 작성 이후에는 AI가 생성한 코드, 직접 수정한 오류, 실행한 Test 명령과 결과를 작업별로 추가한다.
