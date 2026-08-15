import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "./routes";

const PAGES: Array<{ path: string; heading: string }> = [
	{ path: "/", heading: "Dashboard" },
	{ path: "/devices", heading: "Devices" },
	{ path: "/certificate-requests", heading: "Certificate Requests" },
	{ path: "/certificates", heading: "Certificates" },
	{ path: "/security-events", heading: "Security Events" },
];

describe("routes", () => {
	it.each(PAGES)("renders the $heading page for $path", async ({ path, heading }) => {
		const router = createMemoryRouter(routes, { initialEntries: [path] });
		render(<RouterProvider router={router} />);

		expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
	});

	it("renders the navigation link for every Foundation page", () => {
		const router = createMemoryRouter(routes, { initialEntries: ["/"] });
		render(<RouterProvider router={router} />);

		for (const { heading } of PAGES) {
			expect(screen.getByRole("link", { name: heading })).toBeInTheDocument();
		}
	});
});
