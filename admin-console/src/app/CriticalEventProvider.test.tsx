import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { mockServer } from "../mocks/server";
import CriticalEventProvider from "./CriticalEventProvider";

/** jsdom에는 EventSource가 없다. 연결·재연결을 테스트가 직접 일으키는 가짜로 대신한다. */
class FakeEventSource {
	static instances: FakeEventSource[] = [];
	listeners = new Map<string, (event: MessageEvent) => void>();
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	close = vi.fn();
	url: string;

	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, handler: (event: MessageEvent) => void) {
		this.listeners.set(type, handler);
	}

	emit(type: string, data: unknown) {
		this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
	}
}

function firstSource(): FakeEventSource {
	const source = FakeEventSource.instances.at(-1);
	if (!source) {
		throw new Error("EventSource가 만들어지지 않았다");
	}
	return source;
}

const REVOKED = {
	eventId: "c8c78370-174f-4f88-b230-784e2d9115be",
	occurredAt: "2026-08-19T05:50:00Z",
	deviceKey: "sensor-floor-03",
	reasonCode: "CERTIFICATE_REVOKED",
	message: "폐기된 인증서의 접근이 차단되었습니다.",
};

function renderProvider() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={["/"]}>
				<CriticalEventProvider>
					<Routes>
						<Route path="/" element={<div>app</div>} />
						<Route path="/security-events" element={<div>security events page</div>} />
					</Routes>
				</CriticalEventProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	FakeEventSource.instances = [];
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("CriticalEventProvider", () => {
	it("shows a toast with the message, device key and time on a critical event", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		renderProvider();

		firstSource().emit("critical-security-event", REVOKED);

		expect(await screen.findByText(REVOKED.message)).toBeInTheDocument();
		expect(screen.getByText(/sensor-floor-03/)).toBeInTheDocument();
		expect(screen.getByText(/2026-08-19|2026-08-1[89]/)).toBeInTheDocument();
	});

	it("does not auto-dismiss the toast", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		vi.useFakeTimers();
		renderProvider();
		act(() =>
			firstSource().emit("critical-security-event", {
				eventId: "e1",
				occurredAt: "2026-08-19T05:50:00Z",
				deviceKey: null,
				reasonCode: "EVENT_OUTBOX_BACKLOG",
				message: "Gateway Security Event Outbox가 적체되었습니다.",
			}),
		);
		expect(screen.getByText("Gateway Security Event Outbox가 적체되었습니다.")).toBeInTheDocument();

		await act(() => vi.advanceTimersByTimeAsync(60_000));

		expect(screen.getByText("Gateway Security Event Outbox가 적체되었습니다.")).toBeInTheDocument();
	});

	it("ignores a repeated eventId so a reconnect backfill does not duplicate toasts", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		renderProvider();

		firstSource().emit("critical-security-event", REVOKED);
		firstSource().emit("critical-security-event", REVOKED);

		expect(await screen.findAllByText(REVOKED.message)).toHaveLength(1);
	});

	it("closes the toast the user dismisses and keeps the others", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		const user = userEvent.setup();
		renderProvider();

		firstSource().emit("critical-security-event", REVOKED);
		firstSource().emit("critical-security-event", { ...REVOKED, eventId: "other", message: "두 번째 알림" });
		await screen.findByText("두 번째 알림");

		// 새 알림이 위에 쌓이므로 두 번째 닫기 버튼이 REVOKED의 것이다.
		await user.click(screen.getAllByRole("button", { name: "닫기" })[1]);

		expect(screen.queryByText(REVOKED.message)).not.toBeInTheDocument();
		expect(screen.getByText("두 번째 알림")).toBeInTheDocument();
	});

	it("navigates to the matching security events filter when the toast is clicked", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		const user = userEvent.setup();
		renderProvider();

		firstSource().emit("critical-security-event", REVOKED);
		await user.click(await screen.findByText(REVOKED.message));

		expect(await screen.findByText("security events page")).toBeInTheDocument();
		// 이동 후에는 그 Toast를 남겨두지 않는다 — 사용자가 이미 확인한 항목이다.
		expect(screen.queryByText(REVOKED.message)).not.toBeInTheDocument();
	});

	it("backfills the critical events missed while disconnected, from the last one seen", async () => {
		const requestedUrls: string[] = [];
		mockServer.use(
			http.get("/api/v1/security-events", ({ request }) => {
				requestedUrls.push(request.url);
				return HttpResponse.json({
					content: [
						{
							id: "backfilled-1",
							occurredAt: "2026-08-19T05:52:00Z",
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
							traceId: "8a6ba949-f3ec-4916-aae2-d55bd787893d",
						},
					],
					page: 0,
					size: 20,
					totalElements: 1,
					totalPages: 1,
				});
			}),
		);
		vi.stubGlobal("EventSource", FakeEventSource);
		// 보완 조회의 시작점은 마운트 시각이다. 그 뒤에 도착한 Event로 시작점이 앞으로
		// 옮겨가는지 보려면 마운트 시각이 Event보다 앞서야 한다 — Date만 고정한다.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-08-19T05:00:00Z"));
		renderProvider();
		vi.useRealTimers();

		const source = firstSource();
		// 최초 연결에서는 보완 조회하지 않는다 — 놓친 구간이 없다.
		source.onopen?.();
		source.emit("critical-security-event", REVOKED);
		await screen.findByText(REVOKED.message);
		expect(requestedUrls).toHaveLength(0);

		source.onerror?.();
		source.onopen?.();

		expect(await screen.findByText("EVENT_OUTBOX_BACKLOG")).toBeInTheDocument();
		expect(requestedUrls).toHaveLength(1);
		const query = new URL(requestedUrls[0]).searchParams;
		expect(query.get("severity")).toBe("CRITICAL");
		expect(query.get("from")).toBe(REVOKED.occurredAt);
	});

	it("keeps at most five toasts so a long outage cannot bury the screen", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		renderProvider();

		for (let index = 0; index < 6; index += 1) {
			firstSource().emit("critical-security-event", {
				...REVOKED,
				eventId: `e${index}`,
				message: `알림 ${index}`,
			});
		}

		expect(await screen.findByText("알림 5")).toBeInTheDocument();
		expect(screen.getAllByRole("alert")).toHaveLength(5);
		// 가장 오래된 것이 밀려난다.
		expect(screen.queryByText("알림 0")).not.toBeInTheDocument();
	});

	it("closes the connection on unmount", () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		const { unmount } = renderProvider();
		unmount();
		expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
	});
});
