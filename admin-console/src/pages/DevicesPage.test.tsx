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
});
