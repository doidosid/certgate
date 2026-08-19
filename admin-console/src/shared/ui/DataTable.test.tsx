import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import DataTable, { type Column } from "./DataTable";

interface Row {
	id: string;
	name: string;
}

const columns: Column<Row>[] = [{ key: "name", header: "이름", render: (row) => row.name }];
const rows: Row[] = [
	{ id: "a", name: "sensor-floor-01" },
	{ id: "b", name: "sensor-floor-02" },
];

function renderTable(onRowClick?: (row: Row) => void) {
	return render(
		<DataTable
			columns={columns}
			rows={rows}
			getRowId={(row) => row.id}
			page={0}
			size={20}
			totalElements={rows.length}
			onPageChange={vi.fn()}
			onSizeChange={vi.fn()}
			onRowClick={onRowClick}
		/>,
	);
}

describe("DataTable", () => {
	it("renders a cell per column", () => {
		renderTable();
		expect(screen.getByText("sensor-floor-01")).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "이름" })).toBeInTheDocument();
	});

	/**
	 * 행 클릭이 상세로 가는 유일한 경로다. 키보드만 쓰는 사용자가 상세를 열 수
	 * 없으면 그 화면 전체에 접근할 수 없다(Codex 리뷰 PR #43 Low).
	 */
	it("opens a row with the keyboard, not just the mouse", async () => {
		const onRowClick = vi.fn();
		renderTable(onRowClick);

		const trigger = screen.getByRole("button", { name: "sensor-floor-01" });
		await userEvent.tab();
		expect(trigger).toHaveFocus();

		await userEvent.keyboard("{Enter}");
		expect(onRowClick).toHaveBeenCalledWith(rows[0]);
	});

	/**
	 * tr에 role="button"을 씌우면 키보드로는 열리지만 암시적 row role이 덮여
	 * table > row > cell 구조가 보조기술에서 사라진다(Codex 리뷰 PR #43 Low).
	 * 표 구조는 유지한 채 셀 안의 button이 키보드 경로를 담당해야 한다.
	 */
	it("keeps table row semantics while still being keyboard reachable", () => {
		renderTable(vi.fn());

		// 헤더 1 + 데이터 2 = 3. tr이 button으로 덮였다면 row로 세어지지 않는다.
		expect(screen.getAllByRole("row")).toHaveLength(3);
		expect(screen.getByText("sensor-floor-01").closest("tr")).not.toHaveAttribute("role", "button");
		expect(screen.getByRole("button", { name: "sensor-floor-01" })).toBeInTheDocument();
	});

	it("fires the row callback once, not twice, when the cell control is used", async () => {
		const onRowClick = vi.fn();
		renderTable(onRowClick);

		await userEvent.click(screen.getByRole("button", { name: "sensor-floor-01" }));

		expect(onRowClick).toHaveBeenCalledTimes(1);
	});

	/** 클릭 동작이 없는 표에는 행을 여는 컨트롤도 없어야 한다. */
	it("adds no row control when rows are not clickable", () => {
		renderTable();

		expect(screen.queryByRole("button", { name: "sensor-floor-01" })).not.toBeInTheDocument();
	});

	/**
	 * 다른 화면으로 가는 행은 button이 아니라 anchor여야 새 탭 열기·가운데 클릭·
	 * 주소 복사가 동작한다. 이동을 button으로 표현하면 그게 전부 막힌다.
	 */
	it("renders a real link when the row navigates elsewhere", () => {
		render(
			<MemoryRouter>
				<DataTable
					columns={columns}
					rows={rows}
					getRowId={(row) => row.id}
					page={0}
					size={20}
					totalElements={rows.length}
					onPageChange={vi.fn()}
					onSizeChange={vi.fn()}
					getRowHref={(row) => `/devices/${row.id}`}
				/>
			</MemoryRouter>,
		);

		expect(screen.getByRole("link", { name: "sensor-floor-01" })).toHaveAttribute("href", "/devices/a");
		expect(screen.queryByRole("button", { name: "sensor-floor-01" })).not.toBeInTheDocument();
		// 이동 방식이어도 표 구조는 그대로여야 한다.
		expect(screen.getAllByRole("row")).toHaveLength(3);
	});
});
