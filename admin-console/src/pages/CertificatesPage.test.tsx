import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";
import { certificatePage, certificatePem } from "../mocks/fixtures";

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

const CERTIFICATE = certificatePage.content[0];

/** 목록에서 한 건을 열고 상세 Drawer 요소를 돌려준다. */
async function openFirstCertificate(): Promise<HTMLElement> {
	await userEvent.click(await screen.findByText(CERTIFICATE.serialNumber));
	const heading = await screen.findByRole("heading", { name: "인증서 상세" });
	const drawer = heading.parentElement;
	if (drawer === null) {
		throw new Error("Drawer 본문을 찾지 못했다");
	}
	return drawer;
}

/**
 * 확인 Dialog가 완전히 사라질 때까지 기다린다. MUI Dialog는 닫히는 transition 동안에도
 * DOM에 남아 있고, modal이 열려 있으면 나머지 화면에 `aria-hidden`이 걸려 `*ByRole`이
 * Drawer 버튼을 보지 못한다 — 기다리지 않으면 "버튼이 없다"가 무조건 통과한다.
 */
async function closedDialog() {
	await waitFor(() => {
		expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
	});
}

/** jsdom에는 createObjectURL이 없다. 저장 동작을 관찰할 수 있게 대신 심는다. */
let saved: Array<{ download: string; type: string; text: string }>;

type ObjectUrlApi = { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void };

let restoreObjectUrl: () => void;

beforeEach(() => {
	saved = [];
	const blobs = new Map<string, Blob>();

	/*
	 * URL 전체를 갈아치우면 안 된다 — 생성자가 사라져 MSW의 `new URL(request.url)`까지
	 * 깨진다. jsdom에 없는 두 메서드만 심고 원래 상태로 되돌린다.
	 */
	const urlApi = URL as unknown as ObjectUrlApi;
	const originalCreate = urlApi.createObjectURL;
	const originalRevoke = urlApi.revokeObjectURL;
	urlApi.createObjectURL = (blob: Blob) => {
		const url = `blob:mock/${blobs.size}`;
		blobs.set(url, blob);
		return url;
	};
	urlApi.revokeObjectURL = () => {};
	restoreObjectUrl = () => {
		urlApi.createObjectURL = originalCreate;
		urlApi.revokeObjectURL = originalRevoke;
	};

	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
		const blob = blobs.get(this.href);
		if (blob) {
			void blob.text().then((text) => saved.push({ download: this.download, type: blob.type, text }));
		}
	});
});

afterEach(() => {
	restoreObjectUrl();
	vi.restoreAllMocks();
});

describe("CertificatesPage", () => {
	it("renders the serial number and Korean status", async () => {
		renderAt("/certificates");

		expect(await screen.findByText(CERTIFICATE.serialNumber)).toBeInTheDocument();
		expect(screen.getByText("유효")).toBeInTheDocument();
	});

	/** ui-design.md §6 상세: 유효기간, 폐기 정보. 발급 CA는 서버 응답에 없어 만들지 않는다. */
	it("shows the validity window in the detail drawer", async () => {
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		expect(within(drawer).getByText("유효기간")).toBeInTheDocument();
		expect(within(drawer).getByText("발급일")).toBeInTheDocument();
		expect(within(drawer).queryByText("발급 CA")).not.toBeInTheDocument();
	});

	/** 인증서 원문은 목록·상세에 담기지 않고 다운로드로만 나간다(CertificateResponse). */
	it("never renders the certificate PEM on screen", async () => {
		const { container } = renderAt("/certificates");
		await openFirstCertificate();

		expect(container.textContent).not.toContain("BEGIN CERTIFICATE");
		expect(container.textContent).not.toContain("PRIVATE KEY");
	});

	it("downloads the public certificate as a .pem file named after the serial", async () => {
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "공개 인증서 다운로드" }));

		await waitFor(() => expect(saved).toHaveLength(1));
		expect(saved[0].download).toBe(`${CERTIFICATE.serialNumber}.pem`);
		expect(saved[0].type).toBe("application/x-pem-file");
		expect(saved[0].text).toBe(certificatePem);
	});

	it("reports a failed download instead of saving an empty file", async () => {
		mockServer.use(
			http.get("/api/v1/certificates/:certificateId/download", () =>
				HttpResponse.json(
					{ code: "CERTIFICATE_NOT_FOUND", message: "없음", traceId: "t", fieldErrors: [] },
					{ status: 404 },
				),
			),
		);
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "공개 인증서 다운로드" }));

		expect(await within(drawer).findByText("인증서를 내려받지 못했습니다.")).toBeInTheDocument();
		expect(saved).toHaveLength(0);
	});

	/** api-spec.md §5: reason은 필수다. 서버가 REVOCATION_REASON_REQUIRED로 막지만 먼저 막는다. */
	it("requires a revocation reason before enabling the confirm button", async () => {
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "폐기" }));
		const confirm = await screen.findByRole("button", { name: "폐기하기" });

		expect(confirm).toBeDisabled();
		await userEvent.type(screen.getByLabelText(/폐기 사유/), "KEY_COMPROMISE");
		expect(confirm).toBeEnabled();
	});

	/** 64자·500자 상한은 서버 검증과 같은 값이다. 넘으면 왕복 없이 막는다. */
	it("blocks a reason longer than the server accepts", async () => {
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "폐기" }));
		const confirm = await screen.findByRole("button", { name: "폐기하기" });

		await userEvent.type(screen.getByLabelText(/폐기 사유/), "가".repeat(65));

		expect(screen.getByText("65/64")).toBeInTheDocument();
		expect(confirm).toBeDisabled();
	});

	it("revokes with the reason and note, and reports the 30 second delay", async () => {
		const bodies: unknown[] = [];
		mockServer.use(
			http.post("/api/v1/certificates/:certificateId/revoke", async ({ request }) => {
				bodies.push(await request.json());
				return HttpResponse.json({
					...CERTIFICATE,
					status: "REVOKED",
					revokedAt: "2026-08-14T02:10:00Z",
					revocationReason: "KEY_COMPROMISE",
					revocationNote: "단말 분실",
				});
			}),
		);
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "폐기" }));
		await userEvent.type(screen.getByLabelText(/폐기 사유/), "KEY_COMPROMISE");
		await userEvent.type(screen.getByLabelText(/메모/), "단말 분실");
		await userEvent.click(await screen.findByRole("button", { name: "폐기하기" }));

		expect(
			await within(drawer).findByText("인증서를 폐기했습니다. Gateway 반영에 최대 30초가 걸립니다."),
		).toBeInTheDocument();
		expect(bodies).toEqual([{ reason: "KEY_COMPROMISE", note: "단말 분실" }]);
	});

	/** 메모를 비웠으면 note를 보내지 않는다 — 빈 문자열을 감사 기록으로 남기지 않는다. */
	it("omits the note when it is left empty", async () => {
		const bodies: unknown[] = [];
		mockServer.use(
			http.post("/api/v1/certificates/:certificateId/revoke", async ({ request }) => {
				bodies.push(await request.json());
				return HttpResponse.json({ ...CERTIFICATE, status: "REVOKED" });
			}),
		);
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "폐기" }));
		await userEvent.type(screen.getByLabelText(/폐기 사유/), "SUPERSEDED");
		await userEvent.click(await screen.findByRole("button", { name: "폐기하기" }));

		await within(drawer).findByText(/인증서를 폐기했습니다/);
		expect(bodies).toEqual([{ reason: "SUPERSEDED" }]);
	});

	/**
	 * 폐기는 되돌릴 수 없다. 상세 재조회가 늦거나 낡은 값을 줘도 다시 누를 수 없어야
	 * 한다 — 이 mock은 끝까지 VALID를 돌려준다(Task 9에서 고친 것과 같은 결함).
	 */
	it("locks the revoke button after the server confirms, even while the detail still reads VALID", async () => {
		let revokes = 0;
		mockServer.use(
			http.get("/api/v1/certificates/:certificateId", () => HttpResponse.json(CERTIFICATE)),
			http.post("/api/v1/certificates/:certificateId/revoke", () => {
				revokes += 1;
				return HttpResponse.json({ ...CERTIFICATE, status: "REVOKED" });
			}),
		);
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "폐기" }));
		await userEvent.type(screen.getByLabelText(/폐기 사유/), "KEY_COMPROMISE");
		await userEvent.click(await screen.findByRole("button", { name: "폐기하기" }));
		await within(drawer).findByText(/인증서를 폐기했습니다/);
		await closedDialog();

		expect(within(drawer).queryByRole("button", { name: "폐기" })).not.toBeInTheDocument();
		expect(revokes).toBe(1);
		expect(within(drawer).getByText("폐기")).toBeInTheDocument(); // 상태 칩
		expect(within(drawer).queryByText("유효")).not.toBeInTheDocument();
		// 다운로드는 폐기 후에도 가능하다 — 감사 목적으로 원문이 필요할 수 있다.
		expect(within(drawer).getByRole("button", { name: "공개 인증서 다운로드" })).toBeInTheDocument();
	});

	/** 이미 폐기된 인증서를 열면 폐기 버튼이 아예 없다. */
	it("offers no revoke button for an already revoked certificate", async () => {
		const revokedCertificate = {
			...CERTIFICATE,
			status: "REVOKED",
			revokedAt: "2026-08-14T02:10:00Z",
			revocationReason: "KEY_COMPROMISE",
			revocationNote: "단말 분실",
		};
		mockServer.use(
			http.get("/api/v1/certificates", () =>
				HttpResponse.json({ ...certificatePage, content: [revokedCertificate] }),
			),
			http.get("/api/v1/certificates/:certificateId", () => HttpResponse.json(revokedCertificate)),
		);
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		expect(within(drawer).queryByRole("button", { name: "폐기" })).not.toBeInTheDocument();
		expect(within(drawer).getByText("KEY_COMPROMISE")).toBeInTheDocument();
		expect(within(drawer).getByText("단말 분실")).toBeInTheDocument();
	});

	/** 다른 관리자가 먼저 폐기하면 409 CONFLICT다(api-spec.md §10). */
	it("surfaces the server message when revocation conflicts", async () => {
		mockServer.use(
			http.post("/api/v1/certificates/:certificateId/revoke", () =>
				HttpResponse.json(
					{ code: "CONFLICT", message: "이미 폐기된 인증서입니다.", traceId: "trace-5", fieldErrors: [] },
					{ status: 409 },
				),
			),
		);
		renderAt("/certificates");
		const drawer = await openFirstCertificate();

		await userEvent.click(within(drawer).getByRole("button", { name: "폐기" }));
		await userEvent.type(screen.getByLabelText(/폐기 사유/), "KEY_COMPROMISE");
		await userEvent.click(await screen.findByRole("button", { name: "폐기하기" }));

		expect(await screen.findByText("이미 폐기된 인증서입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-5/)).toBeInTheDocument();
	});

	it("sends the status and expiry filters to the server", async () => {
		const seen: string[] = [];
		mockServer.use(
			http.get("/api/v1/certificates", ({ request }) => {
				seen.push(new URL(request.url).search);
				return HttpResponse.json(certificatePage);
			}),
		);
		renderAt("/certificates?status=EXPIRING_SOON&expiresBefore=2026-09-01T00:00");
		await screen.findByText(CERTIFICATE.serialNumber);

		expect(seen[0]).toContain("status=EXPIRING_SOON");
		expect(seen[0]).toContain(
			`expiresBefore=${encodeURIComponent(new Date(2026, 8, 1, 0, 0, 0).toISOString())}`,
		);
	});

	/** 해석할 수 없는 시각을 서버로 보내 400을 만들지 않는다. */
	it("drops an unparseable expiry filter", async () => {
		const seen: string[] = [];
		mockServer.use(
			http.get("/api/v1/certificates", ({ request }) => {
				seen.push(new URL(request.url).search);
				return HttpResponse.json(certificatePage);
			}),
		);
		renderAt("/certificates?expiresBefore=2026-02-30T09:00");
		await screen.findByText(CERTIFICATE.serialNumber);

		expect(seen[0]).not.toContain("expiresBefore=");
		expect(await screen.findByText("시각으로 읽을 수 없어 조건에서 제외됩니다.")).toBeInTheDocument();
	});

	it("shows the empty state when nothing matches", async () => {
		mockServer.use(
			http.get("/api/v1/certificates", () =>
				HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
			),
		);
		renderAt("/certificates");

		expect(await screen.findByText("조건에 맞는 인증서가 없습니다.")).toBeInTheDocument();
	});

	it("shows the server error message and traceId when the list fails", async () => {
		mockServer.use(
			http.get("/api/v1/certificates", () =>
				HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "일시적인 오류입니다.", traceId: "trace-6", fieldErrors: [] },
					{ status: 500 },
				),
			),
		);
		renderAt("/certificates");

		expect(await screen.findByText("일시적인 오류입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-6/)).toBeInTheDocument();
	});
});
