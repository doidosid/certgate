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

실제 코드 작성 이후에는 AI가 생성한 코드, 직접 수정한 오류, 실행한 Test 명령과 결과를 작업별로 추가한다.
