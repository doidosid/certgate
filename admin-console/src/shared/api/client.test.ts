import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiGetText, apiSend } from "./client";
import { ApiError } from "./ApiError";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("apiGet", () => {
	it("appends only the query params that have a value", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { content: [] }));
		vi.stubGlobal("fetch", fetchMock);

		await apiGet("/devices", { page: 0, status: "ACTIVE", roleName: undefined, query: "" });

		const url = String(fetchMock.mock.calls[0][0]);
		expect(url).toContain("page=0");
		expect(url).toContain("status=ACTIVE");
		expect(url).not.toContain("roleName");
		expect(url).not.toContain("query=");
	});

	it("sends a generated X-Trace-Id header", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
		vi.stubGlobal("fetch", fetchMock);

		await apiGet("/devices");

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.get("X-Trace-Id")).toMatch(/[0-9a-f-]{36}/);
	});

	it("throws ApiError carrying the server code and traceId", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(409, {
					code: "CERTIFICATE_REQUEST_NOT_PENDING",
					message: "이미 처리된 요청입니다.",
					traceId: "trace-1",
					fieldErrors: [],
				}),
			),
		);

		await expect(apiGet("/certificate-requests/1")).rejects.toMatchObject({
			status: 409,
			code: "CERTIFICATE_REQUEST_NOT_PENDING",
			message: "이미 처리된 요청입니다.",
			traceId: "trace-1",
		});
	});

	it("turns a non-JSON error body into an INTERNAL_ERROR ApiError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
		);

		const error = await apiGet("/devices").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).code).toBe("INTERNAL_ERROR");
	});

	/**
	 * Issue #39: 매핑되지 않은 경로는 아직 404가 아니라 500 INTERNAL_ERROR로 온다.
	 * 서버가 오류 계약을 지키는 한 Client는 그대로 전달만 하면 되고, Issue #39가
	 * 고쳐져 404로 바뀌어도 이 코드는 바뀔 필요가 없어야 한다.
	 */
	it("preserves the server status even when the code is INTERNAL_ERROR", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(500, {
					code: "INTERNAL_ERROR",
					message: "내부 오류가 발생했습니다.",
					traceId: "trace-2",
					fieldErrors: [],
				}),
			),
		);

		const error = (await apiGet("/nope").catch((e: unknown) => e)) as ApiError;
		expect(error.status).toBe(500);
		expect(error.traceId).toBe("trace-2");
	});

	/** 서버가 traceId를 비워 보내도 진단 단서가 사라지면 안 된다. */
	it("falls back to the request's own trace id when the body has none", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse(400, { code: "MALFORMED_REQUEST_BODY", message: "잘못된 요청", traceId: "", fieldErrors: [] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const error = (await apiGet("/devices").catch((e: unknown) => e)) as ApiError;
		const sentTraceId = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get("X-Trace-Id");

		expect(error.traceId).toBe(sentTraceId);
	});

	/**
	 * Codex 리뷰 PR #43 Medium: traceId가 객체로 오면 QueryState가 그것을 JSX로
	 * 렌더링하다 터져 오류 화면 자체가 사라진다. 계약 위반은 ApiError에 싣지 않는다.
	 */
	it.each([
		["traceId가 객체", { code: "X", message: "m", traceId: {}, fieldErrors: [] }],
		["fieldErrors가 문자열", { code: "X", message: "m", traceId: "t", fieldErrors: "bad" }],
		["fieldErrors 원소가 잘못됨", { code: "X", message: "m", traceId: "t", fieldErrors: [{ field: 1 }] }],
	])("falls back to INTERNAL_ERROR when the error body violates the contract (%s)", async (_label, body) => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, body)));

		const error = (await apiGet("/devices").catch((e: unknown) => e)) as ApiError;

		expect(error.code).toBe("INTERNAL_ERROR");
		expect(typeof error.traceId).toBe("string");
		expect(Array.isArray(error.fieldErrors)).toBe(true);
	});

	it("accepts an error body that omits traceId and fieldErrors entirely", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND", message: "없습니다." }));
		vi.stubGlobal("fetch", fetchMock);

		const error = (await apiGet("/devices/1").catch((e: unknown) => e)) as ApiError;
		const sentTraceId = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get("X-Trace-Id");

		expect(error.code).toBe("NOT_FOUND");
		expect(error.traceId).toBe(sentTraceId);
		expect(error.fieldErrors).toEqual([]);
	});

	it("keeps fieldErrors from a validation failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(400, {
					code: "DEVICE_KEY_REQUIRED",
					message: "deviceKey는 필수입니다.",
					traceId: "trace-3",
					fieldErrors: [{ field: "deviceKey", message: "필수" }],
				}),
			),
		);

		const error = (await apiGet("/devices").catch((e: unknown) => e)) as ApiError;
		expect(error.fieldErrors).toEqual([{ field: "deviceKey", message: "필수" }]);
	});
});

describe("apiSend", () => {
	it("omits the body entirely when none is given", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
		vi.stubGlobal("fetch", fetchMock);

		await apiSend("POST", "/devices/1/enrollment-token");

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.body).toBeUndefined();
	});

	it("returns undefined for 204 No Content", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

		await expect(apiSend("POST", "/x")).resolves.toBeUndefined();
	});

	it("sends a JSON body and Content-Type when one is given", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
		vi.stubGlobal("fetch", fetchMock);

		await apiSend("PATCH", "/devices/1/status", { status: "DISABLED" });

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.body).toBe(JSON.stringify({ status: "DISABLED" }));
		expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
	});
});

describe("apiGetText", () => {
	/** GET /certificates/{id}/download는 JSON이 아니라 PEM 문자열이다. */
	it("returns the raw body instead of parsing it", async () => {
		const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pem, { status: 200 })));

		await expect(apiGetText("/certificates/1/download")).resolves.toBe(pem);
	});

	it("still raises ApiError on failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(404, { code: "CERTIFICATE_NOT_FOUND", message: "없습니다.", traceId: "t", fieldErrors: [] }),
			),
		);

		await expect(apiGetText("/certificates/1/download")).rejects.toBeInstanceOf(ApiError);
	});

	/** PEM endpoint의 오류가 늘 JSON인 것은 아니다 — Proxy가 HTML을 돌려줄 수 있다. */
	it("raises ApiError for a non-JSON error body too", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })));

		const error = (await apiGetText("/certificates/1/download").catch((e: unknown) => e)) as ApiError;

		expect(error).toBeInstanceOf(ApiError);
		expect(error.code).toBe("INTERNAL_ERROR");
	});
});
