import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { mockServer } from "./mocks/server";

// onUnhandledRequest: "error" — 테스트가 실수로 실제 네트워크를 때리는 순간 실패한다.
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
	cleanup();
	mockServer.resetHandlers();
});

afterAll(() => mockServer.close());
