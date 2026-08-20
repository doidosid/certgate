import { useState } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import DeviceNameLink from "../features/device/DeviceNameLink";
import SecurityEventFilters from "../features/securityEvent/SecurityEventFilters";
import {
	decisionColor,
	decisionLabel,
	eventTypeLabel,
	severityColor,
	severityLabel,
} from "../features/securityEvent/labels";
import { useSecurityEvents } from "../features/securityEvent/queries";
import type { SecurityEvent } from "../shared/api/types";
import { localDateTimeToInstant } from "../shared/api/localDateTime";
import { usePageParams } from "../shared/api/usePageParams";
import DataTable, { type Column } from "../shared/ui/DataTable";
import DateTimeText from "../shared/ui/DateTimeText";
import Mono from "../shared/ui/Mono";
import Field from "../shared/ui/Field";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

/**
 * ui-design.md §7 목록 컬럼: 발생 시각, 디바이스, 요청 경로, 결과, 사유, 접속 IP,
 * 응답 시간. 심각도를 함께 두는 이유는 CRITICAL을 목록에서 바로 골라내야 하기
 * 때문이다(Issue #6에서 넘어온 CRITICAL 확인 흐름).
 */
const COLUMNS: Column<SecurityEvent>[] = [
	{ key: "occurredAt", header: "발생 시각", render: (row) => <DateTimeText value={row.occurredAt} /> },
	{
		key: "severity",
		header: "심각도",
		render: (row) => <StatusChip label={severityLabel(row.severity)} color={severityColor(row.severity)} />,
	},
	{ key: "deviceId", header: "디바이스", render: (row) => <DeviceNameLink deviceId={row.deviceId} /> },
	{ key: "requestPath", header: "요청 경로", render: (row) => <Mono>{row.requestPath ?? "—"}</Mono> },
	{
		key: "decision",
		header: "결과",
		render: (row) => <StatusChip label={decisionLabel(row.decision)} color={decisionColor(row.decision)} />,
	},
	{ key: "reasonCode", header: "사유", render: (row) => <Mono>{row.reasonCode}</Mono> },
	{ key: "clientIp", header: "접속 IP", render: (row) => <Mono tabular>{row.clientIp ?? "—"}</Mono> },
	{ key: "latencyMs", header: "응답(ms)", render: (row) => <Mono tabular>{row.latencyMs ?? "—"}</Mono> },
];

/**
 * 보안 기록은 수정·삭제할 수 없다(ui-design.md §7). 이 화면에는 조회 외의 어떤
 * 변경 동작도 두지 않는다.
 */
export default function SecurityEventsPage() {
	const { page, size, setPage, setSize, setParam, get } = usePageParams();
	const [selected, setSelected] = useState<SecurityEvent | null>(null);

	const values = {
		from: get("from") ?? "",
		to: get("to") ?? "",
		deviceId: get("deviceId") ?? "",
		decision: get("decision") ?? "",
		severity: get("severity") ?? "",
		reasonCode: get("reasonCode") ?? "",
	};

	const events = useSecurityEvents({
		from: localDateTimeToInstant(values.from),
		to: localDateTimeToInstant(values.to),
		deviceId: values.deviceId || undefined,
		decision: values.decision || undefined,
		severity: values.severity || undefined,
		reasonCode: values.reasonCode || undefined,
		page,
		size,
	});

	return (
		<>
			<PageHeader title="Security Events" />
			<SecurityEventFilters values={values} onChange={(key, value) => setParam(key, value)} />
			{/*
			 * 결과가 정말 0건일 때만 빈 상태로 둔다. content.length로 판단하면 범위를
			 * 벗어난 page에서 pagination까지 사라져 첫 페이지로 돌아올 수 없다
			 * (Codex 리뷰 PR #44 Medium).
			 */}
			<QueryState
				isLoading={events.isPending}
				isError={events.isError}
				error={events.error}
				isEmpty={events.data?.totalElements === 0}
				emptyMessage="조건에 맞는 보안 이벤트가 없습니다."
				onRetry={() => events.refetch()}
			>
				<DataTable
					columns={COLUMNS}
					rows={events.data?.content ?? []}
					getRowId={(row) => row.id}
					page={page}
					size={size}
					totalElements={events.data?.totalElements ?? 0}
					onPageChange={setPage}
					onSizeChange={setSize}
					// 상세는 별도 화면이 아니라 Drawer다 — 목록의 필터·페이지를 잃지 않고
					// 여러 Event를 이어서 확인하는 흐름이다.
					onRowClick={setSelected}
				/>
			</QueryState>

			<Drawer anchor="right" open={selected !== null} onClose={() => setSelected(null)}>
				{/*
				 * AppLayout의 AppBar는 zIndex를 drawer + 1로 올려 항상 위에 있다. spacer가
				 * 없으면 이 Drawer의 첫 줄(제목)이 AppBar에 가려 보이지 않는다 — 브라우저로
				 * 확인해서 찾았고, DOM만 보는 테스트로는 잡히지 않는다.
				 */}
				<Toolbar />
				<Box sx={{ width: 440, p: 3 }}>
					{/* h1(PageHeader) 다음 단계를 건너뛰지 않게 h2로 둔다(Codex 리뷰 PR #44 Low). */}
					<Typography variant="h6" component="h2" gutterBottom>
						보안 이벤트 상세
					</Typography>
					{selected && (
						<>
							<Field label="발생 시각">
								<DateTimeText value={selected.occurredAt} />
							</Field>
							<Field label="유형">{eventTypeLabel(selected.type)}</Field>
							<Field label="심각도">
								<StatusChip
									label={severityLabel(selected.severity)}
									color={severityColor(selected.severity)}
								/>
							</Field>
							<Field label="결과">
								<StatusChip
									label={decisionLabel(selected.decision)}
									color={decisionColor(selected.decision)}
								/>
							</Field>
							<Field label="사유"><Mono>{selected.reasonCode}</Mono></Field>
							<Field label="디바이스">
								<DeviceNameLink deviceId={selected.deviceId} />
							</Field>
							<Field label="인증서 Serial"><Mono>{selected.certificateSerial ?? "—"}</Mono></Field>
							<Field label="HTTP">
								<Mono>
									{selected.httpMethod === null && selected.requestPath === null
										? "—"
										: `${selected.httpMethod ?? "—"} ${selected.requestPath ?? ""}`.trim()}
								</Mono>
							</Field>
							<Field label="접속 IP"><Mono tabular>{selected.clientIp ?? "—"}</Mono></Field>
							<Field label="응답 시간">
								<Mono tabular>{selected.latencyMs === null ? "—" : `${selected.latencyMs} ms`}</Mono>
							</Field>
							{/* 같은 Trace ID로 Gateway·Management API 로그까지 따라갈 수 있다(ui-design.md §7). */}
							<Field label="Trace ID"><Mono>{selected.traceId}</Mono></Field>
						</>
					)}
				</Box>
			</Drawer>
		</>
	);
}
