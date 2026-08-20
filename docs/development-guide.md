# 개발 환경과 규칙

## 기준 Runtime

정확한 Patch Version은 Foundation 구현 시 각 Build File과 Container Image에 고정한다.

- Java 21 LTS
- Java와 호환되는 안정 Spring Boot 3.x
- Go 안정 버전
- Node.js LTS
- PostgreSQL 안정 Major
- Docker Compose v2

## 환경 구분

- <code>dev</code>: 로컬 개발, Console·Management API Host 접근 허용
- <code>test</code>: E2E 전용 DB와 실행 중 생성한 인증서
- <code>prod</code>: 제출 이후 확장. 관리자 인증 없이는 외부 배포 금지

환경값 이름은 [.env.example](../.env.example)을 계약으로 사용한다. 실제 <code>.env</code>와 Key는 Git에 올리지 않는다.

## 코딩 규칙

- Go: gofmt, go test, 오류 Wrapping, Context 전달. CI의 <code>go test -race</code>가 테스트가 실제로 동시 실행한 경로의 race를 탐지한다 — 로컬 Windows에서 <code>-race requires cgo</code>가 나오면 <code>CGO_ENABLED=0</code> 상태라는 뜻이고, 보통 C 컴파일러(MinGW-w64)가 없어서 Go가 자동으로 꺼둔 경우다. <code>go env CGO_ENABLED</code>로 확인하고, 로컬 실행이 필요하면 컴파일러를 설치한다
- Java: 생성자 주입, Transaction 경계는 Service, Entity 직접 응답 금지
- TypeScript: strict, API Type과 화면 Type 구분, any 금지
- SQL: Migration으로만 Schema 변경
- 시간 생성은 주입 가능한 Clock을 사용해 만료 테스트를 안정화
- UUID 생성은 Application 경계에서 수행
- 사용자에게 보여줄 Message와 내부 Reason Code를 분리

## Git 작업 단위

- 하나의 Issue는 하나의 검증 가능한 결과를 만든다.
- Commit에는 설계만 바뀌었는지 동작이 바뀌었는지 드러나게 쓴다.
- 기능 Commit과 대규모 Formatting을 섞지 않는다.
- 완료 증거로 Test 명령과 결과를 Issue 또는 PR에 기록한다.

## 필수 검증

Foundation 이후 CI에서 다음을 실행한다.

- Go: fmt 검사, vet, test(<code>-race</code>)
- PKI Script: CA Chain·Gateway 인증서 SAN·확장 검증(<code>pki/scripts/test_*.sh</code>)
- Spring: test, build
- React: typecheck, test, build
- Docker Compose Config 검증
- Private Key, <code>.env</code>, Secret Pattern 검사
- 의존성 취약점: Go <code>govulncheck</code>, Node <code>npm audit --audit-level=high</code>
- 실행 Image 취약점: Trivy HIGH·CRITICAL (<code>ignore-unfixed</code>)
- E2E는 안정화 후 CI에 포함

취약점 스캔은 **HIGH·CRITICAL만** 실패로 본다. MEDIUM 이하로 임계 경로를 막지 않는다. 아직 패치가 없는 것(<code>unfixed</code>)도 제외한다 — 우리가 할 수 있는 일이 없는데 merge만 멈춘다.

<code>govulncheck</code>는 호출 그래프를 분석해 실제로 도달하는 취약점만 보고하므로, 의존성 목록만 보는 스캐너보다 잡음이 적다. Image 스캔은 그것들이 보지 못하는 base image와 OS 패키지를 본다 — 둘은 대체 관계가 아니다.

## Definition of Done

- 문서 계약과 구현이 일치한다.
- 정상·실패 경로 Test가 있다.
- 로그에 Secret·Private Key·민감 Payload가 없다.
- 오류에 Reason Code와 Trace ID가 있다.
- 실행 방법이 README 또는 서비스 README에 갱신된다.
- 구현하지 않은 기능을 UI나 문서에서 완료로 표시하지 않는다.

## 개발 시작 전 체크

- [ ] Foundation 이슈 Branch
- [ ] 서비스 Directory와 Build File
- [ ] <code>.env.example</code> 기반 로컬 환경
- [ ] Secret 제외 확인
- [ ] Compose Network·Volume 이름 확정
- [ ] 각 서비스 Health Endpoint
- [ ] CI 최소 Build
