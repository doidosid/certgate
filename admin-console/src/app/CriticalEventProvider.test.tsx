import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { FakeEventSource } from "../mocks/fakeEventSource";
import { mockServer } from "../mocks/server";
import type { SecurityEvent } from "../shared/api/types";
import CriticalEventProvider from "./CriticalEventProvider";

const REVOKED = {
	eventId: "c8c78370-174f-4f88-b230-784e2d9115be",
	occurredAt: "2026-08-19T05:50:00Z",
	deviceKey: "sensor-floor-03",
	reasonCode: "CERTIFICATE_REVOKED",
	message: "폐기된 인증서의 접근이 차단되었습니다.",
};

function criticalEvent(id: string, occurredAt: string): SecurityEvent {
	return {
		id,
		occurredAt,
		type: "SYSTEM",
		severity: "CRITICAL",
		deviceId: null,
		certificateSerial: null,
		httpMethod: null,
		requestPath: null,
		decision: "ERROR",
		reasonCode: `OUTBOX_${id}`,
		clientIp: null,
		latencyMs: null,
		traceId: "b0b1b2b3-0000-4000-8000-00000000000a",
	};
}

/**
 * 목록 조회를 테스트가 통제한다. `pages`의 i번째 배열이 i번째 page 응답이고, 요청
 * URL은 그대로 기록해 커서·크기·severity를 검증한다.
 */
function stubSecurityEvents(pages: SecurityEvent[][], pageSize = 50) {
	const requests: URL[] = [];
	mockServer.use(
		http.get("/api/v1/security-events", ({ request }) => {
			const url = new URL(request.url);
			requests.push(url);
			const page = Number(url.searchParams.get("page") ?? "0");
			const content = pages[page] ?? [];
			return HttpResponse.json({
				content,
				page,
				size: pageSize,
				totalElements: pages.flat().length,
				totalPages: pages.length,
			});
		}),
	);
	return requests;
}

function renderProvider(strict = false) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree = (
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={["/"]}>
				<CriticalEventProvider>
					<Routes>
						<Route path="/" element={<div>app</div>} />
						<Route path="/security-events" element={<div>security events page</div>} />
					</Routes>
				</CriticalEventProvider>
			</MemoryRouter>
		</QueryClientProvider>
	);
	return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("CriticalEventProvider", () => {
	it("shows a toast with the message, device key and time on a critical event", async () => {
		stubSecurityEvents([[]]);
		renderProvider();

		act(() => FakeEventSource.last().emit("critical-security-event", REVOKED));

		expect(await screen.findByText(REVOKED.message)).toBeInTheDocument();
		expect(screen.getByText(/sensor-floor-03/)).toBeInTheDocument();
		expect(screen.getByText(/2026-08-19|2026-08-20/)).toBeInTheDocument();
	});

	it("does not auto-dismiss the toast", async () => {
		stubSecurityEvents([[]]);
		vi.useFakeTimers();
		renderProvider();
		act(() => FakeEventSource.last().emit("critical-security-event", REVOKED));
		expect(screen.getByText(REVOKED.message)).toBeInTheDocument();

		await act(() => vi.advanceTimersByTimeAsync(60_000));

		expect(screen.getByText(REVOKED.message)).toBeInTheDocument();
	});

	it("ignores a repeated eventId so a backfill does not duplicate toasts", async () => {
		stubSecurityEvents([[]]);
		renderProvider();

		act(() => {
			FakeEventSource.last().emit("critical-security-event", REVOKED);
			FakeEventSource.last().emit("critical-security-event", REVOKED);
		});

		expect(await screen.findAllByText(REVOKED.message)).toHaveLength(1);
	});

	it("links each toast to its own event, not to the reason code list", async () => {
		stubSecurityEvents([[]]);
		const user = userEvent.setup();
		renderProvider();
		act(() => FakeEventSource.last().emit("critical-security-event", REVOKED));

		const link = await screen.findByRole("link", { name: REVOKED.message });
		expect(link).toHaveAttribute("href", `/security-events?eventId=${REVOKED.eventId}`);

		await user.click(link);

		expect(await screen.findByText("security events page")).toBeInTheDocument();
		// 이동 후에는 그 Toast를 남겨두지 않는다 — 사용자가 이미 확인한 항목이다.
		expect(screen.queryByText(REVOKED.message)).not.toBeInTheDocument();
	});

	it("closes the toast the user dismisses and keeps the others", async () => {
		stubSecurityEvents([[]]);
		const user = userEvent.setup();
		renderProvider();

		act(() => {
			FakeEventSource.last().emit("critical-security-event", REVOKED);
			FakeEventSource.last().emit("critical-security-event", { ...REVOKED, eventId: "other", message: "두 번째 알림" });
		});
		await screen.findByText("두 번째 알림");

		// 새 알림이 위에 쌓이므로 두 번째 닫기 버튼이 REVOKED의 것이다.
		await user.click(screen.getAllByRole("button", { name: "닫기" })[1]);

		expect(screen.queryByText(REVOKED.message)).not.toBeInTheDocument();
		expect(screen.getByText("두 번째 알림")).toBeInTheDocument();
	});

	it("backfills on the very first connection, because events can be stored before the server registers the stream", async () => {
		const missed = criticalEvent("missed-1", "2026-08-19T05:55:00Z");
		// 첫 조회(커서 세우기)는 비어 있고, 그 뒤 open 시점에는 Event가 하나 생겨 있다.
		let call = 0;
		const requests: URL[] = [];
		mockServer.use(
			http.get("/api/v1/security-events", ({ request }) => {
				requests.push(new URL(request.url));
				call += 1;
				const content = call === 1 ? [] : [missed];
				return HttpResponse.json({ content, page: 0, size: 50, totalElements: content.length, totalPages: 1 });
			}),
		);
		renderProvider();
		await waitFor(() => expect(requests).toHaveLength(1));

		act(() => FakeEventSource.last().open());

		expect(await screen.findByText("OUTBOX_missed-1")).toBeInTheDocument();
	});

	it("uses the server timestamp as the backfill cursor, not the browser clock", async () => {
		// 브라우저 시계를 서버보다 훨씬 앞으로 돌린다. 브라우저 시각을 커서로 쓰면
		// 이후 조회가 미래에서 시작해 단절 구간을 통째로 건너뛴다.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
		const seed = criticalEvent("seed-1", "2026-08-19T05:00:00Z");
		const requests = stubSecurityEvents([[seed]]);
		renderProvider();
		await waitFor(() => expect(requests).toHaveLength(1));
		vi.useRealTimers();

		act(() => FakeEventSource.last().open());
		await waitFor(() => expect(requests).toHaveLength(2));

		expect(requests[1].searchParams.get("severity")).toBe("CRITICAL");
		expect(requests[1].searchParams.get("from")).toBe(seed.occurredAt);
		// 페이지를 열기 전 기록은 알림 대상이 아니다.
		expect(screen.queryByText("OUTBOX_seed-1")).not.toBeInTheDocument();
	});

	it("walks every backfill page so a long outage does not silently drop events", async () => {
		const first = Array.from({ length: 50 }, (_, i) => criticalEvent(`p1-${i}`, "2026-08-19T06:00:00Z"));
		const second = [criticalEvent("p2-0", "2026-08-19T05:00:00Z")];
		const requests = stubSecurityEvents([first, second]);
		renderProvider();
		await waitFor(() => expect(requests).toHaveLength(1));

		act(() => FakeEventSource.last().open());

		expect(await screen.findByText("OUTBOX_p2-0")).toBeInTheDocument();
		expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
		expect(requests.at(-1)?.searchParams.get("size")).toBe("50");
	});

	it("queues the events beyond the five it can show instead of discarding them", async () => {
		stubSecurityEvents([[]]);
		const user = userEvent.setup();
		renderProvider();

		act(() => {
			for (let index = 0; index < 7; index += 1) {
				FakeEventSource.last().emit("critical-security-event", {
					...REVOKED,
					eventId: `e${index}`,
					message: `알림 ${index}`,
				});
			}
		});

		expect(await screen.findByText("알림 6")).toBeInTheDocument();
		expect(screen.getAllByRole("button", { name: "닫기" })).toHaveLength(5);
		expect(screen.getByText(/확인하지 않은 CRITICAL 알림 2건 더/)).toBeInTheDocument();
		expect(screen.queryByText("알림 1")).not.toBeInTheDocument();

		await user.click(screen.getAllByRole("button", { name: "닫기" })[0]);

		// 밀려 있던 것이 버려지지 않고 올라온다.
		expect(screen.getByText("알림 1")).toBeInTheDocument();
		expect(screen.getByText(/확인하지 않은 CRITICAL 알림 1건 더/)).toBeInTheDocument();
	});

	it("retries the same range when a backfill fails", async () => {
		const missed = criticalEvent("after-failure", "2026-08-19T06:00:00Z");
		const seed = criticalEvent("seed-1", "2026-08-19T05:00:00Z");
		const requests: URL[] = [];
		let call = 0;
		mockServer.use(
			http.get("/api/v1/security-events", ({ request }) => {
				requests.push(new URL(request.url));
				call += 1;
				if (call === 2) {
					return HttpResponse.json({ code: "INTERNAL_ERROR", message: "실패", traceId: "t" }, { status: 500 });
				}
				const content = call === 1 ? [seed] : [missed];
				return HttpResponse.json({ content, page: 0, size: 50, totalElements: content.length, totalPages: 1 });
			}),
		);
		renderProvider();
		await waitFor(() => expect(requests).toHaveLength(1));

		act(() => FakeEventSource.last().open());
		await waitFor(() => expect(requests).toHaveLength(2));
		act(() => FakeEventSource.last().open());

		expect(await screen.findByText("OUTBOX_after-failure")).toBeInTheDocument();
		// 실패했을 때 커서를 옮기지 않았으므로 같은 구간을 다시 조회한다.
		expect(requests[2].searchParams.get("from")).toBe(seed.occurredAt);
	});

	it("ignores a payload whose rendered fields have the wrong type instead of taking the app down", async () => {
		stubSecurityEvents([[]]);
		renderProvider();

		act(() => {
			FakeEventSource.last().emit("critical-security-event", { ...REVOKED, message: { ko: "객체" } });
			FakeEventSource.last().emit("critical-security-event", {
				...REVOKED,
				eventId: "bad-device",
				deviceKey: { name: "객체" },
			});
			FakeEventSource.last().emit("critical-security-event", "not json at all");
		});

		expect(screen.getByText("app")).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("keeps a single live connection under StrictMode", async () => {
		stubSecurityEvents([[]]);
		renderProvider(true);

		await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
		const closed = FakeEventSource.instances.filter((source) => source.close.mock.calls.length > 0);
		expect(FakeEventSource.instances.length - closed.length).toBe(1);

		act(() => FakeEventSource.last().emit("critical-security-event", REVOKED));

		expect(await screen.findAllByText(REVOKED.message)).toHaveLength(1);
	});

	it("closes the connection on unmount", async () => {
		stubSecurityEvents([[]]);
		const { unmount } = renderProvider();
		const source = FakeEventSource.last();

		unmount();

		expect(source.close).toHaveBeenCalled();
	});
});
