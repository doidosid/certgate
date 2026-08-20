import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DeviceNameLink from "./DeviceNameLink";

function renderInRow(deviceId: string | null, onRowClick: () => void) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter>
				{/* 실제 사용처와 같은 모양: 행 전체에 클릭 핸들러가 걸린 안쪽 셀이다. */}
				<div onClick={onRowClick}>
					<DeviceNameLink deviceId={deviceId} />
				</div>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("DeviceNameLink", () => {
	it("shows the device name once the list loads", async () => {
		renderInRow("0d6515ae-d560-4777-b102-054e71f98ef9", () => {});

		expect(await screen.findByRole("link", { name: "1층 온도 센서" })).toHaveAttribute(
			"href",
			"/devices/0d6515ae-d560-4777-b102-054e71f98ef9",
		);
	});

	/**
	 * 행 클릭은 상세 Drawer를 열고 이 링크는 다른 화면으로 이동한다. 전파를 막지
	 * 않으면 두 동작이 함께 일어난다(Codex 리뷰 PR #46 Low — 기존 테스트는 href와
	 * 행 클릭을 따로만 확인해서 이 회귀를 잡지 못했다).
	 */
	it("does not bubble its click up to the row handler", async () => {
		const onRowClick = vi.fn();
		renderInRow("0d6515ae-d560-4777-b102-054e71f98ef9", onRowClick);

		await userEvent.click(await screen.findByRole("link", { name: "1층 온도 센서" }));

		expect(onRowClick).not.toHaveBeenCalled();
	});

	/** Device와 무관한 Event(SYSTEM·PKI)를 링크로 오인하게 만들지 않는다. */
	it("renders no link when the event has no device", () => {
		renderInRow(null, () => {});

		expect(screen.queryByRole("link")).not.toBeInTheDocument();
		expect(screen.getByText("—")).toBeInTheDocument();
	});
});
