import { useState } from "react";
import DeviceNameLink from "../features/device/DeviceNameLink";
import SecurityEventFilters from "../features/securityEvent/SecurityEventFilters";
import {
	decisionColor,
	decisionLabel,
	eventTypeLabel,
	severityColor,
	severityLabel,
} from "../features/securityEvent/labels";
import { useSecurityEvent, useSecurityEvents } from "../features/securityEvent/queries";
import type { SecurityEvent } from "../shared/api/types";
import { localDateTimeToInstant } from "../shared/api/localDateTime";
import { usePageParams } from "../shared/api/usePageParams";
import DataTable, { type Column } from "../shared/ui/DataTable";
import DateTimeText from "../shared/ui/DateTimeText";
import DetailDrawer from "../shared/ui/DetailDrawer";
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

	/*
	 * Dashboard 패널과 CRITICAL Toast는 "원인이 된 Event 상세로 이동"해야 한다
	 * (ui-design.md §3·§8). 이 화면에는 Event 하나만 여는 route가 없으므로 목록 URL에
	 * eventId를 실어 Drawer를 연다. 같은 reasonCode로 필터링만 하면 그 코드가 여러
	 * 건일 때 어느 것이 원인인지 지목하지 못한다(Codex 리뷰 PR #49 Medium).
	 */
	const linkedEventId = get("eventId") ?? "";
	const linkedEvent = useSecurityEvent(linkedEventId);

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

	// 목록에서 고른 Event는 이미 상세와 같은 응답이라 다시 조회하지 않는다.
	const detail = selected ?? linkedEvent.data ?? null;

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

			<DetailDrawer
				open={selected !== null || linkedEventId !== ""}
				title="보안 이벤트 상세"
				onClose={() => {
					setSelected(null);
					setParam("eventId", undefined);
				}}
			>
				{/* 링크로 들어온 Event는 아직 없을 수 있다 — 로딩·실패를 Drawer 안에서 드러낸다. */}
				{selected === null && linkedEventId !== "" && (
					<QueryState
						isLoading={linkedEvent.isPending}
						isError={linkedEvent.isError}
						error={linkedEvent.error}
						isEmpty={false}
						onRetry={() => linkedEvent.refetch()}
					>
						<></>
					</QueryState>
				)}
				{detail && (
						<>
							<Field label="발생 시각">
								<DateTimeText value={detail.occurredAt} />
							</Field>
							<Field label="유형">{eventTypeLabel(detail.type)}</Field>
							<Field label="심각도">
								<StatusChip
									label={severityLabel(detail.severity)}
									color={severityColor(detail.severity)}
								/>
							</Field>
							<Field label="결과">
								<StatusChip
									label={decisionLabel(detail.decision)}
									color={decisionColor(detail.decision)}
								/>
							</Field>
							<Field label="사유"><Mono>{detail.reasonCode}</Mono></Field>
							<Field label="디바이스">
								<DeviceNameLink deviceId={detail.deviceId} />
							</Field>
							<Field label="인증서 Serial"><Mono>{detail.certificateSerial ?? "—"}</Mono></Field>
							<Field label="HTTP">
								<Mono>
									{detail.httpMethod === null && detail.requestPath === null
										? "—"
										: `${detail.httpMethod ?? "—"} ${detail.requestPath ?? ""}`.trim()}
								</Mono>
							</Field>
							<Field label="접속 IP"><Mono tabular>{detail.clientIp ?? "—"}</Mono></Field>
							<Field label="응답 시간">
								<Mono tabular>{detail.latencyMs === null ? "—" : `${detail.latencyMs} ms`}</Mono>
							</Field>
							{/* 같은 Trace ID로 Gateway·Management API 로그까지 따라갈 수 있다(ui-design.md §7). */}
							<Field label="Trace ID"><Mono>{detail.traceId}</Mono></Field>
						</>
					)}
			</DetailDrawer>
		</>
	);
}
