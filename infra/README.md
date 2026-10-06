# Infrastructure

Docker Compose, Dockerfile, Health Check와 로컬 Network·Volume을 관리한다.

첫 목표는 빈 서비스라도 Compose Config와 Health 흐름을 검증하는 것이다. PostgreSQL과 Backend Service는 Host에 공개하지 않는다. 예외는 아래 "로컬 디버깅" 절의 Override뿐이다.

## 현재 상태

Foundation 단계: `compose.yaml`과 서비스별 `docker/<service>/Dockerfile`을 구성했다. 5개 서비스 모두 Build와 Health Check가 통과한다. PKI Volume Mount는 아직 구성하지 않았다.

## 실행

~~~bash
cp ../.env.example ../.env
docker compose -f compose.yaml --env-file ../.env config
docker compose -f compose.yaml --env-file ../.env up -d --build
docker compose -f compose.yaml --env-file ../.env ps
~~~

## 로컬 디버깅: PostgreSQL을 loopback에 열기

DB Client로 직접 보거나 Management API를 Compose 밖(IDE, `./gradlew bootRun`)에서 띄울 때만 `compose.local.yaml` Override를 함께 쓴다. PostgreSQL을 `127.0.0.1:${POSTGRES_PORT}`(기본 5432)에만 연다. CI와 기본 실행에는 쓰지 않는다.

~~~bash
docker compose -f compose.yaml -f compose.local.yaml --env-file ../.env up -d
~~~
