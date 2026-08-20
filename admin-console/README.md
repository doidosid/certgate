# Admin Console

React, TypeScript, Vite, MUI 기반 관리 콘솔이다.

구현 화면:

- Dashboard
- Devices
- Certificate Requests
- Certificates
- Security Events
- 전역 Critical Event SSE Toast

초기 Mock은 docs/api-spec.md와 동일한 JSON Fixture를 사용하고 실제 API 연결 시 Type을 바꾸지 않는다.

## 현재 상태

5개 화면(Dashboard, Devices, Certificate Requests, Certificates, Security Events)과 전역 Critical Event SSE Toast를 실제 Management API에 연결해 구현했다. 실제 화면 캡처는 [저장소 README](../README.md#관리-콘솔-화면)에 있다.

- 목록은 검색·필터·페이지네이션을 URL Query String에 두고(`shared/api/usePageParams.ts`) 별도 상태 관리 Library를 쓰지 않는다.
- 서버 상태는 TanStack Query가, 로딩·빈 상태·오류 표시는 `shared/ui/QueryState.tsx`가 한 곳에서 담당한다.
- API Type(`shared/api/types.ts`)과 Mock Fixture(`mocks/fixtures.ts`)는 `satisfies`로 묶여 있어 계약이 어긋나면 typecheck가 깨진다.
- Enum의 한국어 변환은 각 feature의 `labels.ts`에만 두고 화면에 흩뿌리지 않는다.

## 실행 방법

### 1. Mock 모드 — Backend 없이 화면만 본다

~~~bash
npm install
VITE_USE_MOCK=true npm run dev      # http://localhost:5173
~~~

MSW(`src/mocks`)가 Service Worker로 모든 API 요청을 가로챈다. 목록 handler는 쿼리 파라미터로 실제 필터링까지 하므로 필터·검색 동작을 그대로 확인할 수 있고, SSE도 흉내내므로 연결 3초 뒤 Critical Toast가 한 번 뜬다. `public/mockServiceWorker.js`는 Git에 추적되는 파일이라 지우면 흰 화면이 된다.

### 2. 전체 스택 — 실제 API에 연결한다

~~~bash
# 저장소 루트에서
cp .env.example .env
./pki/scripts/init-ca.sh && ./pki/scripts/issue-gateway-cert.sh
docker compose -f infra/compose.yaml --env-file .env up -d --build
~~~

Console은 <http://localhost:5173>에서 nginx가 `/api`를 Management API로 넘긴다.

Console만 dev server로 띄우고 Backend는 Compose를 쓰려면 `docker compose -f infra/compose.yaml --env-file .env up -d management-api` 후 `npm run dev`를 실행한다. Vite dev server proxy가 같은 `/api` 경로를 `localhost:8080`으로 넘긴다.

## API 연결 방식

Console은 Management API를 **same-origin 상대 경로**로 호출한다. 절대 URL로 직접 호출하면 cross-origin이 되는데, Management API에는 CORS 설정이 없어서 모든 요청이 차단된다.

| 환경 | `/api` 를 받는 주체 |
|---|---|
| 개발 (`npm run dev`) | Vite dev server proxy (`vite.config.ts`의 `server.proxy`) |
| 운영·Compose | nginx (`infra/docker/admin-console/nginx.conf`) |

둘 다 `/api/v1/**`를 Management API로 넘기므로 Console 코드는 한 가지 경로만 쓴다.

~~~dotenv
VITE_API_BASE_URL=/api/v1
VITE_SSE_URL=/api/v1/security-events/stream
~~~

> **이미 `.env`를 만들어 둔 개발 환경은 두 값을 위와 같이 갱신해야 한다.** `.env.example`만 바뀌었으므로 기존 `.env`에 남아 있는 `http://localhost:8080/...` 절대 URL은 proxy를 우회해 CORS 오류를 그대로 만난다.

`npm run dev`로 개발할 때는 Management API가 `localhost:8080`에 있어야 한다. Compose로 띄우거나(`docker compose -f infra/compose.yaml --env-file .env up -d management-api`) `management-api`에서 `./gradlew bootRun`을 실행한다.

## 개발 명령

~~~bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
~~~
