import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";
import { dashboardSummary } from "../mocks/fixtures";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

describe("DashboardPage", () => {
	it("renders the four summary cards", async () => {
		renderAt("/");

		expect(await screen.findByText("활성 디바이스")).toBeInTheDocument();
		expect(screen.getByText("24 / 27")).toBeInTheDocument();
		expect(screen.getByText("승인 대기 CSR")).toBeInTheDocument();
		expect(screen.getByText("Critical Event (24h)")).toBeInTheDocument();
	});

	it("shows the expiring-soon count next to valid certificates", async () => {
		renderAt("/");

		expect(await screen.findByText("만료 임박 2건")).toBeInTheDocument();
	});

	it("renders the request trend without a chart library, from the hourly buckets", async () => {
		renderAt("/");

		// UTC 04:00을 로컬 시간으로 표시한다 — 하드코딩하면 이 환경의 타임존에서만 통과한다.
		const localHour = String(new Date("2026-08-13T04:00:00Z").getHours()).padStart(2, "0");
		expect(await screen.findByText(`${localHour}:00`)).toBeInTheDocument();
		expect(screen.getByText("208")).toBeInTheDocument();
		expect(screen.getByText("4")).toBeInTheDocument();
	});

	it("shows every service's status and latency", async () => {
		renderAt("/");

		expect(await screen.findByText("gateway")).toBeInTheDocument();
		expect(screen.getAllByText("정상")).toHaveLength(3);
		expect(screen.getByText("12ms")).toBeInTheDocument();
	});

	/**
	 * 조회 실패로 latencyMs가 null이면 "장애"로 지어내지 않고 값 없음을 그대로 보여준다.
	 * 이 fixture의 recentCriticalEvents는 deviceId가 null인 SYSTEM Event를 포함하므로
	 * 그쪽도 "—"를 렌더링한다 — 그래서 정확히 1건이 아니라 존재 여부로만 확인한다.
	 */
	it("shows a dash instead of inventing a latency for a down service", async () => {
		mockServer.use(
			http.get("/api/v1/dashboard/summary", () =>
				HttpResponse.json({
					...dashboardSummary,
					services: [{ name: "gateway", status: "DOWN", latencyMs: null }],
				}),
			),
		);
		renderAt("/");

		expect(await screen.findByText("장애")).toBeInTheDocument();
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	});

	/**
	 * 숫자는 등폭(Mono)으로 감싸 별도 요소가 되므로, 부모 컨테이너의 합쳐진 텍스트로
	 * 확인한다 — 자식 요소가 섞인 텍스트는 findByText 정규식이 직접 잡지 못한다.
	 */
	function findByCombinedText(pattern: RegExp): Promise<HTMLElement> {
		return screen.findByText((_, element) => {
			if (!element) {
				return false;
			}
			const matches = pattern.test(element.textContent ?? "");
			// 가장 좁은 매치만 남긴다 — 그러지 않으면 이 요소를 감싸는 Paper·Grid 같은
			// 상위 요소도 같은 텍스트를 포함해 함께 매치되어 "여러 개 찾음" 오류가 난다.
			const noChildMatches = Array.from(element.children).every(
				(child) => !pattern.test(child.textContent ?? ""),
			);
			return matches && noChildMatches;
		});
	}

	it("renders the Gateway Outbox panel", async () => {
		renderAt("/");

		expect(await findByCombinedText(/대기\s*12\s*건/)).toBeInTheDocument();
		expect(await findByCombinedText(/최고 지연\s*24\s*초/)).toBeInTheDocument();
	});

	/**
	 * security-design.md §9와 같은 값(100건·60초)을 넘으면 강조한다. 실제 theme 색상 값에
	 * 의존하지 않는다 — 이 테스트 harness는 ThemeProvider를 씌우지 않아 MUI 기본 팔레트로
	 * 렌더링되므로, 정상 상태와 임계값을 넘긴 상태의 색이 실제로 다른지만 비교한다.
	 */
	it("highlights the outbox panel once it crosses the CRITICAL threshold", async () => {
		const { unmount } = renderAt("/");
		const normalColor = window.getComputedStyle(await findByCombinedText(/대기\s*12\s*건/)).color;
		unmount();

		mockServer.use(
			http.get("/api/v1/dashboard/summary", () =>
				HttpResponse.json({ ...dashboardSummary, outbox: { pendingCount: 100, oldestAgeSeconds: 5 } }),
			),
		);
		renderAt("/");
		const criticalColor = window.getComputedStyle(await findByCombinedText(/대기\s*100\s*건/)).color;

		expect(criticalColor).not.toBe(normalColor);
	});

	it("says the Outbox state is unavailable when the server returns null", async () => {
		mockServer.use(
			http.get("/api/v1/dashboard/summary", () => HttpResponse.json({ ...dashboardSummary, outbox: null })),
		);
		renderAt("/");

		expect(await screen.findByText("Gateway Outbox 상태를 확인할 수 없습니다.")).toBeInTheDocument();
	});

	it("shows the empty state when there is no recent critical event", async () => {
		mockServer.use(
			http.get("/api/v1/dashboard/summary", () =>
				HttpResponse.json({ ...dashboardSummary, recentCriticalEvents: [] }),
			),
		);
		renderAt("/");

		expect(await screen.findByText("최근 Critical Event가 없습니다.")).toBeInTheDocument();
	});

	/** ui-design.md §3 "패널 항목 클릭 시 보안 이벤트 상세로 이동". */
	it("navigates to the filtered security events list when a recent critical item is clicked", async () => {
		renderAt("/");

		await userEvent.click(await screen.findByText("EVENT_OUTBOX_BACKLOG"));

		expect(await screen.findByRole("heading", { name: "Security Events" })).toBeInTheDocument();
		// URL의 reasonCode 필터가 실제로 화면에 반영됐는지, select 값으로 확인한다.
		expect(await screen.findByDisplayValue("EVENT_OUTBOX_BACKLOG")).toBeInTheDocument();
	});

	it("shows the server error message and traceId when the summary fails", async () => {
		mockServer.use(
			http.get("/api/v1/dashboard/summary", () =>
				HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "일시적인 오류입니다.", traceId: "trace-13", fieldErrors: [] },
					{ status: 500 },
				),
			),
		);
		renderAt("/");

		expect(await screen.findByText("일시적인 오류입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-13/)).toBeInTheDocument();
	});
});
