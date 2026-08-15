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

## 개발 명령

~~~bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
~~~
