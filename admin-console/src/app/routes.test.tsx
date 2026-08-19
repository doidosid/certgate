import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
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
});
