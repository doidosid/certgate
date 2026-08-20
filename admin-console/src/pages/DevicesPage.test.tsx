import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

describe("DevicesPage", () => {
	it("renders each device row with Korean status labels", async () => {
		renderAt("/devices");

		expect(await screen.findByText("sensor-floor-01")).toBeInTheDocument();
		expect(screen.getByText("1층 온도 센서")).toBeInTheDocument();
		expect(screen.getByText("활성")).toBeInTheDocument();
		expect(screen.getByText("비활성")).toBeInTheDocument();
	});

	it("shows 발급 없음 for a device without a certificate", async () => {
		renderAt("/devices");
		expect(await screen.findByText("발급 없음")).toBeInTheDocument();
	});

	it("shows the empty state when the server returns no devices", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
			),
		);
		renderAt("/devices");
		expect(await screen.findByText("조건에 맞는 디바이스가 없습니다.")).toBeInTheDocument();
	});

	/**
	 * 공유 URL의 ?page=1처럼 범위를 벗어난 페이지에서는 content가 비어도 결과 자체는
	 * 있다. 이때 표를 빈 문구로 통째로 바꾸면 페이지 이동 컨트롤까지 사라져 첫
	 * 페이지로 돌아올 방법이 없어진다(Codex 리뷰 PR #44 Medium).
	 */
	it("keeps pagination on an out-of-range page so the user can go back", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json({ content: [], page: 1, size: 20, totalElements: 2, totalPages: 1 }),
			),
		);
		renderAt("/devices?page=1");

		expect(await screen.findByRole("button", { name: /이전 페이지|Go to previous page/i })).toBeInTheDocument();
		expect(screen.queryByText("조건에 맞는 디바이스가 없습니다.")).not.toBeInTheDocument();
	});

	it("shows the server error message and traceId when the list fails", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "일시적인 오류입니다.", traceId: "trace-7", fieldErrors: [] },
					{ status: 500 },
				),
			),
		);
		renderAt("/devices");
		expect(await screen.findByText("일시적인 오류입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-7/)).toBeInTheDocument();
	});

	/** 목록에서 상세로 가는 경로는 실제 링크여야 새 탭 열기·가운데 클릭이 동작한다. */
	/** Role 목록만 실패해도 Device 목록은 정상이다. 필터가 왜 안 되는지 알려줘야 한다. */
	it("surfaces a Role lookup failure instead of silently dropping the filter", async () => {
		mockServer.use(
			http.get("/api/v1/roles", () =>
				HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "실패", traceId: "t", fieldErrors: [] },
					{ status: 500 },
				),
			),
		);
		renderAt("/devices");

		expect(await screen.findByText("Role 목록을 불러오지 못했습니다.")).toBeInTheDocument();
		// 목록 자체는 계속 보여야 한다.
		expect(screen.getByText("sensor-floor-01")).toBeInTheDocument();
	});

	/** URL에 있던 roleName이 목록 로딩 전에도 select에 남아 있어야 화면과 요청이 어긋나지 않는다. */
	it("keeps the roleName from the URL selectable before roles load", async () => {
		renderAt("/devices?roleName=SENSOR");

		expect(await screen.findByDisplayValue("SENSOR")).toBeInTheDocument();
	});

	it("links each row to its detail page", async () => {
		renderAt("/devices");

		const link = await screen.findByRole("link", { name: "1층 온도 센서" });
		expect(link).toHaveAttribute("href", "/devices/0d6515ae-d560-4777-b102-054e71f98ef9");
	});

	/**
	 * 필터를 고르면 그 조건으로 서버에 다시 물어야 한다. 화면에만 반영하고 요청이
	 * 그대로면 목록이 필터와 무관한 결과를 계속 보여준다.
	 */
	it("refetches with the chosen filter when the user changes it", async () => {
		const seen: string[] = [];
		mockServer.use(
			http.get("/api/v1/devices", ({ request }) => {
				seen.push(new URL(request.url).search);
				return HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
			}),
		);

		renderAt("/devices");
		await screen.findByText("조건에 맞는 디바이스가 없습니다.");
		expect(seen[0]).not.toContain("status=");

		await userEvent.click(screen.getByLabelText("상태"));
		await userEvent.click(await screen.findByRole("option", { name: "활성" }));

		await expect.poll(() => seen.some((search) => search.includes("status=ACTIVE"))).toBe(true);
	});

	it("sends the filters to the server as query params", async () => {
		const seen: string[] = [];
		mockServer.use(
			http.get("/api/v1/devices", ({ request }) => {
				seen.push(new URL(request.url).search);
				return HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
			}),
		);

		renderAt("/devices?status=ACTIVE&roleName=SENSOR&page=1&size=50");
		await screen.findByText("조건에 맞는 디바이스가 없습니다.");

		expect(seen[0]).toContain("status=ACTIVE");
		expect(seen[0]).toContain("roleName=SENSOR");
		expect(seen[0]).toContain("page=1");
		expect(seen[0]).toContain("size=50");
	});

	/**
	 * 검색어를 keystroke마다 URL에 반영하면 글자 수만큼 요청이 나간다
	 * (Codex 리뷰 PR #44 Low). 입력이 멈춘 뒤 한 번만 보내야 한다.
	 */
	it("sends one search request after typing stops, not one per keystroke", async () => {
		const seen: string[] = [];
		mockServer.use(
			http.get("/api/v1/devices", ({ request }) => {
				seen.push(new URL(request.url).search);
				return HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
			}),
		);

		renderAt("/devices");
		await screen.findByText("조건에 맞는 디바이스가 없습니다.");

		await userEvent.type(screen.getByLabelText("이름 또는 Device Key"), "sen");

		// 입력값은 즉시 보이고, 중간 글자로는 요청이 나가지 않는다.
		expect(screen.getByLabelText("이름 또는 Device Key")).toHaveValue("sen");
		await expect.poll(() => seen.some((search) => search.includes("query=sen"))).toBe(true);
		expect(seen.some((search) => /query=s(&|$)/.test(search))).toBe(false);
		expect(seen.some((search) => /query=se(&|$)/.test(search))).toBe(false);
	});

	/** 실패를 알리는 것만으로는 부족하다 — 새로고침 없이 되돌릴 수 있어야 한다. */
	it("lets the user retry a failed Role lookup in place", async () => {
		let attempts = 0;
		mockServer.use(
			http.get("/api/v1/roles", () => {
				attempts += 1;
				return HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "실패", traceId: "t", fieldErrors: [] },
					{ status: 500 },
				);
			}),
		);
		renderAt("/devices");
		await screen.findByText("Role 목록을 불러오지 못했습니다.");

		const before = attempts;
		await userEvent.click(screen.getByRole("button", { name: "Role 목록 다시 불러오기" }));

		await expect.poll(() => attempts > before).toBe(true);
	});
});
