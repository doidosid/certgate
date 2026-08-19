import type { ReactNode } from "react";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";

export interface Column<T> {
	key: string;
	header: string;
	render: (row: T) => ReactNode;
	width?: number;
}

interface Props<T> {
	columns: Column<T>[];
	rows: T[];
	getRowId: (row: T) => string;
	page: number;
	size: number;
	totalElements: number;
	onPageChange: (page: number) => void;
	onSizeChange: (size: number) => void;
	onRowClick?: (row: T) => void;
}

/** api-spec.md §1: page는 0-based, size 기본 20 최대 100. */
export default function DataTable<T>({
	columns,
	rows,
	getRowId,
	page,
	size,
	totalElements,
	onPageChange,
	onSizeChange,
	onRowClick,
}: Props<T>) {
	return (
		<Paper>
			<TableContainer>
				<Table size="small">
					<TableHead>
						<TableRow>
							{columns.map((column) => (
								<TableCell key={column.key} sx={{ width: column.width }}>
									{column.header}
								</TableCell>
							))}
						</TableRow>
					</TableHead>
					<TableBody>
						{rows.map((row) => (
							<TableRow
								key={getRowId(row)}
								hover={Boolean(onRowClick)}
								sx={{ cursor: onRowClick ? "pointer" : "default" }}
								onClick={onRowClick ? () => onRowClick(row) : undefined}
								// 행 클릭이 상세로 가는 유일한 경로이므로 키보드로도 같은 동작을
								// 할 수 있어야 한다. Enter·Space는 button의 기본 동작과 맞춘다.
								tabIndex={onRowClick ? 0 : undefined}
								role={onRowClick ? "button" : undefined}
								onKeyDown={
									onRowClick
										? (event) => {
												if (event.key === "Enter" || event.key === " ") {
													event.preventDefault();
													onRowClick(row);
												}
											}
										: undefined
								}
							>
								{columns.map((column) => (
									<TableCell key={column.key}>{column.render(row)}</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableContainer>
			<TablePagination
				component="div"
				count={totalElements}
				page={page}
				rowsPerPage={size}
				rowsPerPageOptions={[20, 50, 100]}
				onPageChange={(_, next) => onPageChange(next)}
				onRowsPerPageChange={(event) => onSizeChange(Number(event.target.value))}
				labelRowsPerPage="쪽당 행 수"
			/>
		</Paper>
	);
}
