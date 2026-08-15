# Infrastructure

Docker Compose, Dockerfile, Health Check와 로컬 Network·Volume을 관리한다.

첫 목표는 빈 서비스라도 Compose Config와 Health 흐름을 검증하는 것이다. PostgreSQL과 Backend Service는 Host에 공개하지 않는다.

## 현재 상태

Foundation 단계: `compose.yaml`과 서비스별 `docker/<service>/Dockerfile`을 구성했다. 5개 서비스 모두 Build와 Health Check가 통과한다. PKI Volume Mount는 아직 구성하지 않았다.

## 실행

~~~bash
cp ../.env.example ../.env
docker compose -f compose.yaml --env-file ../.env config
docker compose -f compose.yaml --env-file ../.env up -d --build
docker compose -f compose.yaml --env-file ../.env ps
~~~
