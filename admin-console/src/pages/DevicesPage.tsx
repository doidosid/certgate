import { useState } from "react";
import Button from "@mui/material/Button";
import DeviceFilters from "../features/device/DeviceFilters";
import DeviceRegisterDialog from "../features/device/DeviceRegisterDialog";
import { useDevices } from "../features/device/queries";
import {
	certificateStatusColor,
	certificateStatusLabel,
	deviceStatusColor,
	deviceStatusLabel,
} from "../features/device/labels";
import type { DeviceListItem } from "../shared/api/types";
import { usePageParams } from "../shared/api/usePageParams";
import DataTable, { type Column } from "../shared/ui/DataTable";
import DateTimeText from "../shared/ui/DateTimeText";
import Mono from "../shared/ui/Mono";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

/** ui-design.md §4 목록 컬럼: 이름, Device Key, Role, 상태, 인증서 상태, 만료일, 마지막 접속. */
const COLUMNS: Column<DeviceListItem>[] = [
	{ key: "name", header: "이름", render: (row) => row.name },
	{ key: "deviceKey", header: "Device Key", render: (row) => <Mono>{row.deviceKey}</Mono> },
	{ key: "roleName", header: "Role", render: (row) => row.roleName },
	{
		key: "status",
		header: "상태",
		render: (row) => <StatusChip label={deviceStatusLabel(row.status)} color={deviceStatusColor(row.status)} />,
	},
	{
		key: "certificateStatus",
		header: "인증서",
		render: (row) => (
			<StatusChip
				label={certificateStatusLabel(row.certificateStatus)}
				color={certificateStatusColor(row.certificateStatus)}
			/>
		),
	},
	{ key: "certificateExpiresAt", header: "만료일", render: (row) => <DateTimeText value={row.certificateExpiresAt} /> },
	{ key: "lastSeenAt", header: "마지막 접속", render: (row) => <DateTimeText value={row.lastSeenAt} /> },
];

export default function DevicesPage() {
	const { page, size, setPage, setSize, setParam, get } = usePageParams();
	const [registerOpen, setRegisterOpen] = useState(false);
	const query = get("query") ?? "";
	const status = get("status") ?? "";
	const roleName = get("roleName") ?? "";

	const devices = useDevices({ query, status, roleName, page, size });

	return (
		<>
			<PageHeader
				title="Devices"
				actions={
					<Button variant="contained" onClick={() => setRegisterOpen(true)}>
						디바이스 등록
					</Button>
				}
			/>
			<DeviceFilters
				query={query}
				status={status}
				roleName={roleName}
				onChange={(key, value) => setParam(key, value)}
			/>
			{/*
			 * isEmpty를 content.length로 판단하면, 범위를 벗어난 page(공유 URL의
			 * ?page=1 등)에서 표가 통째로 빈 문구로 바뀌며 페이지 이동 컨트롤까지
			 * 사라져 첫 페이지로 돌아올 방법이 없어진다. 결과가 정말 0건일 때만
			 * 빈 상태로 두고, 그 외에는 표와 pagination을 유지한다.
			 */}
			<QueryState
				isLoading={devices.isPending}
				isError={devices.isError}
				error={devices.error}
				isEmpty={devices.data?.totalElements === 0}
				emptyMessage="조건에 맞는 디바이스가 없습니다."
				onRetry={() => devices.refetch()}
			>
				<DataTable
					columns={COLUMNS}
					rows={devices.data?.content ?? []}
					getRowId={(row) => row.id}
					page={page}
					size={size}
					totalElements={devices.data?.totalElements ?? 0}
					onPageChange={setPage}
					onSizeChange={setSize}
					getRowHref={(row) => `/devices/${row.id}`}
				/>
			</QueryState>

			<DeviceRegisterDialog open={registerOpen} onClose={() => setRegisterOpen(false)} />
		</>
	);
}
