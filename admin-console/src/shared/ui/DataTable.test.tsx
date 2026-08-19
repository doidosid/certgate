import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

		const firstRow = screen.getByText("sensor-floor-01").closest("tr");
		expect(firstRow).not.toBeNull();
		firstRow!.focus();
		expect(firstRow).toHaveFocus();

		await userEvent.keyboard("{Enter}");
		expect(onRowClick).toHaveBeenCalledWith(rows[0]);

		await userEvent.keyboard(" ");
		expect(onRowClick).toHaveBeenCalledTimes(2);
	});

	/** 클릭 동작이 없는 표의 행까지 Tab 순서에 넣으면 키보드 이동만 길어진다. */
	it("does not make rows focusable when they are not clickable", () => {
		renderTable();

		const firstRow = screen.getByText("sensor-floor-01").closest("tr");
		expect(firstRow).not.toHaveAttribute("tabindex");
		expect(firstRow).not.toHaveAttribute("role", "button");
	});
});
