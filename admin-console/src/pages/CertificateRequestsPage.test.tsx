import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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


/** 목록에서 한 건을 열어 상세 Drawer가 뜰 때까지 기다린다. */
async function openFirstRequest() {
	await userEvent.click(await screen.findByText("승인 대기"));
	await screen.findByRole("heading", { name: "인증서 요청 상세" });
}

describe("CertificateRequestsPage", () => {
	it("shows the request status in Korean", async () => {
		renderAt("/certificate-requests");

		expect(await screen.findByText("승인 대기")).toBeInTheDocument();
	});

	/** ui-design.md §5 상세: CSR Subject, SAN, 공개키 정보, CSR 지문. */
	it("shows the subject, SAN URI, key algorithm and fingerprint", async () => {
		renderAt("/certificate-requests");
		await openFirstRequest();

		expect(screen.getByText(certificateRequestDetail.subjectDn)).toBeInTheDocument();
		expect(screen.getByText("urn:certgate:device:sensor-floor-01")).toBeInTheDocument();
		expect(screen.getByText("EC P-256")).toBeInTheDocument();
		expect(screen.getByText(certificateRequestDetail.fingerprintSha256)).toBeInTheDocument();
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

		const link = await screen.findByRole("link", { name: "1층 온도 센서" });
		expect(link).toHaveAttribute("href", `/devices/${certificateRequestPage.content[0].deviceId}`);
	});
});
