import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeviceFilters from "./DeviceFilters";

/**
 * 부모가 계속 다시 render되는 상황을 만든다. 실제 DevicesPage도 매 render마다 inline
 * 화살표 함수를 onChange로 넘기므로, debounce가 callback identity에 의존하면 검색
 * 요청이 무한히 밀린다(Codex 리뷰 PR #46 Low).
 */
function RerenderingParent({ onChange }: { onChange: (key: string, value: string) => void }) {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => setTick((current) => current + 1), 50);
		return () => clearInterval(timer);
	}, []);

	return (
		<>
			<span data-testid="tick">{tick}</span>
			{/* onChange를 inline으로 넘겨 매 render마다 identity가 바뀌게 한다. */}
			<DeviceFilters query="" status="" roleName="" onChange={(key, value) => onChange(key, value)} />
		</>
	);
}

describe("DeviceFilters", () => {
	it("calls onChange once after typing stops even while the parent keeps re-rendering", async () => {
		vi.useFakeTimers();
		try {
			const onChange = vi.fn();
			const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
			render(
				<QueryClientProvider client={queryClient}>
					<RerenderingParent onChange={onChange} />
				</QueryClientProvider>,
			);

			fireEvent.change(screen.getByLabelText("이름 또는 Device Key"), { target: { value: "sen" } });

			// 부모는 50ms마다 다시 render된다. debounce는 그것과 무관하게 300ms 뒤 한 번만
			// 울려야 한다 — callback identity를 의존성에 두면 여기서 한 번도 울리지 않는다.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(400);
			});

			expect(onChange.mock.calls).toEqual([["query", "sen"]]);
		} finally {
			vi.useRealTimers();
		}
	});
});
