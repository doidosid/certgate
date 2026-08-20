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
	 * 선택을 유지한 채로 입력해야 회귀를 잡는다. `value` prop의 참조가 render마다 바뀌면
	 * MUI가 그것을 선택 변경으로 보고 입력창을 기존 라벨로 되돌린다 — 근거는
	 * useAutocomplete의 `const valueChange = value !== previousProps.value`(참조 비교)와
	 * 바로 아래의 `if (focused && !valueChange) return`이다. focus 중에 참조가 바뀌면
	 * early return을 타지 못해 resetInputValue가 실행된다(Codex 리뷰 PR #46 Medium).
	 *
	 * 먼저 clear하면 입력이 ""가 되는 순간 MUI가 선택을 null로 만들어(handleInputChange의
	 * clear 분기) 그 뒤 타이핑은 선택이 없는 상태에서 일어난다. 그 경로는 참조가 바뀌지
	 * 않아 회귀 구현에서도 통과한다 — 그래서 지우지 않고 이어서 입력한다.
	 */
	it("keeps the typed text while a device stays selected", async () => {
		serveSearch([]);
		const onChange = vi.fn();
		renderSelect(FIRST.id, onChange);

		const input = await screen.findByDisplayValue(`${FIRST.name} (${FIRST.deviceKey})`);

		// focus하면 MUI가 라벨을 전체 선택하므로(selectOnFocus 기본값) 입력이 라벨을 덮는다.
		await userEvent.type(input, "far");

		// 회귀 구현에서는 keystroke마다 입력이 라벨로 되돌아가 "far"가 남지 않는다.
		expect(input).toHaveValue("far");
		// 선택은 유지된다 — 입력이 ""를 거치지 않았으므로 clear 경로를 타지 않는다.
		expect(onChange).not.toHaveBeenCalled();
	});

	/** 선택을 지우고 다시 검색하는 흐름도 동작해야 한다. */
	it("searches again after the selection is cleared", async () => {
		const seen: string[] = [];
		serveSearch(seen);
		renderSelect(FIRST.id);

		const input = await screen.findByDisplayValue(`${FIRST.name} (${FIRST.deviceKey})`);
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
