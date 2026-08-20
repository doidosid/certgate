import { describe, expect, it } from "vitest";
import { apiGet } from "../shared/api/client";
import { filterPage, withinRange } from "./filterPage";
import { mockServer } from "./server";
import { http, HttpResponse } from "msw";
import type { PageResponse, SecurityEvent } from "../shared/api/types";

/**
 * Mock이 실제 서버와 다른 계약을 흉내내면, 이 Mock 위에서 도는 화면 테스트는 실제와
 * 어긋난 동작을 검증하게 된다(Codex 리뷰 PR #49 Medium). 서버 쪽 근거는 각 테스트
 * 주석에 적었다.
 */
describe("filterPage", () => {
	const items = Array.from({ length: 25 }, (_, index) => ({ index }));
	const all = () => true;

	it("returns everything as one page when no page params are given", () => {
		const page = filterPage(items, all);

		expect(page.content).toHaveLength(20);
		expect(page.size).toBe(20);
		expect(page.totalElements).toBe(25);
		expect(page.totalPages).toBe(2);
	});

	it("slices the requested page like the server does", () => {
		const page = filterPage(items, all, new URLSearchParams("page=1&size=10"));

		expect(page.content.map((item) => item.index)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
		expect(page.page).toBe(1);
		expect(page.totalPages).toBe(3);
	});

	/** api-spec.md §1: size는 1~100. 서버 Controller도 이 범위로 clamp한다. */
	it("clamps size the same way the server controller does", () => {
		expect(filterPage(items, all, new URLSearchParams("size=1000")).size).toBe(100);
		expect(filterPage(items, all, new URLSearchParams("size=0")).size).toBe(1);
	});

	/** 빈 결과의 totalPages는 Spring `Page`와 같이 0이다 — 1이면 빈 1페이지처럼 보인다. */
	it("reports zero total pages for an empty result", () => {
		const page = filterPage(items, () => false);

		expect(page.totalElements).toBe(0);
		expect(page.totalPages).toBe(0);
	});

	/** 범위를 벗어난 page는 서버와 같이 빈 content에 전체 건수를 유지한다. */
	it("keeps the total when the requested page is past the end", () => {
		const page = filterPage(items, all, new URLSearchParams("page=9&size=10"));

		expect(page.content).toHaveLength(0);
		expect(page.totalElements).toBe(25);
	});
});

describe("withinRange", () => {
	/**
	 * `SecurityEventRepository#search`는 `e.occurredAt >= :from AND e.occurredAt <= :to`다.
	 * 둘 다 포함이므로 종료 시각과 정확히 같은 Event도 결과에 들어간다.
	 */
	it("includes both boundaries, like the server query", () => {
		expect(withinRange("2026-08-19T05:00:00Z", "2026-08-19T05:00:00Z", "2026-08-19T06:00:00Z")).toBe(true);
		expect(withinRange("2026-08-19T06:00:00Z", "2026-08-19T05:00:00Z", "2026-08-19T06:00:00Z")).toBe(true);
		expect(withinRange("2026-08-19T06:00:01Z", "2026-08-19T05:00:00Z", "2026-08-19T06:00:00Z")).toBe(false);
		expect(withinRange("2026-08-19T04:59:59Z", "2026-08-19T05:00:00Z", "2026-08-19T06:00:00Z")).toBe(false);
	});

	it("passes everything through when a bound is missing", () => {
		expect(withinRange("2026-08-19T05:00:00Z", null, null)).toBe(true);
	});
});

describe("security event handler", () => {
	it("keeps an event that happened exactly at the `to` boundary", async () => {
		const atBoundary: SecurityEvent = {
			id: "boundary-1",
			occurredAt: "2026-08-19T06:00:00Z",
			type: "SYSTEM",
			severity: "CRITICAL",
			deviceId: null,
			certificateSerial: null,
			httpMethod: null,
			requestPath: null,
			decision: "ERROR",
			reasonCode: "EVENT_OUTBOX_BACKLOG",
			clientIp: null,
			latencyMs: null,
			traceId: "t",
		};
		mockServer.use(
			http.get("/api/v1/security-events", ({ request }) => {
				const params = new URL(request.url).searchParams;
				return HttpResponse.json(
					filterPage([atBoundary], (event) => withinRange(event.occurredAt, params.get("from"), params.get("to")), params),
				);
			}),
		);

		const page = await apiGet<PageResponse<SecurityEvent>>("/security-events", {
			from: "2026-08-19T05:00:00Z",
			to: "2026-08-19T06:00:00Z",
		});

		expect(page.content).toHaveLength(1);
	});
});
