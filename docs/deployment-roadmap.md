# CertGate 확장·배포 로드맵

## 목적

현재 CertGate는 로컬 Docker Compose 환경에서 핵심 보안 흐름과 E2E 검증까지 구현된 상태다.

이 문서는 이후 개인 Mac에서 개발을 이어가면서 실제 Ubuntu 서버 배포, 운영, 관측, Scale-out까지 확장하기 위한 작업 순서를 정리한다.

핵심 방향은 다음과 같다.

```text
Mac에서 개발
→ GitHub
→ Ubuntu VPS에 배포
→ HTTPS / Reverse Proxy / 인증
→ CI/CD
→ Prometheus / Grafana
→ 부하 테스트
→ Gateway Scale-out
→ Redis Shared Cache
```

---

## 1. 개발 환경 방향

### 결론

당장은 Ubuntu VM을 별도로 만들지 않는다.

개발은 기존처럼 Mac에서 진행한다.

```text
Mac
├─ VS Code
├─ Git
├─ 프로젝트 소스
└─ Docker / Docker Compose
```

CertGate는 이미 각 서비스를 Linux Container로 실행하고 있으므로, macOS 자체가 Linux가 아니어도 실행 환경 차이를 상당 부분 줄일 수 있다.

현재 Container 기준:

- Management API: Java 21 JRE 기반 Linux Image
- Gateway: Alpine Linux
- Backend Service: Alpine Linux
- Admin Console: Nginx Alpine
- PostgreSQL: PostgreSQL Alpine

따라서 굳이 다음처럼 계층을 하나 더 추가할 필요는 없다.

```text
Mac
→ Ubuntu VM
→ Docker
```

대신 실제 Linux 운영 경험은 별도의 Ubuntu VPS에서 가져간다.

---

## 2. 권장 개발·배포 구조

### 개발

```text
Mac
  ↓
VS Code
  ↓
Git
  ↓
Docker Compose
```

로컬에서는 현재 방식 그대로 전체 Stack을 실행한다.

```bash
cp .env.example .env

./pki/scripts/init-ca.sh
./pki/scripts/issue-gateway-cert.sh

docker compose -f infra/compose.yaml --env-file .env up -d --build
```

### 운영

```text
GitHub
  ↓
Ubuntu VPS
  ↓
Docker Compose
  ├─ admin-console
  ├─ management-api
  ├─ gateway
  ├─ backend-service
  └─ postgres
```

Ubuntu 서버는 개발 서버가 아니라 실제 배포·운영 환경으로 사용한다.

운영 서버에서는 회사에서 익숙하게 사용하던 명령을 그대로 활용한다.

```bash
ssh ubuntu@<server-ip>

docker ps
docker compose ps
docker logs
ss -lntp
df -h
free -h
curl
openssl
```

즉 역할을 아래처럼 분리한다.

```text
Mac
= 개발자 관점

Ubuntu VPS
= 운영자 관점
```

---

## 3. 현재 CertGate 상태에서 바로 배포하면 안 되는 이유

현재 `infra/compose.yaml`에서 Management API와 Admin Console은 loopback에만 bind되어 있다.

예:

```yaml
management-api:
  ports:
    - "127.0.0.1:${MANAGEMENT_API_PORT}:8080"

admin-console:
  ports:
    - "127.0.0.1:${ADMIN_CONSOLE_PORT}:80"
```

또한 기존 운영 문서에서도 관리자 인증 구현 전 Management API를 외부에 공개하지 않는 것을 전제로 한다.

따라서 현재 Compose Stack을 그대로 인터넷에 노출하는 것은 목표가 아니다.

실제 외부 배포 전에 관리자 인증과 외부 진입 경계를 먼저 설계한다.

---

# 단계별 확장 계획

## Phase 1. 관리자 인증·인가

현재 가장 먼저 추가할 기능.

### 목표

Admin Console과 Management API를 인터넷에 공개하기 전에 관리자 인증을 붙인다.

예시 Role:

```text
ADMIN
→ Device 등록
→ CSR 승인/거절
→ Certificate 폐기
→ Policy 변경

VIEWER
→ 조회만 가능
```

### 후보 기술

- Spring Security
- Session 또는 JWT 기반 관리자 인증

선택 시 CertGate의 기존 보안 구조와 관리 편의성을 기준으로 결정한다.

### 완료 기준

- 로그인하지 않은 사용자는 관리 API 접근 불가
- ADMIN / VIEWER 권한 차이 존재
- 주요 관리 API 권한 테스트 존재
- Secret은 코드나 Git에 포함하지 않음

---

## Phase 2. Ubuntu VPS 첫 배포

### 목표

실제 인터넷에 연결된 Ubuntu 서버에 CertGate를 올린다.

초기에는 서버 한 대로 충분하다.

```text
Ubuntu VPS
└─ Docker Compose
   ├─ postgres
   ├─ management-api
   ├─ gateway
   ├─ backend-service
   └─ admin-console
```

### 할 일

1. 작은 Ubuntu VPS 생성
2. SSH Key 기반 접속
3. Docker / Docker Compose 설치
4. Firewall 설정
5. Repository Clone
6. 운영용 환경변수 작성
7. 운영용 PKI 자료 생성 및 권한 설정
8. Compose 배포
9. Container Health 확인
10. 재부팅 후 서비스 복구 확인

### 운영에서 확인할 것

```bash
docker compose ps
docker compose logs
docker stats
ss -lntp
df -h
free -h
```

---

## Phase 3. Domain + HTTPS + Reverse Proxy

### 목표

IP와 Port 직접 접근 대신 정상적인 HTTPS 서비스 형태로 만든다.

예상 구조:

```text
Internet
   ↓ 443
Edge Reverse Proxy
   ├─ certgate.example.com
   │      ↓
   │   Admin Console / Management API
   │
   └─ Gateway 공개 Endpoint
          ↓
        mTLS
```

### 학습 포인트

- DNS
- TCP
- TLS
- HTTP
- Reverse Proxy
- 인증서 발급·갱신
- Firewall

### 후보

- Nginx
- Caddy

CertGate 내부 Admin Console Container가 Nginx를 사용하더라도, 외부 진입 경계에는 별도 Edge Reverse Proxy를 두는 구조를 고려한다.

---

## Phase 4. CI에서 CD까지 확장

현재 CI는 이미 상당한 검증을 수행한다.

현재 검증:

- Go fmt / vet / test -race
- govulncheck
- Spring test / build
- React typecheck / test / build
- npm audit
- Docker Compose config
- Compose smoke test
- PKI Script test
- mTLS 검증
- Trivy image scan
- gitleaks / Secret 검사

따라서 다음 단계는 CD다.

목표 구조:

```text
main merge
  ↓
GitHub Actions
  ↓
Test
  ↓
Docker Image Build
  ↓
Container Registry Push
  ↓
Ubuntu VPS Deploy
```

초기에는 단순 SSH 배포로 시작하고, 이후 필요하면 Registry 기반 배포로 발전시킨다.

### 완료 기준

- main에 정상 merge된 Commit만 배포
- 테스트 실패 시 배포 중단
- 운영 Secret은 GitHub Secret 또는 서버 Secret으로 분리
- 배포 버전 확인 가능
- 실패 시 이전 버전으로 돌아갈 수 있는 절차 존재

---

## Phase 5. Observability

현재 CertGate는 구조화 로그, Trace ID, Dashboard와 Outbox 상태를 이미 가지고 있다.

다음 단계는 Metric 기반 관측이다.

### 목표 구조

```text
Management API ─┐
Gateway        ─┤
PostgreSQL     ─┼→ Prometheus → Grafana
Host           ─┘
```

### 먼저 볼 Metric

- API RPS
- 평균 / p95 latency
- HTTP error rate
- JVM heap
- JVM GC
- Tomcat busy thread
- DB connection pool
- PostgreSQL connection
- Gateway request count
- Gateway deny count
- Gateway Access Context cache hit/miss
- Outbox pending count
- Outbox oldest age
- Host CPU
- Host memory
- Disk usage

### 목표

장애가 났을 때 로그만 보는 것이 아니라 Metric으로 먼저 이상 지점을 좁힐 수 있게 한다.

---

## Phase 6. 부하 테스트

관측 환경을 만든 뒤 부하 테스트를 한다.

순서는 관측이 먼저다.

관측 없이 부하만 주면 무엇이 병목인지 알기 어렵다.

### 확인 대상

- Gateway 처리량
- Management API latency
- PostgreSQL connection
- JVM thread
- CPU / Memory
- Access Context cache 효과

### 도구 후보

- k6
- wrk
- hey

---

## Phase 7. Gateway Scale-out

단일 Gateway를 두 대 이상으로 확장한다.

```text
               Load Balancer
                ↓        ↓
          Gateway A   Gateway B
```

### 이 단계에서 확인할 문제

현재 Gateway Access Context Cache는 각 Gateway Process의 Local Cache다.

따라서:

```text
Gateway A
└─ Local Cache A

Gateway B
└─ Local Cache B
```

가 된다.

Certificate 폐기 시 두 Gateway Cache 모두를 어떻게 일관되게 무효화할지 문제가 생긴다.

이 시점부터 Shared Cache 도입에 명확한 이유가 생긴다.

---

## Phase 8. Redis 도입

Redis는 학습했다는 이유만으로 지금 바로 넣지 않는다.

실제 문제를 해결해야 할 때 도입한다.

### 도입 시점

Gateway가 Scale-out된 이후 Access Context Shared Cache 후보로 검토한다.

예:

```text
Gateway A ─┐
           ├→ Redis
Gateway B ─┘
             ↓ Cache Miss
       Management API
             ↓
         PostgreSQL
```

### 적용할 Redis 지식

- Cache-Aside
- TTL
- Cache Invalidation
- Cache Stampede
- Cache Penetration
- Cache Avalanche
- Eviction Policy
- RDB / AOF
- Sentinel
- 장애 시 DB Fallback
- Circuit Breaker
- Rate Limit

### 중요한 원칙

Redis 장애가 인증 우회로 이어지면 안 된다.

CertGate 특성상 Cache를 확인할 수 없고 원본도 확인할 수 없다면 Fail Closed 원칙을 유지한다.

---

# 목표 아키텍처 예시

최종적으로 아래 형태까지 확장할 수 있다.

```text
                    Internet
                       ↓
                Edge / Load Balancer
                   ↓          ↓
             Gateway A     Gateway B
                   \        /
                    \      /
                     Redis
                       ↓
                Management API
                       ↓
                   PostgreSQL

Prometheus
   ↑
   ├─ Gateway
   ├─ Management API
   ├─ PostgreSQL
   └─ Host

Grafana
   ↑
Prometheus

GitHub Actions
   ↓
CI / CD
   ↓
Ubuntu Server
```

---

# 집에서 바로 시작할 작업

처음부터 한꺼번에 하지 않는다.

우선 다음 순서로 진행한다.

## Step 1

현재 Mac에서 Repository 최신화.

```bash
git checkout main
git pull
```

## Step 2

기존 Stack이 정상적으로 뜨는지 다시 확인.

```bash
cp .env.example .env

./pki/scripts/init-ca.sh
./pki/scripts/issue-gateway-cert.sh

docker compose -f infra/compose.yaml --env-file .env up -d --build
docker compose -f infra/compose.yaml --env-file .env ps
```

## Step 3

현재 E2E 기준선 확인.

```bash
./tests/e2e/run.sh
```

기능 추가 전에 현재 Green 상태를 기준선으로 확보한다.

## Step 4

첫 확장 작업으로 관리자 인증·인가 설계 및 구현을 시작한다.

## Step 5

관리자 인증이 완료되면 Ubuntu VPS 첫 배포를 진행한다.

---

# 당장 하지 않을 것

아래는 필요성이 생길 때 진행한다.

- Ubuntu VM에서 별도 개발 환경 구축
- Redis를 이유 없이 추가
- Redis Cluster
- Kubernetes
- 서버 여러 대부터 시작
- MSA를 위한 서비스 추가 분리

복잡한 기술을 많이 쓰는 것이 목표가 아니라, 현재 CertGate에서 발생하는 실제 문제를 하나씩 해결하면서 구조를 확장하는 것이 목표다.

---

# 이 프로젝트로 최종적으로 증명하고 싶은 경험

단순히 기능 구현만 한 프로젝트가 아니라 다음 흐름을 직접 경험하는 것을 목표로 한다.

```text
로컬 개발
→ Docker 통합 환경
→ Git / CI
→ Linux 서버 배포
→ Reverse Proxy
→ HTTPS
→ 인증/인가
→ 운영 Secret 관리
→ Observability
→ 부하 테스트
→ Scale-out
→ Shared Cache
→ 장애 대응
→ CI/CD
```

그 결과 CertGate를 설명할 때 단순히

> Spring Boot와 Go로 보안 Gateway를 만들었다.

에서 끝나는 것이 아니라,

> Mac 로컬에서 Docker Compose 기반으로 멀티서비스 환경을 개발하고, Ubuntu 서버에 실제 배포했다. 관리자 인증, HTTPS, Reverse Proxy, CI/CD와 Prometheus/Grafana 관측을 구성했으며, Gateway Scale-out 과정에서 Local Cache 일관성 문제를 해결하기 위해 Redis Shared Cache를 도입하고 장애 시 Fail Closed 정책까지 검증했다.

까지 설명할 수 있는 수준을 목표로 한다.
