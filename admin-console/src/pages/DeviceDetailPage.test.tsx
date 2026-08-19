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

const DEVICE_ID = "0d6515ae-d560-4777-b102-054e71f98ef9";

describe("DeviceDetailPage", () => {
	it("shows basic info, certificate, policy rules and recent events", async () => {
		renderAt(`/devices/${DEVICE_ID}`);

		expect(await screen.findByText("1층 온도 센서")).toBeInTheDocument();
		expect(screen.getByText("7F28A109")).toBeInTheDocument();
		// /telemetry는 적용 정책과 최근 이벤트 양쪽에 나온다 — 두 카드가 모두 채워졌다는 뜻이다.
		expect(screen.getAllByText(/\/telemetry/)).toHaveLength(2);
		expect(screen.getByText(/REQUEST_ALLOWED/)).toBeInTheDocument();
		expect(screen.getByText("sensor-floor-01")).toBeInTheDocument();
	});

	/** security-design.md: Certificate 전체 원문·Private Key는 화면에도 남기지 않는다. */
	it("never renders private key or certificate PEM material", async () => {
		const { container } = renderAt(`/devices/${DEVICE_ID}`);
		await screen.findByText("1층 온도 센서");

		expect(container.textContent).not.toContain("BEGIN CERTIFICATE");
		expect(container.textContent).not.toContain("PRIVATE KEY");
	});

	it("shows the server error message and traceId when the device cannot be loaded", async () => {
		mockServer.use(
			http.get("/api/v1/devices/:deviceId", () =>
				HttpResponse.json(
					{ code: "DEVICE_NOT_REGISTERED", message: "등록되지 않은 Device입니다.", traceId: "trace-4", fieldErrors: [] },
					{ status: 404 },
				),
			),
		);
		renderAt(`/devices/${DEVICE_ID}`);

		expect(await screen.findByText("등록되지 않은 Device입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-4/)).toBeInTheDocument();
	});

	/** 허용 규칙이 없으면 기본 DENY라 모든 요청이 막힌다 — 화면이 그 사실을 말해야 한다. */
	it("says every request is blocked when the device has no allow rule", async () => {
		mockServer.use(
			http.get("/api/v1/devices/:deviceId", () =>
				HttpResponse.json({
					id: DEVICE_ID,
					deviceKey: "sensor-no-rule",
					name: "규칙 없는 센서",
					status: "ACTIVE",
					roleName: "SENSOR",
					createdAt: "2026-08-13T05:32:18Z",
					lastSeenAt: null,
					certificate: null,
					policyRules: [],
					recentEvents: [],
				}),
			),
		);
		renderAt(`/devices/${DEVICE_ID}`);

		expect(await screen.findByText("허용 규칙이 없어 모든 요청이 차단됩니다.")).toBeInTheDocument();
		expect(screen.getByText("발급된 인증서가 없습니다.")).toBeInTheDocument();
	});

	/**
	 * 목록의 링크가 실제로 이 화면에 닿아야 한다. href 문자열만 검사하면 route가
	 * 등록되지 않아 빈 화면이 되는 회귀를 놓친다(Codex 리뷰 PR #44 Medium).
	 */
	it("is reachable by clicking a device name in the list", async () => {
		renderAt("/devices");

		await userEvent.click(await screen.findByRole("link", { name: "1층 온도 센서" }));

		expect(await screen.findByRole("heading", { name: "Device 상세" })).toBeInTheDocument();
		expect(screen.getByText("7F28A109")).toBeInTheDocument();
	});
});
