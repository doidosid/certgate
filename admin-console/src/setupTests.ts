import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { mockServer } from "./mocks/server";

/**
 * jsdom에는 EventSource가 없다. `AppLayout`이 CRITICAL Toast Provider를 감싸면서
 * 화면 테스트마다 하나가 만들어지므로, 연결도 이벤트도 없는 껍데기로 채워 둔다.
 * 실제 SSE 동작(수신·중복 제거·재연결 보완 조회)은 CriticalEventProvider.test.tsx가
 * 자체 가짜로 검증한다.
 */
class InertEventSource {
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	addEventListener() {}
	removeEventListener() {}
	close() {}
}
vi.stubGlobal("EventSource", InertEventSource);

// onUnhandledRequest: "error" — 테스트가 실수로 실제 네트워크를 때리는 순간 실패한다.
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
	cleanup();
	mockServer.resetHandlers();
});

afterAll(() => mockServer.close());
