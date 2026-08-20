import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FakeEventSource } from "./mocks/fakeEventSource";
import { mockServer } from "./mocks/server";

// jsdom에는 EventSource가 없다. 연결 사실을 기록하는 fake로 채운다 — 이유는
// mocks/fakeEventSource.ts 주석 참고.
vi.stubGlobal("EventSource", FakeEventSource);

// onUnhandledRequest: "error" — 테스트가 실수로 실제 네트워크를 때리는 순간 실패한다.
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
	cleanup();
	mockServer.resetHandlers();
	FakeEventSource.reset();
});

afterAll(() => mockServer.close());
