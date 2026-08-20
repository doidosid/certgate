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
import { certificateStatusColor, certificateStatusLabel } from "../features/device/labels";
import RevokeDialog from "../features/certificate/RevokeDialog";
import {
	useCertificate,
	useCertificates,
	useDownloadPem,
	useRevokeCertificate,
} from "../features/certificate/queries";
import type { CertificateItem, CertificateStatus } from "../shared/api/types";
import { localDateTimeToInstant } from "../shared/api/localDateTime";
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
 * ui-design.md §6 목록: Serial Number, 디바이스, 상태, 발급일, 만료일, 발급 CA.
 *
 * "발급 CA"는 만들지 않는다 — 서버 응답(CertificateResponse)에 없는 값이다. 이 MVP에서
 * 발급자는 항상 하나의 Intermediate CA이므로(ADR-002) 화면에 지어내 넣을 이유도 없다.
 */
const COLUMNS: Column<CertificateItem>[] = [
	{ key: "serialNumber", header: "Serial", render: (row) => <Mono>{row.serialNumber}</Mono> },
	{ key: "deviceId", header: "디바이스", render: (row) => <DeviceNameLink deviceId={row.deviceId} /> },
	{
		key: "status",
		header: "상태",
		render: (row) => (
			<StatusChip label={certificateStatusLabel(row.status)} color={certificateStatusColor(row.status)} />
		),
	},
	{ key: "issuedAt", header: "발급일", render: (row) => <DateTimeText value={row.issuedAt} /> },
	{ key: "notAfter", header: "만료일", render: (row) => <DateTimeText value={row.notAfter} /> },
];

export default function CertificatesPage() {
	const { page, size, setPage, setSize, setParam, get } = usePageParams();
	const status = get("status") ?? "";
	const deviceId = get("deviceId") ?? "";
	const expiresBefore = get("expiresBefore") ?? "";

	const [selectedId, setSelectedId] = useState("");
	const [revokeOpen, setRevokeOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [note, setNote] = useState("");
	/**
	 * 서버가 폐기를 확정해 준 사실. 상세를 다시 읽는 동안, 또는 낡은 값이 오거나 재조회가
	 * 실패하는 동안 status만 보면 폐기 버튼이 되살아난다 — 되돌릴 수 없는 동작을 다시
	 * 누를 수 있게 되는 것이다(Task 9에서 같은 결함을 고쳤다).
	 */
	const [revoked, setRevoked] = useState<CertificateStatus | null>(null);

	const expiresBeforeInstant = localDateTimeToInstant(expiresBefore);
	const expiresBeforeInvalid = expiresBefore !== "" && expiresBeforeInstant === undefined;

	const certificates = useCertificates({
		status: status || undefined,
		deviceId: deviceId || undefined,
		expiresBefore: expiresBeforeInstant,
		page,
		size,
	});
	const detail = useCertificate(selectedId);
	const revoke = useRevokeCertificate();
	const download = useDownloadPem();

	function openCertificate(certificate: CertificateItem) {
		setSelectedId(certificate.id);
		setRevoked(null);
		revoke.reset();
		download.reset();
	}

	function closeDrawer() {
		setSelectedId("");
		setRevoked(null);
		revoke.reset();
		download.reset();
	}

	function openRevoke() {
		setReason("");
		setNote("");
		revoke.reset();
		setRevokeOpen(true);
	}

	function confirmRevoke() {
		revoke.mutate(
			{ certificateId: selectedId, reason, note },
			{
				onSuccess: (updated) => {
					// Drawer는 열어 둔다 — 폐기 시각·사유가 채워지는 것을 같은 자리에서 확인한다.
					setRevoked(updated.status);
					setRevokeOpen(false);
				},
			},
		);
	}

	// 서버가 확정해 준 상태가 있으면 그것을 보여준다. 재조회가 따라오면 같은 값으로 수렴한다.
	const shownStatus = revoked ?? detail.data?.status;
	const canRevoke = shownStatus !== undefined && shownStatus !== "REVOKED";

	return (
		<>
			<PageHeader title="Certificates" />

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
					<MenuItem value="VALID">유효</MenuItem>
					<MenuItem value="EXPIRING_SOON">만료 임박</MenuItem>
					<MenuItem value="EXPIRED">만료</MenuItem>
					<MenuItem value="REVOKED">폐기</MenuItem>
				</TextField>
				<DeviceSelect value={deviceId} onChange={(next) => setParam("deviceId", next)} />
				{/* 만료 기간 필터 — 이 시각보다 먼저 만료되는 인증서만 본다(api-spec.md §5). */}
				<TextField
					label="만료 기한"
					type="datetime-local"
					size="small"
					sx={{ width: 205 }}
					value={expiresBefore}
					slotProps={{ inputLabel: { shrink: true } }}
					onChange={(event) => setParam("expiresBefore", event.target.value)}
					error={expiresBeforeInvalid}
					helperText={expiresBeforeInvalid ? "시각으로 읽을 수 없어 조건에서 제외됩니다." : undefined}
				/>
			</Paper>

			<QueryState
				isLoading={certificates.isPending}
				isError={certificates.isError}
				error={certificates.error}
				isEmpty={certificates.data?.totalElements === 0}
				emptyMessage="조건에 맞는 인증서가 없습니다."
				onRetry={() => certificates.refetch()}
			>
				<DataTable
					columns={COLUMNS}
					rows={certificates.data?.content ?? []}
					getRowId={(row) => row.id}
					page={page}
					size={size}
					totalElements={certificates.data?.totalElements ?? 0}
					onPageChange={setPage}
					onSizeChange={setSize}
					onRowClick={openCertificate}
				/>
			</QueryState>

			<DetailDrawer open={selectedId !== ""} title="인증서 상세" onClose={closeDrawer} width={480}>
				<QueryState
					isLoading={detail.isPending}
					isError={detail.isError}
					error={detail.error}
					isEmpty={false}
					onRetry={() => detail.refetch()}
				>
					{detail.data && (
						<>
							<Field label="Serial">
								<Mono breakAll>{detail.data.serialNumber}</Mono>
							</Field>
							<Field label="디바이스">
								<DeviceNameLink deviceId={detail.data.deviceId} />
							</Field>
							<Field label="상태">
								<StatusChip
									label={certificateStatusLabel(shownStatus ?? detail.data.status)}
									color={certificateStatusColor(shownStatus ?? detail.data.status)}
								/>
							</Field>
							<Field label="유효기간">
								<DateTimeText value={detail.data.notBefore} /> ~ <DateTimeText value={detail.data.notAfter} />
							</Field>
							<Field label="발급일">
								<DateTimeText value={detail.data.issuedAt} />
							</Field>
							<Field label="폐기 시각">
								<DateTimeText value={detail.data.revokedAt} />
							</Field>
							{detail.data.revocationReason && (
								<Field label="폐기 사유">{detail.data.revocationReason}</Field>
							)}
							{detail.data.revocationNote && <Field label="폐기 메모">{detail.data.revocationNote}</Field>}

							{/*
							 * Subject·SAN URI·SHA-256 지문은 ui-design.md §6이 상세에 요구하지만
							 * Certificate 응답에 없다. 그 값들은 CSR에 있고 Certificate Requests
							 * 화면이 보여준다. 인증서에서 읽지 않은 값을 인증서 정보처럼 표시하지
							 * 않는다 — 추론한 값을 사실로 보이게 만드는 것이 이 도메인에서 가장
							 * 위험하다.
							 */}

							{revoked && (
								<Alert severity="success" sx={{ mt: 2 }}>
									인증서를 폐기했습니다. Gateway 반영에 최대 30초가 걸립니다.
								</Alert>
							)}
							{download.isError && (
								<Alert severity="error" sx={{ mt: 2 }}>
									인증서를 내려받지 못했습니다.
								</Alert>
							)}

							<Box sx={{ mt: 3 }}>
								<Stack direction="row" spacing={1}>
									<Button
										variant="outlined"
										disabled={download.isPending}
										onClick={() =>
											download.mutate({
												certificateId: detail.data.id,
												serialNumber: detail.data.serialNumber,
											})
										}
									>
										공개 인증서 다운로드
									</Button>
									{/* 이미 폐기된 인증서에는 폐기 버튼을 두지 않는다 — 서버도 409로 거절한다. */}
									{canRevoke && (
										<Button
											variant="contained"
											color="error"
											disabled={revoke.isPending}
											onClick={openRevoke}
										>
											폐기
										</Button>
									)}
								</Stack>
							</Box>
						</>
					)}
				</QueryState>
			</DetailDrawer>

			<RevokeDialog
				open={revokeOpen}
				serialNumber={detail.data?.serialNumber ?? ""}
				reason={reason}
				note={note}
				isPending={revoke.isPending}
				error={revoke.error}
				onReasonChange={setReason}
				onNoteChange={setNote}
				onConfirm={confirmRevoke}
				onClose={() => setRevokeOpen(false)}
			/>
		</>
	);
}
