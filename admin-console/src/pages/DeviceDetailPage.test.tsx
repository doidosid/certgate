import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";
import { deviceSummary, enrollmentTokenIssued } from "../mocks/fixtures";

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

	/** ui-design.md §4 관리 기능. 물리 삭제는 제공하지 않는다. */
	describe("관리 동작", () => {
		it("offers no delete action", async () => {
			renderAt(`/devices/${DEVICE_ID}`);
			await screen.findByRole("button", { name: "Role 변경" });

			expect(screen.queryByRole("button", { name: /삭제/ })).not.toBeInTheDocument();
		});

		it("disables the device after confirmation and says the change takes up to 30 seconds", async () => {
			const bodies: unknown[] = [];
			mockServer.use(
				http.patch("/api/v1/devices/:deviceId/status", async ({ request }) => {
					bodies.push(await request.json());
					return HttpResponse.json({ ...deviceSummary, status: "DISABLED" });
				}),
			);
			renderAt(`/devices/${DEVICE_ID}`);

			// 활성 Device이므로 버튼은 "비활성화"다.
			await userEvent.click(await screen.findByRole("button", { name: "비활성화" }));
			expect(await screen.findByText(/반영에 최대 30초가 걸리며/)).toBeInTheDocument();
			await userEvent.click(screen.getByRole("button", { name: "비활성화", hidden: false }));

			await waitFor(() => expect(bodies).toEqual([{ status: "DISABLED" }]));
		});

		/** 같은 Role로 바꾸는 것은 동작이 아니다. 서버에 보내지 않는다. */
		it("keeps the role confirmation disabled until a different role is chosen", async () => {
			renderAt(`/devices/${DEVICE_ID}`);

			await userEvent.click(await screen.findByRole("button", { name: "Role 변경" }));
			const confirm = await screen.findByRole("button", { name: "변경" });

			expect(confirm).toBeDisabled();
			await userEvent.click(screen.getByLabelText("Role"));
			await userEvent.click(await screen.findByRole("option", { name: "OPERATOR" }));
			expect(confirm).toBeEnabled();
		});

		/**
		 * 재발급하면 서버가 기존 활성 Token을 폐기한다(security-design.md §2). 진행 중인
		 * 등록이 실패하므로 누르기 전에 그 사실을 알려야 한다.
		 */
		it("warns that reissuing revokes the existing token, then shows the new one once", async () => {
			renderAt(`/devices/${DEVICE_ID}`);

			await userEvent.click(await screen.findByRole("button", { name: "Token 재발급" }));
			expect(await screen.findByText(/기존 활성 Token은 폐기됩니다/)).toBeInTheDocument();

			await userEvent.click(screen.getByRole("button", { name: "재발급" }));

			expect(await screen.findByText(enrollmentTokenIssued.enrollmentToken)).toBeInTheDocument();
			expect(screen.getByText("이 값은 지금만 확인할 수 있습니다")).toBeInTheDocument();
			// 결과 창에는 다시 발급하는 버튼이 없다.
			expect(screen.queryByRole("button", { name: "재발급" })).not.toBeInTheDocument();
		});

		it("surfaces a failed reissue instead of pretending a token was issued", async () => {
			mockServer.use(
				http.post("/api/v1/devices/:deviceId/enrollment-token", () =>
					HttpResponse.json(
						{
							code: "ENROLLMENT_TOKEN_CONFLICT",
							message: "동시에 재발급이 처리되었습니다.",
							traceId: "trace-12",
							fieldErrors: [],
						},
						{ status: 409 },
					),
				),
			);
			renderAt(`/devices/${DEVICE_ID}`);

			await userEvent.click(await screen.findByRole("button", { name: "Token 재발급" }));
			await userEvent.click(screen.getByRole("button", { name: "재발급" }));

			expect(await screen.findByText("동시에 재발급이 처리되었습니다.")).toBeInTheDocument();
			expect(screen.queryByText("이 값은 지금만 확인할 수 있습니다")).not.toBeInTheDocument();
		});
	});
});
