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

## Phase 0. 현재 코드의 결함 정리

배포·확장 여부와 관계없이 지금 코드에 있는 결함이다. 2026-10-02 전체 코드 검토에서 확인했다. 확장 작업 전에 먼저 처리한다. 상태는 2026-10-06 기준이다.

### 남은 결함

| 우선순위 | 결함 | 위치 |
|---|---|---|
| Medium | 허용된 요청이 Upgrade(`101 Switching Protocols`)되면 그 뒤 Tunnel 안의 요청에는 정책 판단·Security Event 기록·신원 Header 재생성이 적용되지 않는다. 지금의 `backend-service`는 Upgrade를 지원하지 않아 악용 경로는 없지만, 신뢰 모델이 Backend 구현에 의존한다. 거절할 경우의 Reason Code를 정해야 한다. 신원 이름의 request Trailer도 함께 다룬다(Issue #75) | `gateway/cmd/gateway/handler.go`, `gateway/internal/proxy` |
| Medium | Device Agent가 Enrollment 중 일시 오류에 바로 종료된다. 재시작하면 이전에 제출한 PENDING 요청 때문에 `409 CERTIFICATE_REQUEST_DUPLICATE`로 다시 실패한다 | `device-agent/cmd/device-agent/main.go` |
| Low | E2E 단언의 검출력: Event ID 중복 검사가 PRIMARY KEY 때문에 실패할 수 없다. SKIP을 통과로 센다. 차단된 요청이 Backend에 도달하지 않았는지는 직접 확인하지 않는다 | `tests/e2e/run.sh`, `tests/e2e/lib.sh` |
| 의존성 | Spring Framework 6.2.19의 CVE-2026-47884(`XsltView`)를 image-scan에서 예외 처리했다(`XsltView` 미사용, 만료 2027-01-06). 수정판이 7.0.9뿐이라 Spring Boot 4 이전이 필요하다(Issue #80) | `.trivyignore.yaml`, `management-api/build.gradle` |

### 해결한 결함

| 우선순위 | 결함 | 해결 |
|---|---|---|
| High | `/internal/**` Service Token Filter가 디코딩 전 원본 URI로 경로를 판단해 `/%69nternal/...`·`/internal;x=1/...`가 Token 검사 없이 Handler에 도달할 수 있었다 | PR #71 |
| High | Gateway가 요청 Method·Path를 길이 제한 없이 Event에 복사해, 컬럼 한도를 넘는 Event 하나가 batch 전체(같은 batch의 CRITICAL Event 포함)를 막았다 | PR #73: Gateway에서 rune 단위로 자르고 NUL·잘못된 UTF-8을 치환 |
| Medium | `Director` 뒤에 hop-by-hop Header를 제거해 `Connection: X-CertGate-Role`로 신원 Header를 지울 수 있었다 | PR #74: `ReverseProxy.Rewrite`로 전환 |
| Medium | Enrollment Token을 재발급해도 이전 Token으로 제출한 PENDING CSR이 그대로 승인 가능했다 | PR #76: 재발급 Transaction에서 자동 거절(ADR-005) |
| 부하 | `security_event` 보관 정책이 없었다 | PR #79: `SECURITY_EVENT_RETENTION_DAYS`(`docs/operations.md` "Security Event 보관") |

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

### 함께 정리할 것

- Phase 0의 `/internal/**` 우회는 Service Token Filter에서 고쳤다(PR #71). Spring Security를 도입하면 기본 `StrictHttpFirewall`이 `;`와 일부 인코딩 문자를 거부해 한 겹 더 막는다. `/internal/**`도 Security Filter Chain 안에서 Service Token 인증으로 다루는 구조를 검토한다.
- `SECURITY_EVENT_RETENTION_DAYS`는 지금 환경변수로만 바꿀 수 있다. 관리자 인증이 생기면 ADMIN만 바꿀 수 있는 Console 설정 화면을 추가한다.
- Console API 호출이 경로 세그먼트를 `encodeURIComponent` 없이 조합한다(`admin-console/src/features/*/api.ts`). 관리자 인증이 붙으면 조작된 Link로 다른 Endpoint를 호출하게 만들 수 있다.

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

### 배포 전 선결 조건

- **`restart:` 정책 추가**: 현재 `infra/compose.yaml`에는 `restart:` 정책이 없어 위 10번이 실패한다. `restart: unless-stopped`를 추가한다.
- **`init-ca.sh` 덮어쓰기 방지**: 이미 `root-ca.key`가 있어도 경고 없이 새 Root·Intermediate CA를 만든다. 이미 발급된 Device 인증서와 DB 기록이 모두 무효가 된다. 기존 자료가 있으면 거부하고 `--force`일 때만 진행하게 한다.
- **Container 권한 축소**: 모든 Runtime Container가 root로 실행된다. Intermediate CA Key를 가진 `management-api`도 마찬가지다. 비root `USER`, `no-new-privileges`, `cap_drop: [ALL]`, 가능한 곳은 `read_only`를 적용한다. Key 파일 권한(`chmod 600`)과 UID를 맞춘다.
- **Base Image 갱신**: Gateway·Backend Image는 지원이 끝난 `alpine:3.20`을 쓴다.
- **Gateway Timeout 설정**: mTLS 서버에 `ReadHeaderTimeout`·`ReadTimeout`·`WriteTimeout`·`IdleTimeout`이 없다. 그래서 TLS Handshake에도 기한이 없다. Backend Proxy에도 `ResponseHeaderTimeout`이 없다. 8443을 인터넷에 열기 전에 반드시 설정한다.

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

### 주의할 점

- Gateway는 mTLS로 Client 인증서를 직접 검증한다. Edge가 Gateway 앞에서 TLS를 종료하면 Client 인증서를 잃는다. 그래서 Gateway 경로는 TLS를 종료하지 않는 L4 Passthrough(Nginx `stream`, Caddy L4 등)로 구성한다.
- L4 Passthrough에서는 Edge가 TLS Handshake Timeout을 대신 걸어주지 못한다. Phase 2의 Gateway Timeout 설정은 Edge가 있어도 Gateway 자체에 있어야 한다.
- 이 Phase의 "인증서 발급·갱신"은 Edge의 공개 HTTPS 인증서(예: Let's Encrypt)를 말한다. Device 인증서 자동 갱신과는 별개다. Device 인증서 자동 갱신은 MVP 제외 범위다(`docs/adr/003-certificate-validity.md`). 하려면 mTLS로 인증하는 갱신 API 설계가 따로 필요하다.

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

### 함께 정리할 것

- **E2E를 CI Job으로 추가**: 위 "현재 검증" 목록에 E2E(`tests/e2e/run.sh`)가 없다. "테스트 실패 시 배포 중단"을 지키려면 E2E가 파이프라인에 있어야 한다. `compose-smoke`와 같은 Docker Runner에서 돌릴 수 있다. CI에서는 SKIP을 실패로 취급하는 Strict 모드로 실행한다.
- **CI 의존성 고정**: Action을 Tag(`@v4` 등)로 참조하고 `govulncheck@latest`를 쓴다. Commit SHA나 Version으로 고정하고 Dependabot을 추가한다.
- **device-agent Image 스캔**: `image-scan` Job이 device-agent Image를 빌드·스캔하지 않는다.
- **Gateway Graceful Shutdown**: `Shutdown`이 처리 중인 요청을 기다리기 전에 `main`이 반환하고 Outbox Store를 닫는다. 배포마다 Gateway가 재시작되므로 그때마다 이미 내린 접근 판단의 Event가 유실될 수 있다.

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

### 부하 테스트 전에 고칠 것

아래는 이미 코드에서 확인한 한계다. 그대로 두면 첫 부하 테스트는 이 한계를 다시 측정하는 데 그친다.

- **Outbox 처리량 상한**: Sender가 2초마다 batch 하나(50건)만 보낸다. 초당 약 25건을 넘는 요청이 계속되면 Management API가 정상이어도 Outbox가 계속 쌓인다. 그러면 거짓 `EVENT_OUTBOX_BACKLOG` 경보가 난다. Tick마다 batch가 가득 찬 동안 계속 보내도록 바꾼다.
- **Access Context Cache Stampede**: 같은 Serial의 동시 Cache Miss가 모두 Management API를 호출한다. 만료된 Entry도 Map에서 지우지 않는다. `singleflight`와 주기적 정리를 넣는다. Redis 없이도 할 수 있다.
- **SSE Broadcast 작업 거부**: Broadcast Executor(core 2, max 4, queue 100, AbortPolicy)가 CRITICAL Event 폭주 시 작업을 거부한다. 거부된 Event는 실시간 알림에서 빠진다. 연결이 끊기지 않아 재연결 재조회로도 복구되지 않는다.
- **`security_event` 크기**: 허용된 요청까지 한 건씩 저장한다. 보관 기간 설정(`SECURITY_EVENT_RETENTION_DAYS`, PR #79)으로 매일 오래된 Event를 지우지만 Partition은 없다. 부하 테스트에서 삭제 Job 소요 시간과 Table 크기를 함께 본다.

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

### 단일 Gateway에도 이미 있는 일관성 문제

Gateway가 한 대여도 Cache 무효화가 조회와 경합한다(`gateway/internal/access/access.go`).

1. 폐기 직전에 시작된 Access Context 조회가 있다.
2. 그 사이에 무효화가 들어온다. 아직 Entry가 없어 지울 것이 없다.
3. 조회가 끝나면 그 VALID 결과가 30초 동안 Cache에 들어간다.

Key별 세대 번호(generation)로 무효화 이후의 조회 결과는 저장하지 않게 고친다. 이 방식은 Scale-out과 Redis 설계에도 그대로 이어진다.

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

이 Redis는 Access Context Cache 용도다. 2026-08-13에 기각한 "원격 Redis Event 보관"(Security Event를 Redis에 보관하는 안, `docs/ai-usage.md`)과는 다른 용도다. Security Event의 원본은 계속 Gateway SQLite Outbox → PostgreSQL이다.

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

> 주의: `init-ca.sh`는 기존 CA 자료를 경고 없이 덮어쓴다(Phase 2 "배포 전 선결 조건"). `pki/runtime`에 이미 CA가 있으면 아래 두 PKI 명령은 건너뛴다. `.env`도 이미 있으면 덮어쓰지 않는다.

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
