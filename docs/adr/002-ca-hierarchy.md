# ADR-002: Root CA와 Intermediate CA 분리

- **상태**: 확정
- **결정일**: 2026-08-13

## 배경

Root CA 개인키로 Device Certificate를 직접 발급하면 최상위 신뢰 키가 일상적인 발급 과정에 계속 노출된다. CertGate는 PKI의 역할 분리와 인증서 Chain 검증을 보여주기 위해 발급용 CA를 별도로 둔다.

## 결정

```text
Root CA
  └─ Intermediate CA
       └─ Device Certificate
```

- Root CA는 Intermediate CA 인증서 서명에만 사용한다.
- Intermediate CA가 승인된 Device CSR에 서명한다.
- Gateway는 Root CA를 Trust Anchor로 사용하고 전체 Certificate Chain을 검증한다.
- 실행 중인 Management API에는 Intermediate CA Certificate와 Key만 주입한다.
- CA 개인키는 모두 Git에 올리지 않는다.

## 선택 이유

- Root CA 노출 범위를 줄일 수 있다.
- 발급용 Intermediate CA를 교체하거나 폐기하기 쉽다.
- 실제 PKI에서 사용하는 계층 구조와 Chain 검증을 학습하고 설명할 수 있다.
- Root CA와 일상적인 인증서 발급 책임을 분리할 수 있다.

## MVP 운영 방식

- OpenSSL Script로 Root CA와 Intermediate CA를 초기화한다.
- 생성된 개인키는 Gitignore 대상인 로컬 Runtime Directory에 저장한다.
- Root CA 개인키는 초기화 이후 Management API 실행 환경에 전달하지 않는다.
- 상용 수준의 HSM·KMS와 Key Ceremony는 구현하지 않으며 프로젝트 한계로 명시한다.
