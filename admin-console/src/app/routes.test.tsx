import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { FakeEventSource } from "../mocks/fakeEventSource";
import { routes } from "./routes";

// 화면이 실제 API에 연결되기 시작하면서 페이지가 useQuery를 쓴다. Provider 없이
// 렌더하면 라우팅이 아니라 Provider 부재로 실패하므로 여기서 감싼다.
function renderRoutes(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

const PAGES: Array<{ path: string; heading: string }> = [
	{ path: "/", heading: "Dashboard" },
	{ path: "/devices", heading: "Devices" },
	{ path: "/certificate-requests", heading: "Certificate Requests" },
	{ path: "/certificates", heading: "Certificates" },
	{ path: "/security-events", heading: "Security Events" },
];

describe("routes", () => {
	it.each(PAGES)("renders the $heading page for $path", async ({ path, heading }) => {
		renderRoutes(path);

		expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
	});

	it("renders the navigation link for every Foundation page", () => {
		renderRoutes("/");

		for (const { heading } of PAGES) {
			expect(screen.getByRole("link", { name: heading })).toBeInTheDocument();
		}
	});

	/*
	 * CRITICAL Toast는 특정 화면이 아니라 Layout에 붙는다. Provider 단위 테스트는 그것을
	 * 직접 렌더하므로 AppLayout에서 Provider가 통째로 빠지는 회귀를 잡지 못한다 —
	 * 실제 route tree에서 연결이 열리는지 여기서 확인한다(Codex 리뷰 PR #49 Medium).
	 */
	it("opens the critical event stream from the layout, on every page", async () => {
		renderRoutes("/devices");

		await waitFor(() => expect(FakeEventSource.instances).not.toHaveLength(0));
		expect(FakeEventSource.last().url).toBe("/api/v1/security-events/stream");
	});

	it("shows a critical toast over whichever page is open", async () => {
		renderRoutes("/certificates");
		await waitFor(() => expect(FakeEventSource.instances).not.toHaveLength(0));

		act(() =>
			FakeEventSource.last().emit("critical-security-event", {
				// fixture에 없는 새 Event다. fixture의 id를 쓰면 마운트 시 커서 조회가 이미 본 것으로
				// 표시해 두므로 Toast가 뜨지 않는다.
				eventId: "9f9f9f9f-0000-4000-8000-0000000000ff",
				occurredAt: "2026-08-19T05:50:00Z",
				deviceKey: "sensor-floor-03",
				reasonCode: "CERTIFICATE_REVOKED",
				message: "폐기된 인증서의 접근이 차단되었습니다.",
			}),
		);

		expect(await screen.findByText("폐기된 인증서의 접근이 차단되었습니다.")).toBeInTheDocument();
	});
});
