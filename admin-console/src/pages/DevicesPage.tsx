import DeviceFilters from "../features/device/DeviceFilters";
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
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

/** ui-design.md §4 목록 컬럼: 이름, Device Key, Role, 상태, 인증서 상태, 만료일, 마지막 접속. */
const COLUMNS: Column<DeviceListItem>[] = [
	{ key: "name", header: "이름", render: (row) => row.name },
	{ key: "deviceKey", header: "Device Key", render: (row) => row.deviceKey },
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
	const query = get("query") ?? "";
	const status = get("status") ?? "";
	const roleName = get("roleName") ?? "";

	const devices = useDevices({ query, status, roleName, page, size });

	return (
		<>
			<PageHeader title="Devices" />
			<DeviceFilters
				query={query}
				status={status}
				roleName={roleName}
				onChange={(key, value) => setParam(key, value)}
			/>
			<QueryState
				isLoading={devices.isPending}
				isError={devices.isError}
				error={devices.error}
				isEmpty={devices.data?.content.length === 0}
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
		</>
	);
}
