import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";
import { certificateRequestDetail, certificateRequestPage } from "../mocks/fixtures";

function renderAt(path: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}


/**
 * 목록에서 한 건을 열고 상세 Drawer 요소를 돌려준다.
 *
 * Drawer 범위로 한정해서 단언해야 한다 — 목록 행과 필터에도 같은 문구가 있어서 화면
 * 전체를 대상으로 찾으면 엉뚱한 것을 잡는다.
 */
async function openFirstRequest(): Promise<HTMLElement> {
	await userEvent.click(await screen.findByText("승인 대기"));
	const heading = await screen.findByRole("heading", { name: "인증서 요청 상세" });
	const drawer = heading.parentElement;
	if (drawer === null) {
		throw new Error("Drawer 본문을 찾지 못했다");
	}
	return drawer;
}

/**
 * 확인 Dialog가 완전히 사라질 때까지 기다린다.
 *
 * MUI Dialog는 닫히는 transition 동안에도 DOM에 남아 있고, modal이 열려 있는 동안
 * MUI가 나머지 화면에 `aria-hidden`을 건다. 그 상태에서 `*ByRole`은 Drawer의 버튼을
 * 아예 보지 못하므로, 기다리지 않으면 "버튼이 없다"는 단언이 무조건 통과한다.
 */
async function closedDialog() {
	await waitFor(() => {
		expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
	});
}

describe("CertificateRequestsPage", () => {
	it("shows the request status in Korean", async () => {
		renderAt("/certificate-requests");

		expect(await screen.findByText("승인 대기")).toBeInTheDocument();
	});

	/** ui-design.md §5 상세: CSR Subject, SAN, 공개키 정보, CSR 지문. */
	it("shows the subject, SAN URI, key algorithm and fingerprint", async () => {
		renderAt("/certificate-requests");
		const drawer = await openFirstRequest();

		expect(within(drawer).getByText(certificateRequestDetail.subjectDn)).toBeInTheDocument();
		expect(within(drawer).getByText("urn:certgate:device:sensor-floor-01")).toBeInTheDocument();
		expect(within(drawer).getByText("EC P-256")).toBeInTheDocument();
		expect(within(drawer).getByText(certificateRequestDetail.fingerprintSha256)).toBeInTheDocument();
	});

	/** ui-design.md §5 목록: SAN URI, 키 알고리즘도 이제 목록 컬럼으로 나온다. */
	it("shows SAN URI and key algorithm columns in the list", async () => {
		renderAt("/certificate-requests");

		expect(await screen.findByText("urn:certgate:device:sensor-floor-01")).toBeInTheDocument();
		expect(screen.getByText("SAN URI")).toBeInTheDocument();
		expect(screen.getByText("키 알고리즘")).toBeInTheDocument();
	});

	/**
	 * security-design.md·ui-design.md §5: CSR 원문과 개인키는 화면에 남기지 않는다.
	 * 서버 응답에 csrPem이 없으므로 화면에도 없어야 한다.
	 */
	it("never renders raw CSR or private key material", async () => {
		const { container } = renderAt("/certificate-requests");
		await openFirstRequest();

		expect(container.textContent).not.toContain("BEGIN CERTIFICATE REQUEST");
		expect(container.textContent).not.toContain("PRIVATE KEY");
	});

	it("approves a pending request and reports what happened", async () => {
		const bodies: unknown[] = [];
		mockServer.use(
			http.post("/api/v1/certificate-requests/:requestId/approve", async ({ request }) => {
				bodies.push(await request.json().catch(() => undefined));
				return HttpResponse.json({ ...certificateRequestPage.content[0], status: "APPROVED" });
			}),
		);
		renderAt("/certificate-requests");
		await openFirstRequest();

		await userEvent.click(screen.getByRole("button", { name: "승인" }));
		await userEvent.click(await screen.findByRole("button", { name: "승인하기" }));

		expect(await screen.findByText("인증서 요청을 승인했습니다.")).toBeInTheDocument();
		// 메모를 비웠으면 본문을 아예 보내지 않는다 — 서버가 본문 생략을 허용한다.
		expect(bodies).toEqual([undefined]);
	});

	/**
	 * 상세 refetch가 늦거나 낡은 값을 줘도 성공한 요청을 다시 결정할 수 없어야 한다.
	 * 이 mock은 계속 PENDING을 돌려주므로 status만 보는 구현에서는 버튼이 되살아난다
	 * (Codex 리뷰 PR #46 Task 9 Medium).
	 */
	it("locks the decision buttons after the server confirms, even while the detail still reads PENDING", async () => {
		let approvals = 0;
		mockServer.use(
			// 상세는 끝까지 PENDING을 돌려준다 — 낡은 replica나 느린 refetch를 흉내낸다.
			http.get("/api/v1/certificate-requests/:requestId", () => HttpResponse.json(certificateRequestDetail)),
			http.post("/api/v1/certificate-requests/:requestId/approve", () => {
				approvals += 1;
				return HttpResponse.json({ ...certificateRequestPage.content[0], status: "APPROVED" });
			}),
		);
		renderAt("/certificate-requests");
		const drawer = await openFirstRequest();

		await userEvent.click(within(drawer).getByRole("button", { name: "승인" }));
		await userEvent.click(await screen.findByRole("button", { name: "승인하기" }));
		await screen.findByText("인증서 요청을 승인했습니다.");
		await closedDialog();

		expect(within(drawer).queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
		expect(within(drawer).queryByRole("button", { name: "거절" })).not.toBeInTheDocument();
		expect(approvals).toBe(1);
		// 상태 칩도 서버가 확정한 값으로 바뀐다 — 성공 문구와 "승인 대기"가 함께 보이면 안 된다.
		expect(within(drawer).getByText("발급 완료")).toBeInTheDocument();
		expect(within(drawer).queryByText("승인 대기")).not.toBeInTheDocument();
	});

	it("shows the confirmed status after a rejection", async () => {
		mockServer.use(
			http.get("/api/v1/certificate-requests/:requestId", () => HttpResponse.json(certificateRequestDetail)),
			http.post("/api/v1/certificate-requests/:requestId/reject", () =>
				HttpResponse.json({ ...certificateRequestPage.content[0], status: "REJECTED" }),
			),
		);
		renderAt("/certificate-requests");
		const drawer = await openFirstRequest();

		await userEvent.click(within(drawer).getByRole("button", { name: "거절" }));
		await userEvent.type(screen.getByLabelText("거절 사유 (필수)"), "SAN URI 불일치");
		await userEvent.click(await screen.findByRole("button", { name: "거절하기" }));
		await screen.findByText("인증서 요청을 거절했습니다.");
		await closedDialog();

		expect(within(drawer).getByText("거절")).toBeInTheDocument();
		expect(within(drawer).queryByText("승인 대기")).not.toBeInTheDocument();
	});

	/** ui-design.md §5 "사유를 포함한 거절" — 사유 없이 거절할 수 없다. */
	it("requires a reason before rejecting", async () => {
		const notes: unknown[] = [];
		mockServer.use(
			http.post("/api/v1/certificate-requests/:requestId/reject", async ({ request }) => {
				notes.push(await request.json());
				return HttpResponse.json({ ...certificateRequestPage.content[0], status: "REJECTED" });
			}),
		);
		renderAt("/certificate-requests");
		await openFirstRequest();

		await userEvent.click(screen.getByRole("button", { name: "거절" }));
		const confirm = await screen.findByRole("button", { name: "거절하기" });
		expect(confirm).toBeDisabled();

		await userEvent.type(screen.getByLabelText("거절 사유 (필수)"), "SAN URI가 Device Key와 다릅니다");
		expect(confirm).toBeEnabled();
		await userEvent.click(confirm);

		expect(await screen.findByText("인증서 요청을 거절했습니다.")).toBeInTheDocument();
		expect(notes).toEqual([{ decisionNote: "SAN URI가 Device Key와 다릅니다" }]);
	});

	/**
	 * 다른 관리자가 먼저 처리하면 서버가 409 CERTIFICATE_REQUEST_NOT_PENDING을 준다
	 * (api-spec.md §10). 그때 화면에 남은 "승인 대기"는 이미 낡은 값이다.
	 */
	it("surfaces the 409 message and refetches when the request is no longer pending", async () => {
		let listCalls = 0;
		mockServer.use(
			http.get("/api/v1/certificate-requests", () => {
				listCalls += 1;
				return HttpResponse.json(certificateRequestPage);
			}),
			http.post("/api/v1/certificate-requests/:requestId/approve", () =>
				HttpResponse.json(
					{
						code: "CERTIFICATE_REQUEST_NOT_PENDING",
						message: "이미 처리된 요청입니다.",
						traceId: "trace-3",
						fieldErrors: [],
					},
					{ status: 409 },
				),
			),
		);
		renderAt("/certificate-requests");
		await openFirstRequest();
		const callsBeforeDecision = listCalls;

		await userEvent.click(screen.getByRole("button", { name: "승인" }));
		await userEvent.click(await screen.findByRole("button", { name: "승인하기" }));

		expect(await screen.findByText("이미 처리된 요청입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-3/)).toBeInTheDocument();
		// 실패해도 목록을 다시 읽는다. 그러지 않으면 같은 버튼을 다시 누르게 된다.
		await expect.poll(() => listCalls > callsBeforeDecision).toBe(true);
	});

	/**
	 * 409 뒤 상세가 실제 상태로 수렴하면 결정 버튼은 사라지고, 오류 메시지와 trace ID는
	 * 남아야 한다 — 무엇이 일어났는지 설명하는 정보를 재조회가 지워버리면 안 된다.
	 */
	it("drops the decision buttons but keeps the 409 message once the detail converges", async () => {
		let detailCalls = 0;
		mockServer.use(
			http.get("/api/v1/certificate-requests/:requestId", () => {
				detailCalls += 1;
				// 첫 조회는 PENDING, 그 뒤에는 다른 관리자가 이미 승인한 실제 상태다.
				return HttpResponse.json(
					detailCalls === 1
						? certificateRequestDetail
						: { ...certificateRequestDetail, status: "APPROVED", decidedAt: "2026-08-13T06:00:00Z" },
				);
			}),
			http.post("/api/v1/certificate-requests/:requestId/approve", () =>
				HttpResponse.json(
					{
						code: "CERTIFICATE_REQUEST_NOT_PENDING",
						message: "이미 처리된 요청입니다.",
						traceId: "trace-5",
						fieldErrors: [],
					},
					{ status: 409 },
				),
			),
		);
		renderAt("/certificate-requests");
		await openFirstRequest();

		await userEvent.click(screen.getByRole("button", { name: "승인" }));
		await userEvent.click(await screen.findByRole("button", { name: "승인하기" }));

		expect(await screen.findByText("이미 처리된 요청입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-5/)).toBeInTheDocument();
		await expect.poll(() => screen.queryByRole("button", { name: "승인" })).toBe(null);
	});

	/** 이미 결정된 요청에는 결정 버튼을 두지 않는다(구현되지 않은 동작을 남기지 않는다). */
	it("offers no decision buttons for a request that is already decided", async () => {
		mockServer.use(
			http.get("/api/v1/certificate-requests", () =>
				HttpResponse.json({
					...certificateRequestPage,
					content: [{ ...certificateRequestPage.content[0], status: "APPROVED" }],
				}),
			),
			http.get("/api/v1/certificate-requests/:requestId", () =>
				HttpResponse.json({
					...certificateRequestDetail,
					status: "APPROVED",
					decidedAt: "2026-08-13T06:00:00Z",
					decisionNote: "확인 후 승인",
				}),
			),
		);
		renderAt("/certificate-requests");
		await userEvent.click(await screen.findByText("발급 완료"));
		await screen.findByRole("heading", { name: "인증서 요청 상세" });

		expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "거절" })).not.toBeInTheDocument();
		expect(screen.getByText("확인 후 승인")).toBeInTheDocument();
	});

	it("sends the status filter to the server", async () => {
		const seen: string[] = [];
		mockServer.use(
			http.get("/api/v1/certificate-requests", ({ request }) => {
				seen.push(new URL(request.url).search);
				return HttpResponse.json(certificateRequestPage);
			}),
		);
		renderAt("/certificate-requests");
		await screen.findByText("승인 대기");

		await userEvent.click(screen.getByLabelText("상태"));
		await userEvent.click(await screen.findByRole("option", { name: "거절" }));

		await expect.poll(() => seen.some((search) => search.includes("status=REJECTED"))).toBe(true);
	});

	it("shows the empty state when nothing matches", async () => {
		mockServer.use(
			http.get("/api/v1/certificate-requests", () =>
				HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
			),
		);
		renderAt("/certificate-requests");

		expect(await screen.findByText("조건에 맞는 인증서 요청이 없습니다.")).toBeInTheDocument();
	});

	it("shows the server error message and traceId when the list fails", async () => {
		mockServer.use(
			http.get("/api/v1/certificate-requests", () =>
				HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "일시적인 오류입니다.", traceId: "trace-8", fieldErrors: [] },
					{ status: 500 },
				),
			),
		);
		renderAt("/certificate-requests");

		expect(await screen.findByText("일시적인 오류입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-8/)).toBeInTheDocument();
	});

	/** 상세 조회만 실패하는 경우 — 목록은 그대로 두고 Drawer 안에서 알린다. */
	it("keeps the list when only the detail lookup fails", async () => {
		mockServer.use(
			http.get("/api/v1/certificate-requests/:requestId", () =>
				HttpResponse.json(
					{ code: "CERTIFICATE_REQUEST_NOT_FOUND", message: "요청을 찾을 수 없습니다.", traceId: "t", fieldErrors: [] },
					{ status: 404 },
				),
			),
		);
		renderAt("/certificate-requests");
		await openFirstRequest();

		expect(await screen.findByText("요청을 찾을 수 없습니다.")).toBeInTheDocument();
		expect(screen.getByText("승인 대기")).toBeInTheDocument();
	});

	it("links the request's device to its detail page", async () => {
		renderAt("/certificate-requests");

		// fixture의 여러 CSR 중 둘이 같은 Device를 가리킨다 — 재발급 등으로 실제로도
		// 있을 수 있는 모양이다. 그중 첫 번째 링크가 그 Device로 정확히 가는지만 본다.
		const links = await screen.findAllByRole("link", { name: "1층 온도 센서" });
		expect(links[0]).toHaveAttribute("href", `/devices/${certificateRequestPage.content[0].deviceId}`);
	});
});
