# Infrastructure

Docker Compose, Dockerfile, Health Check와 로컬 Network·Volume을 관리한다.

첫 목표는 빈 서비스라도 Compose Config와 Health 흐름을 검증하는 것이다. PostgreSQL과 Backend Service는 Host에 공개하지 않는다.

## 현재 상태

`compose.yaml`과 서비스별 `docker/<service>/Dockerfile`을 구성했다. 5개 서비스 모두 Build와 Health Check가 통과한다.

PKI 자료는 `../pki/runtime`에서 파일 단위 읽기 전용(`:ro`)으로 Mount한다. Management API에는 `root-ca.crt`·`intermediate-ca.crt`·`intermediate-ca.key`만, Gateway에는 `root-ca.crt`·`gateway.crt`·`gateway.key`만 주입한다. `root-ca.key`는 어떤 Container에도 Mount하지 않는다(`docs/security-design.md` §3).

Compose 서비스에는 아직 `restart:` 정책이 없다. Container가 종료되거나 Host가 재부팅되면 자동으로 다시 뜨지 않는다.

## 실행

~~~bash
cp ../.env.example ../.env
docker compose -f compose.yaml --env-file ../.env config
docker compose -f compose.yaml --env-file ../.env up -d --build
docker compose -f compose.yaml --env-file ../.env ps
~~~
