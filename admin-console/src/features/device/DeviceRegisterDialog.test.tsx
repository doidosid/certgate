import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { mockServer } from "../../mocks/server";
import { deviceRegistered } from "../../mocks/fixtures";
import DeviceRegisterDialog from "./DeviceRegisterDialog";

function renderDialog(onClose = vi.fn()) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const rendered = render(
		<QueryClientProvider client={queryClient}>
			<DeviceRegisterDialog open onClose={onClose} />
		</QueryClientProvider>,
	);
	return { ...rendered, onClose, queryClient };
}

/** Mutation Cache 어디에도 평문이 없는지 본다 — variables·data 전부 훑는다. */
function mutationCacheContains(queryClient: QueryClient, secret: string): boolean {
	return queryClient
		.getMutationCache()
		.getAll()
		.some((mutation) => JSON.stringify(mutation.state).includes(secret));
}

/** 등록 폼을 채우고 제출한다. Role은 서버 목록(SENSOR·OPERATOR)에서 고른다. */
async function fillAndSubmit() {
	await userEvent.type(screen.getByLabelText(/Device Key/), "sensor-floor-09");
	await userEvent.type(screen.getByLabelText(/이름/), "9층 센서");
	await userEvent.click(screen.getByLabelText(/Role/));
	await userEvent.click(await screen.findByRole("option", { name: "SENSOR" }));
	await userEvent.click(screen.getByRole("button", { name: "등록" }));
}

let copied: string[];

beforeEach(() => {
	copied = [];
	// jsdom에는 clipboard가 없다. 복사한 값을 관찰할 수 있게 대신 심는다.
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
	});
});

afterEach(() => {
	Reflect.deleteProperty(navigator, "clipboard");
	vi.restoreAllMocks();
});

describe("DeviceRegisterDialog", () => {
	it("keeps 등록 disabled until every required field is filled", async () => {
		renderDialog();

		expect(screen.getByRole("button", { name: "등록" })).toBeDisabled();

		await userEvent.type(screen.getByLabelText(/Device Key/), "sensor-floor-09");
		expect(screen.getByRole("button", { name: "등록" })).toBeDisabled();

		await userEvent.type(screen.getByLabelText(/이름/), "9층 센서");
		expect(screen.getByRole("button", { name: "등록" })).toBeDisabled();

		await userEvent.click(screen.getByLabelText(/Role/));
		await userEvent.click(await screen.findByRole("option", { name: "SENSOR" }));
		expect(screen.getByRole("button", { name: "등록" })).toBeEnabled();
	});

	it("sends the trimmed values to the server", async () => {
		const bodies: unknown[] = [];
		mockServer.use(
			http.post("/api/v1/devices", async ({ request }) => {
				bodies.push(await request.json());
				return HttpResponse.json(deviceRegistered, { status: 201 });
			}),
		);
		renderDialog();

		await userEvent.type(screen.getByLabelText(/Device Key/), "  sensor-floor-09  ");
		await userEvent.type(screen.getByLabelText(/이름/), "  9층 센서  ");
		await userEvent.click(screen.getByLabelText(/Role/));
		await userEvent.click(await screen.findByRole("option", { name: "SENSOR" }));
		await userEvent.click(screen.getByRole("button", { name: "등록" }));

		await waitFor(() => expect(bodies).toHaveLength(1));
		expect(bodies[0]).toEqual({ deviceKey: "sensor-floor-09", name: "9층 센서", roleName: "SENSOR" });
	});

	/**
	 * 서버는 Token의 Hash만 저장하고 평문은 이 응답에만 한 번 온다(security-design.md §2).
	 * 다시 볼 수 없다는 사실을 사용자가 추측하게 두면 안 된다.
	 */
	it("shows the enrollment token once with a warning that it cannot be looked up again", async () => {
		renderDialog();
		await fillAndSubmit();

		expect(await screen.findByText(deviceRegistered.enrollmentToken)).toBeInTheDocument();
		expect(screen.getByText("이 값은 지금만 확인할 수 있습니다")).toBeInTheDocument();
		expect(screen.getByText(/다시 조회할 수 없고/)).toBeInTheDocument();
		// 발급 후에는 등록을 다시 누를 수 없다 — 폼이 사라진다.
		expect(screen.queryByRole("button", { name: "등록" })).not.toBeInTheDocument();
	});

	/**
	 * 평문이 mutation의 data가 되면 화면에서 지워도 Mutation Cache에 남는다. `reset()`은
	 * observer만 떼고 gc를 예약할 뿐이어서 기본 5분 동안 `getMutationCache()`로 꺼낼 수
	 * 있다(query-core mutation.js의 removeObserver). 그래서 응답을 mutation data로 만들지
	 * 않는다(Codex 리뷰 PR #47 Critical).
	 */
	it("never puts the plaintext token in the mutation cache", async () => {
		const { queryClient } = renderDialog();
		await fillAndSubmit();
		await screen.findByText(deviceRegistered.enrollmentToken);

		expect(mutationCacheContains(queryClient, deviceRegistered.enrollmentToken)).toBe(false);

		await userEvent.click(screen.getByRole("button", { name: "닫기" }));

		expect(mutationCacheContains(queryClient, deviceRegistered.enrollmentToken)).toBe(false);
	});

	/**
	 * Token은 서버가 한 번만 준다. 목록 재조회가 느리다고 표시를 미루면 그 사이의 새로고침·
	 * 이탈로 사용자가 발급된 값을 영구히 놓친다(Codex 리뷰 PR #47 High).
	 */
	it("shows the token without waiting for the device list to refetch", async () => {
		let listCalls = 0;
		mockServer.use(
			http.get("/api/v1/devices", async () => {
				listCalls += 1;
				// 등록 후 재조회는 아주 느리다.
				if (listCalls > 1) {
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}
				return HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
			}),
		);
		renderDialog();
		await fillAndSubmit();

		expect(await screen.findByText(deviceRegistered.enrollmentToken, undefined, { timeout: 2000 })).toBeInTheDocument();
	});

	it("copies the token to the clipboard", async () => {
		renderDialog();
		await fillAndSubmit();
		await screen.findByText(deviceRegistered.enrollmentToken);

		await userEvent.click(screen.getByRole("button", { name: "Token 복사" }));

		expect(copied).toEqual([deviceRegistered.enrollmentToken]);
		expect(await screen.findByRole("button", { name: "복사했습니다" })).toBeInTheDocument();
	});

	/** 클립보드 권한이 없는 브라우저에서도 Token을 옮길 방법이 남아 있어야 한다. */
	it("tells the user to copy manually when the clipboard is unavailable", async () => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: () => Promise.reject(new Error("denied")) },
		});
		renderDialog();
		await fillAndSubmit();
		await screen.findByText(deviceRegistered.enrollmentToken);

		await userEvent.click(screen.getByRole("button", { name: "Token 복사" }));

		expect(await screen.findByText(/직접 선택해 복사하세요/)).toBeInTheDocument();
		// 값 자체는 화면에 남아 있다.
		expect(screen.getByText(deviceRegistered.enrollmentToken)).toBeInTheDocument();
	});

	/** 창을 닫으면 평문을 버린다. 다시 열었을 때 남아 있으면 1회 노출이 아니다. */
	it("drops the token when the dialog closes", async () => {
		const { onClose, rerender } = renderDialog();
		await fillAndSubmit();
		await screen.findByText(deviceRegistered.enrollmentToken);

		await userEvent.click(screen.getByRole("button", { name: "닫기" }));
		expect(onClose).toHaveBeenCalled();

		// 호출자가 open을 false로 만들고 다시 열어도 이전 Token이 보이지 않는다.
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		rerender(
			<QueryClientProvider client={queryClient}>
				<DeviceRegisterDialog open onClose={onClose} />
			</QueryClientProvider>,
		);

		expect(screen.queryByText(deviceRegistered.enrollmentToken)).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "등록" })).toBeInTheDocument();
	});

	/** 이미 등록된 deviceKey는 409 DEVICE_KEY_DUPLICATE다(api-spec.md §10). */
	it("surfaces a duplicate device key from the server", async () => {
		mockServer.use(
			http.post("/api/v1/devices", () =>
				HttpResponse.json(
					{
						code: "DEVICE_KEY_DUPLICATE",
						message: "이미 등록된 Device Key입니다.",
						traceId: "trace-11",
						fieldErrors: [],
					},
					{ status: 409 },
				),
			),
		);
		renderDialog();
		await fillAndSubmit();

		expect(await screen.findByText("이미 등록된 Device Key입니다.")).toBeInTheDocument();
		expect(screen.getByText(/DEVICE_KEY_DUPLICATE/)).toBeInTheDocument();
		expect(screen.getByText(/trace-11/)).toBeInTheDocument();
		// 실패했으므로 폼은 그대로 있고 다시 시도할 수 있다.
		expect(screen.getByRole("button", { name: "등록" })).toBeEnabled();
	});
});
