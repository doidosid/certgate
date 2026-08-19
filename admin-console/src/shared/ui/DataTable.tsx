import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
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
	/**
	 * 행이 다른 화면으로 가는 경우 넘긴다. 첫 열이 실제 anchor로 렌더돼 새 탭
	 * 열기·가운데 클릭·주소 복사가 동작한다. 넘기지 않으면 첫 열은 button이 되고,
	 * 그건 이동이 아니라 그 자리에서 일어나는 동작에 맞는 표현이다.
	 */
	getRowHref?: (row: T) => string;
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
	getRowHref,
}: Props<T>) {
	const hasRowAction = Boolean(onRowClick ?? getRowHref);
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
								hover={hasRowAction}
								sx={{ cursor: hasRowAction ? "pointer" : "default" }}
								onClick={onRowClick ? () => onRowClick(row) : undefined}
							>
								{columns.map((column, columnIndex) => (
									<TableCell key={column.key}>
										{/*
										 * 첫 열만 실제 control로 감싼다. tr에 role="button"을 주면
										 * 키보드로는 열 수 있게 되지만 암시적 row role이 덮여
										 * table > row > cell 구조가 보조기술에서 사라진다. 행 전체
										 * onClick은 마우스 편의로 남기고, 키보드·스크린리더 경로는
										 * 이 control이 담당한다.
										 */}
										{hasRowAction && columnIndex === 0 ? (
											<RowActionCell
												href={getRowHref?.(row)}
												onActivate={onRowClick ? () => onRowClick(row) : undefined}
											>
												{column.render(row)}
											</RowActionCell>
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

/**
 * 이동이면 anchor, 그 자리에서 일어나는 동작이면 button으로 렌더한다. 둘 다
 * 셀 안에 두므로 tr은 row semantics를 유지한다.
 */
function RowActionCell({
	href,
	onActivate,
	children,
}: {
	href?: string;
	onActivate?: () => void;
	children: ReactNode;
}) {
	// 행 onClick과 겹쳐 두 번 실행되지 않게 한다.
	const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

	if (href) {
		return (
			<Link component={RouterLink} to={href} underline="hover" onClick={stop}>
				{children}
			</Link>
		);
	}
	return (
		<Link
			component="button"
			type="button"
			underline="hover"
			sx={{ textAlign: "left" }}
			onClick={(event) => {
				stop(event);
				onActivate?.();
			}}
		>
			{children}
		</Link>
	);
}
