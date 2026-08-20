import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import DeviceNameLink from "../features/device/DeviceNameLink";
import DeviceSelect from "../features/device/DeviceSelect";
import DecisionDialog from "../features/certificateRequest/DecisionDialog";
import { requestStatusColor, requestStatusLabel } from "../features/certificateRequest/labels";
import {
	useCertificateRequest,
	useCertificateRequests,
	useDecideRequest,
} from "../features/certificateRequest/queries";
import type { DecisionAction } from "../features/certificateRequest/api";
import type { CertificateRequestItem } from "../shared/api/types";
import { usePageParams } from "../shared/api/usePageParams";
import DataTable, { type Column } from "../shared/ui/DataTable";
import DateTimeText from "../shared/ui/DateTimeText";
import DetailDrawer from "../shared/ui/DetailDrawer";
import Field from "../shared/ui/Field";
import Mono from "../shared/ui/Mono";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

/**
 * ui-design.md §5는 목록에 SAN URI·키 알고리즘까지 요구하지만, 목록 응답
 * (CertificateRequestResponse)에는 id·deviceId·status·requestedAt만 있다. 목록을
 * 채우려면 행마다 상세를 한 번씩 더 불러야 하므로, 그 두 항목은 상세 Drawer에서
 * 보여준다. 계약을 바꾸는 대신 화면 구성을 맞춘 것이다.
 */
const COLUMNS: Column<CertificateRequestItem>[] = [
	{ key: "id", header: "요청 ID", render: (row) => <Mono>{row.id}</Mono> },
	{ key: "deviceId", header: "디바이스", render: (row) => <DeviceNameLink deviceId={row.deviceId} /> },
	{ key: "requestedAt", header: "요청일", render: (row) => <DateTimeText value={row.requestedAt} /> },
	{
		key: "status",
		header: "상태",
		render: (row) => (
			<StatusChip label={requestStatusLabel(row.status)} color={requestStatusColor(row.status)} />
		),
	},
];

export default function CertificateRequestsPage() {
	const { page, size, setPage, setSize, setParam, get } = usePageParams();
	const status = get("status") ?? "";
	const deviceId = get("deviceId") ?? "";

	const [selectedId, setSelectedId] = useState("");
	const [action, setAction] = useState<DecisionAction | null>(null);
	const [decisionNote, setDecisionNote] = useState("");
	const [decided, setDecided] = useState<DecisionAction | null>(null);

	const requests = useCertificateRequests({
		status: status || undefined,
		deviceId: deviceId || undefined,
		page,
		size,
	});
	const detail = useCertificateRequest(selectedId);
	const decide = useDecideRequest();

	function openRequest(request: CertificateRequestItem) {
		setSelectedId(request.id);
		// 이전 건의 결과 문구를 다음 건에 끌고 오지 않는다.
		setDecided(null);
		decide.reset();
	}

	function closeDrawer() {
		setSelectedId("");
		setDecided(null);
		decide.reset();
	}

	function openDialog(next: DecisionAction) {
		setAction(next);
		setDecisionNote("");
		decide.reset();
	}

	function confirmDecision() {
		if (action === null) {
			return;
		}
		decide.mutate(
			{ requestId: selectedId, action, decisionNote },
			{
				onSuccess: () => {
					// Drawer는 열어 둔다 — 결정 결과와 바뀐 상태를 같은 자리에서 확인한다.
					setDecided(action);
					setAction(null);
				},
			},
		);
	}

	const isPending = detail.data?.status === "PENDING";

	return (
		<>
			<PageHeader title="Certificate Requests" />

			<Paper sx={{ p: 2, mb: 2.5, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}>
				<TextField
					select
					label="상태"
					size="small"
					sx={{ width: 160 }}
					value={status}
					onChange={(event) => setParam("status", event.target.value)}
				>
					<MenuItem value="">전체</MenuItem>
					<MenuItem value="PENDING">승인 대기</MenuItem>
					<MenuItem value="APPROVED">발급 완료</MenuItem>
					<MenuItem value="REJECTED">거절</MenuItem>
				</TextField>
				<DeviceSelect value={deviceId} onChange={(next) => setParam("deviceId", next)} />
			</Paper>

			<QueryState
				isLoading={requests.isPending}
				isError={requests.isError}
				error={requests.error}
				isEmpty={requests.data?.totalElements === 0}
				emptyMessage="조건에 맞는 인증서 요청이 없습니다."
				onRetry={() => requests.refetch()}
			>
				<DataTable
					columns={COLUMNS}
					rows={requests.data?.content ?? []}
					getRowId={(row) => row.id}
					page={page}
					size={size}
					totalElements={requests.data?.totalElements ?? 0}
					onPageChange={setPage}
					onSizeChange={setSize}
					onRowClick={openRequest}
				/>
			</QueryState>

			<DetailDrawer
				open={selectedId !== ""}
				title="인증서 요청 상세"
				onClose={closeDrawer}
				width={480}
			>
				<QueryState
					isLoading={detail.isPending}
					isError={detail.isError}
					error={detail.error}
					isEmpty={false}
					onRetry={() => detail.refetch()}
				>
					{detail.data && (
						<>
							<Field label="요청 ID">
								<Mono breakAll>{detail.data.id}</Mono>
							</Field>
							<Field label="디바이스">
								<DeviceNameLink deviceId={detail.data.deviceId} />
							</Field>
							<Field label="상태">
								<StatusChip
									label={requestStatusLabel(detail.data.status)}
									color={requestStatusColor(detail.data.status)}
								/>
							</Field>
							<Field label="Subject">
								<Mono breakAll>{detail.data.subjectDn}</Mono>
							</Field>
							{/*
							 * SAN URI가 등록된 Device Key와 일치하는지가 승인 판단의 핵심이다
							 * (ui-design.md §5, security-design.md). 서버도 검증하지만 관리자가
							 * 눈으로 확인할 수 있어야 한다.
							 */}
							<Field label="SAN URI">
								<Mono breakAll>{detail.data.sanUri ?? "—"}</Mono>
							</Field>
							<Field label="공개키">
								<Mono>{detail.data.publicKeyAlgorithm}</Mono>
							</Field>
							<Field label="CSR 지문">
								<Mono breakAll>{detail.data.fingerprintSha256}</Mono>
							</Field>
							<Field label="요청일">
								<DateTimeText value={detail.data.requestedAt} />
							</Field>
							<Field label="결정일">
								<DateTimeText value={detail.data.decidedAt} />
							</Field>
							{detail.data.decisionNote && <Field label="결정 메모">{detail.data.decisionNote}</Field>}

							{decided && (
								<Alert severity="success" sx={{ mt: 2 }}>
									{decided === "approve"
										? "인증서 요청을 승인했습니다."
										: "인증서 요청을 거절했습니다."}
								</Alert>
							)}

							{/*
							 * PENDING이 아니면 결정 버튼을 아예 렌더링하지 않는다. 눌러도 서버가
							 * 409로 거절하는 버튼을 남겨 두지 않는다(Issue #7 완료 기준).
							 */}
							{isPending && (
								<Box sx={{ mt: 3 }}>
									<Stack direction="row" spacing={1}>
										<Button
											variant="contained"
											onClick={() => openDialog("approve")}
											disabled={decide.isPending}
										>
											승인
										</Button>
										<Button
											variant="outlined"
											color="error"
											onClick={() => openDialog("reject")}
											disabled={decide.isPending}
										>
											거절
										</Button>
									</Stack>
								</Box>
							)}
						</>
					)}
				</QueryState>
			</DetailDrawer>

			<DecisionDialog
				open={action !== null}
				action={action ?? "approve"}
				decisionNote={decisionNote}
				isPending={decide.isPending}
				error={decide.error}
				onNoteChange={setDecisionNote}
				onConfirm={confirmDecision}
				onClose={() => setAction(null)}
			/>
		</>
	);
}
