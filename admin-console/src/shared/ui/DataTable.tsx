import type { ReactNode } from "react";
import Link from "@mui/material/Link";
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
							>
								{columns.map((column, columnIndex) => (
									<TableCell key={column.key}>
										{/*
										 * 첫 열만 실제 button으로 감싼다. tr에 role="button"을 주면
										 * 키보드로는 열 수 있게 되지만 암시적 row role이 덮여
										 * table > row > cell 구조가 보조기술에서 사라진다. 행 전체
										 * onClick은 마우스 편의로 남기고, 키보드·스크린리더 경로는
										 * 이 button이 담당한다.
										 */}
										{onRowClick && columnIndex === 0 ? (
											<Link
												component="button"
												type="button"
												underline="hover"
												sx={{ textAlign: "left" }}
												onClick={(event) => {
													// 행 onClick과 겹쳐 두 번 실행되지 않게 한다.
													event.stopPropagation();
													onRowClick(row);
												}}
											>
												{column.render(row)}
											</Link>
										) : (
											column.render(row)
										)}
									</TableCell>
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
