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

Foundation 단계: Vite + React + TypeScript(strict) + MUI 골격과 `app/pages/shared` 구조, 5개 화면의 자리표시자 Page만 구성했다. Vitest + Testing Library로 Router·Navigation을 검증한다. API 연동과 Mock Fixture는 아직 구현하지 않았다.

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
