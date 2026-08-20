import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { mockServer } from "../../mocks/server";
import { devicePage } from "../../mocks/fixtures";
import DeviceSelect from "./DeviceSelect";

const FIRST = devicePage.content[0];
const FAR_DEVICE = {
	...FIRST,
	id: "aaaaaaaa-0000-4000-8000-0000000000aa",
	deviceKey: "sensor-far-101",
	name: "101번째 센서",
};

/** 실제 사용처처럼 선택이 부모 상태로 올라가고 다시 value로 내려온다. */
function Harness({ initial, onChange }: { initial: string; onChange: (id: string) => void }) {
	const [value, setValue] = useState(initial);
	return (
		<DeviceSelect
			value={value}
			onChange={(id) => {
				setValue(id);
				onChange(id);
			}}
		/>
	);
}

function renderSelect(initial = "", onChange: (id: string) => void = () => {}) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<Harness initial={initial} onChange={onChange} />
		</QueryClientProvider>,
	);
}

/** 검색어별로 다른 결과를 주는 서버. query Parameter가 실제로 전달되는지 함께 본다. */
function serveSearch(seen: string[]) {
	mockServer.use(
		http.get("/api/v1/devices", ({ request }) => {
			const query = new URL(request.url).searchParams.get("query") ?? "";
			seen.push(query);
			if (query === "far") {
				return HttpResponse.json({
					content: [FAR_DEVICE],
					page: 0,
					size: 100,
					totalElements: 1,
					totalPages: 1,
				});
			}
			return HttpResponse.json(devicePage);
		}),
	);
}

describe("DeviceSelect", () => {
	it("sends the typed text to the server as a query and selects the found device", async () => {
		const seen: string[] = [];
		serveSearch(seen);
		const onChange = vi.fn();
		renderSelect("", onChange);

		await userEvent.type(screen.getByLabelText("디바이스"), "far");
		await userEvent.click(await screen.findByRole("option", { name: /101번째 센서/ }, { timeout: 3000 }));

		expect(seen).toContain("far");
		expect(onChange).toHaveBeenLastCalledWith(FAR_DEVICE.id);
	});

	/**
	 * Autocomplete의 value prop 참조가 render마다 바뀌면 MUI가 그것을 선택 변경으로
	 * 보고 입력창을 기존 Device 라벨로 되돌린다. 그러면 이미 선택된 상태에서 다른
	 * Device를 검색할 수 없다(Codex 리뷰 PR #46 Medium).
	 */
	it("keeps the typed text while a device is already selected", async () => {
		const seen: string[] = [];
		serveSearch(seen);
		renderSelect(FIRST.id);

		const input = screen.getByLabelText("디바이스");
		// 선택된 Device의 라벨이 먼저 채워진다.
		expect(await screen.findByDisplayValue(`${FIRST.name} (${FIRST.deviceKey})`)).toBeInTheDocument();

		await userEvent.clear(input);
		await userEvent.type(input, "far");

		expect(input).toHaveValue("far");
		await expect.poll(() => seen.includes("far")).toBe(true);
		expect(await screen.findByRole("option", { name: /101번째 센서/ }, { timeout: 3000 })).toBeInTheDocument();
	});

	/**
	 * URL로 받은 deviceId가 현재 검색 결과에 없을 수 있다. 그때 라벨을 목록에서 찾지
	 * 못한다고 UUID를 보여주면 어떤 Device로 필터되어 있는지 알 수 없다 — 상세 조회로
	 * 이름을 따로 확인한다.
	 */
	it("labels a selected device that the search results do not contain", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json({
					content: [FAR_DEVICE],
					page: 0,
					size: 100,
					totalElements: 1,
					totalPages: 1,
				}),
			),
		);
		renderSelect(FIRST.id);

		expect(await screen.findByDisplayValue(`${FIRST.name} (${FIRST.deviceKey})`)).toBeInTheDocument();
	});

	describe("일치 건수 안내", () => {
		function servePage(totalElements: number, count: number) {
			const content = Array.from({ length: count }, (_, index) => ({
				...FIRST,
				id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
				deviceKey: `sensor-${index}`,
				name: `센서 ${index}`,
			}));
			mockServer.use(
				http.get("/api/v1/devices", () =>
					HttpResponse.json({ content, page: 0, size: 100, totalElements, totalPages: 1 }),
				),
			);
		}

		it("한 페이지에 다 담기면 안내하지 않는다", async () => {
			servePage(100, 100);
			renderSelect();

			expect(await screen.findByLabelText("디바이스")).toBeInTheDocument();
			expect(screen.queryByText(/개를 넘습니다/)).not.toBeInTheDocument();
		});

		it("한 개라도 넘치면 검색어를 좁히라고 알린다", async () => {
			servePage(101, 100);
			renderSelect();

			expect(await screen.findByText(/일치하는 Device가 100개를 넘습니다\(101개\)/)).toBeInTheDocument();
		});
	});
});
