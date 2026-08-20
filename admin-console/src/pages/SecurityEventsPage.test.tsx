import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";
import { securityEventPage } from "../mocks/fixtures";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

/** 목록 요청의 Query String을 순서대로 모아준다. */
function captureListRequests(): string[] {
	const seen: string[] = [];
	mockServer.use(
		http.get("/api/v1/security-events", ({ request }) => {
			seen.push(new URL(request.url).search);
			return HttpResponse.json(securityEventPage);
		}),
	);
	return seen;
}

describe("SecurityEventsPage", () => {
	it("renders decision and severity as Korean labels", async () => {
		renderAt("/security-events");

		expect(await screen.findByText("허용")).toBeInTheDocument();
		expect(screen.getByText("정보")).toBeInTheDocument();
		expect(screen.getByText("오류")).toBeInTheDocument();
		expect(screen.getByText("심각")).toBeInTheDocument();
	});

	/**
	 * 서버 응답에는 deviceId(UUID)만 있다(SecurityEventResponse). ui-design.md §7이
	 * 요구하는 "디바이스" 열을 UUID로 채우면 읽을 수 없으므로 Device 목록으로
	 * 이름을 찾아 보여주고, 상세로 갈 수 있게 링크로 만든다.
	 */
	it("shows the device name for the event's deviceId and links to its detail page", async () => {
		renderAt("/security-events");

		const link = await screen.findByRole("link", { name: "1층 온도 센서" });
		expect(link).toHaveAttribute("href", "/devices/0d6515ae-d560-4777-b102-054e71f98ef9");
	});

	/** Device 목록에 없는 deviceId는 이름을 숨기지 않고 UUID를 그대로 드러낸다. */
	it("falls back to the raw deviceId when the device is not in the loaded list", async () => {
		mockServer.use(
			http.get("/api/v1/security-events", () =>
				HttpResponse.json({
					...securityEventPage,
					content: [{ ...securityEventPage.content[0], deviceId: "ffffffff-0000-4000-8000-000000000fff" }],
				}),
			),
		);
		renderAt("/security-events");

		expect(
			await screen.findByRole("link", { name: "ffffffff-0000-4000-8000-000000000fff" }),
		).toBeInTheDocument();
	});

	/** SYSTEM Event에는 Device·요청 경로·응답 시간이 없다. 빈 칸이 아니라 없음을 표시한다. */
	it("marks the missing device, path and latency of a SYSTEM event", async () => {
		renderAt("/security-events");

		const row = (await screen.findByText("EVENT_OUTBOX_BACKLOG")).closest("tr");
		expect(row).not.toBeNull();
		// 첫 열 control은 button이므로(DataTable) Device 링크가 없으면 anchor가 없다.
		expect(row?.querySelectorAll("a")).toHaveLength(0);
		expect(row?.textContent).toContain("—");
	});

	it("opens the detail drawer with the certificate serial and traceId when a row is clicked", async () => {
		renderAt("/security-events");
		await userEvent.click(await screen.findByText("REQUEST_ALLOWED"));

		expect(await screen.findByRole("heading", { name: "보안 이벤트 상세" })).toBeInTheDocument();
		expect(screen.getByText("8a6ba949-f3ec-4916-aae2-d55bd787893d")).toBeInTheDocument();
		expect(screen.getByText("7F28A109")).toBeInTheDocument();
		expect(screen.getByText("접근")).toBeInTheDocument();
	});

	it("shows the empty state when the server returns no events", async () => {
		mockServer.use(
			http.get("/api/v1/security-events", () =>
				HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
			),
		);
		renderAt("/security-events");

		expect(await screen.findByText("조건에 맞는 보안 이벤트가 없습니다.")).toBeInTheDocument();
	});

	/** 범위를 벗어난 page에서 표까지 사라지면 첫 페이지로 돌아올 수 없다(Codex 리뷰 PR #44 Medium). */
	it("keeps pagination on an out-of-range page so the user can go back", async () => {
		mockServer.use(
			http.get("/api/v1/security-events", () =>
				HttpResponse.json({ content: [], page: 1, size: 20, totalElements: 2, totalPages: 1 }),
			),
		);
		renderAt("/security-events?page=1");

		expect(await screen.findByRole("button", { name: /이전 페이지|Go to previous page/i })).toBeInTheDocument();
		expect(screen.queryByText("조건에 맞는 보안 이벤트가 없습니다.")).not.toBeInTheDocument();
	});

	it("sends the filters from the URL to the server", async () => {
		const seen = captureListRequests();
		renderAt(
			"/security-events?deviceId=0d6515ae-d560-4777-b102-054e71f98ef9&decision=DENIED&severity=CRITICAL&reasonCode=ACCESS_DENIED&page=1&size=50",
		);
		await screen.findByText("허용");

		expect(seen[0]).toContain("deviceId=0d6515ae-d560-4777-b102-054e71f98ef9");
		expect(seen[0]).toContain("decision=DENIED");
		expect(seen[0]).toContain("severity=CRITICAL");
		expect(seen[0]).toContain("reasonCode=ACCESS_DENIED");
		expect(seen[0]).toContain("page=1");
		expect(seen[0]).toContain("size=50");
	});

	/**
	 * datetime-local 입력은 로컬 시간이고 서버는 ISO 8601 UTC를 받는다
	 * (SecurityEventQueryController의 @DateTimeFormat ISO.DATE_TIME).
	 */
	it("converts the local datetime filter to a UTC instant", async () => {
		const seen = captureListRequests();
		renderAt("/security-events?from=2026-08-13T09:00&to=2026-08-13T18:30");
		await screen.findByText("허용");

		expect(seen[0]).toContain(`from=${encodeURIComponent(new Date("2026-08-13T09:00").toISOString())}`);
		expect(seen[0]).toContain(`to=${encodeURIComponent(new Date("2026-08-13T18:30").toISOString())}`);
	});

	/** 사용자가 URL을 직접 고칠 수 있다. 날짜가 아닌 값을 서버로 흘려보내 400을 만들지 않는다. */
	it("drops an unparseable datetime instead of sending it to the server", async () => {
		const seen = captureListRequests();
		renderAt("/security-events?from=notadate");
		await screen.findByText("허용");

		expect(seen[0]).not.toContain("from=");
	});

	it("changes the filter and refetches with it", async () => {
		const seen = captureListRequests();
		renderAt("/security-events");
		await screen.findByText("허용");

		await userEvent.click(screen.getByLabelText("결과"));
		await userEvent.click(await screen.findByRole("option", { name: "차단" }));

		await expect.poll(() => seen.some((search) => search.includes("decision=DENIED"))).toBe(true);
	});

	it("shows the server error message and traceId when the list fails", async () => {
		mockServer.use(
			http.get("/api/v1/security-events", () =>
				HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "일시적인 오류입니다.", traceId: "trace-9", fieldErrors: [] },
					{ status: 500 },
				),
			),
		);
		renderAt("/security-events");

		expect(await screen.findByText("일시적인 오류입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-9/)).toBeInTheDocument();
	});

	/**
	 * Device 목록은 보조 조회다. 실패해도 Event 목록은 그대로 보여주되, 필터가 왜
	 * 비었는지 알리고 화면 안에서 다시 시도할 수 있어야 한다(Codex 리뷰 PR #44 Low).
	 */
	it("surfaces a device lookup failure with an in-place retry and keeps the event list", async () => {
		let attempts = 0;
		mockServer.use(
			http.get("/api/v1/devices", () => {
				attempts += 1;
				return HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "실패", traceId: "t", fieldErrors: [] },
					{ status: 500 },
				);
			}),
		);
		renderAt("/security-events");

		expect(await screen.findByText("Device 목록을 불러오지 못했습니다.")).toBeInTheDocument();
		expect(screen.getByText("REQUEST_ALLOWED")).toBeInTheDocument();

		const before = attempts;
		await userEvent.click(screen.getByRole("button", { name: "Device 목록 다시 불러오기" }));
		await expect.poll(() => attempts > before).toBe(true);
	});

	/** 조용히 잘리면 없는 Device를 사용자가 필터에서 찾지 못하는 이유를 알 수 없다. */
	it("says so when there are more devices than the filter can list", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json({ content: [], page: 0, size: 100, totalElements: 240, totalPages: 3 }),
			),
		);
		renderAt("/security-events");

		expect(await screen.findByText(/처음 100개만/)).toBeInTheDocument();
	});
});
