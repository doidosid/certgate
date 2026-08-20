import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";
import { devicePage, securityEventPage } from "../mocks/fixtures";

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

		// 기대값을 구현과 같은 new Date(문자열)로 만들면 같은 보정 오류를 정답으로
		// 받아들인다(Codex 리뷰 PR #46 Medium). 자리별 값으로 직접 만든다.
		expect(seen[0]).toContain(`from=${encodeURIComponent(new Date(2026, 7, 13, 9, 0, 0).toISOString())}`);
		expect(seen[0]).toContain(`to=${encodeURIComponent(new Date(2026, 7, 13, 18, 30, 0).toISOString())}`);
	});

	/**
	 * 사용자가 URL을 직접 고칠 수 있다. 날짜가 아닌 값과 달력에 없는 값을 서버로
	 * 흘려보내지 않는다 — 후자는 조용히 다른 범위를 조회하게 만든다. 변환 규칙 자체는
	 * shared/api/localDateTime.test.ts가 자리별로 검증한다.
	 */
	it.each([
		["날짜가 아닌 값", "notadate"],
		["달력에 없는 날", "2026-02-30T09:00"],
	])("서버로 보내지 않는다: %s", async (_label, value) => {
		const seen = captureListRequests();
		renderAt(`/security-events?from=${encodeURIComponent(value)}`);
		await screen.findByText("허용");

		expect(seen[0]).not.toContain("from=");
	});

	it("tells the user when the range is reversed instead of showing an unexplained empty result", async () => {
		renderAt("/security-events?from=2026-08-13T18:00&to=2026-08-13T09:00");

		expect(await screen.findByText("종료가 시작보다 앞서 결과가 없습니다.")).toBeInTheDocument();
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

	/** 한 페이지에 담기지 않는 수의 Device가 일치하면 검색어를 좁히라고 말해야 한다. */
	it("says so when more devices match than one page can list", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json({ content: [], page: 0, size: 100, totalElements: 240, totalPages: 3 }),
			),
		);
		renderAt("/security-events");

		expect(await screen.findByText(/일치하는 Device가 100개를 넘습니다\(240개\)/)).toBeInTheDocument();
	});

	/**
	 * 첫 100개만 select에 담으면 101번째 이후 Device의 이벤트는 필터로 볼 수 없다
	 * (Codex 리뷰 PR #46 Medium). 선택지를 화면에서 걸러내지 않고 검색어를 서버로
	 * 보내야 한다.
	 */
	it("finds a device outside the first page by searching the server and filters by it", async () => {
		const seen = captureListRequests();
		const farDevice = {
			...devicePage.content[0],
			id: "aaaaaaaa-0000-4000-8000-0000000000aa",
			deviceKey: "sensor-far-101",
			name: "101번째 센서",
		};
		mockServer.use(
			http.get("/api/v1/devices", ({ request }) => {
				const query = new URL(request.url).searchParams.get("query");
				if (query === "far") {
					return HttpResponse.json({
						content: [farDevice],
						page: 0,
						size: 100,
						totalElements: 1,
						totalPages: 1,
					});
				}
				// 검색어가 없으면 첫 페이지만 오고, 전체는 그보다 훨씬 많다.
				return HttpResponse.json({ ...devicePage, totalElements: 240, totalPages: 3 });
			}),
		);

		renderAt("/security-events");
		await screen.findByText("허용");

		await userEvent.type(screen.getByLabelText("디바이스"), "far");
		await userEvent.click(
			await screen.findByRole("option", { name: /101번째 센서/ }, { timeout: 3000 }),
		);

		await expect
			.poll(() => seen.some((search) => search.includes(`deviceId=${farDevice.id}`)))
			.toBe(true);
	});

	/**
	 * 목록의 이름 표시와 필터가 같은 `GET /devices?page=0&size=100`을 쓴다. Query Key가
	 * 다르면 같은 요청이 두 번 나간다(Codex 리뷰 PR #46 Low).
	 */
	it("asks for the device list only once on first entry", async () => {
		let calls = 0;
		mockServer.use(
			http.get("/api/v1/devices", () => {
				calls += 1;
				return HttpResponse.json(devicePage);
			}),
		);
		renderAt("/security-events");
		await screen.findByRole("link", { name: "1층 온도 센서" });

		expect(calls).toBe(1);
	});

	/** 셀 안의 Device 링크는 이동만 해야 한다 — 행 클릭의 Drawer까지 같이 열리면 안 된다. */
	it("navigates to the device detail without opening the event drawer", async () => {
		renderAt("/security-events");

		await userEvent.click(await screen.findByRole("link", { name: "1층 온도 센서" }));

		expect(await screen.findByRole("heading", { name: "Device 상세" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "보안 이벤트 상세" })).not.toBeInTheDocument();
	});

	/** SYSTEM Event의 상세는 대부분이 null이다. 빈 칸이 아니라 없음으로 보여야 한다. */
	it("shows the nullable detail fields of a SYSTEM event as 없음", async () => {
		renderAt("/security-events");
		await userEvent.click(await screen.findByText("EVENT_OUTBOX_BACKLOG"));

		const drawer = (await screen.findByRole("heading", { name: "보안 이벤트 상세" })).closest("div");
		expect(drawer?.textContent).toContain("시스템");
		// 디바이스·인증서 Serial·HTTP·접속 IP·응답 시간 다섯 자리가 모두 없음이다.
		expect(drawer?.textContent?.match(/—/g)?.length).toBeGreaterThanOrEqual(5);
	});
	/*
	 * Dashboard 패널과 CRITICAL Toast가 "원인이 된 그 Event"를 여는 경로다
	 * (ui-design.md §3·§8). 목록에 없는 page를 보고 있어도 열려야 하므로 Drawer는
	 * 목록이 아니라 GET /security-events/{id}로 채운다.
	 */
	it("opens the drawer for the event named in the URL", async () => {
		const linked = securityEventPage.content[1];
		renderAt(`/security-events?eventId=${linked.id}`);

		expect(await screen.findByRole("heading", { name: "보안 이벤트 상세" })).toBeInTheDocument();
		expect(await screen.findByText(linked.traceId)).toBeInTheDocument();
	});

	it("shows the server error inside the drawer when the linked event does not exist", async () => {
		renderAt("/security-events?eventId=00000000-0000-4000-8000-000000000000");

		expect(await screen.findByRole("heading", { name: "보안 이벤트 상세" })).toBeInTheDocument();
		expect(await screen.findByText("보안 이벤트를 찾을 수 없습니다.")).toBeInTheDocument();
	});

	it("drops the eventId from the URL when the linked drawer is closed", async () => {
		const linked = securityEventPage.content[1];
		renderAt(`/security-events?eventId=${linked.id}`);
		await screen.findByRole("heading", { name: "보안 이벤트 상세" });

		// DetailDrawer에는 닫기 버튼이 없다 — backdrop 클릭이나 Escape로 닫는다.
		await userEvent.keyboard("{Escape}");

		// 닫은 뒤에는 목록이 다시 접근성 트리에 들어온다 — Drawer가 정말 닫혔다는 뜻이다.
		expect(await screen.findByRole("heading", { name: "Security Events" })).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "보안 이벤트 상세" })).not.toBeInTheDocument();
	});
});
