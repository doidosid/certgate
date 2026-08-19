import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useDevice } from "../features/device/queries";
import {
	certificateStatusColor,
	certificateStatusLabel,
	deviceStatusColor,
	deviceStatusLabel,
} from "../features/device/labels";
import DateTimeText from "../shared/ui/DateTimeText";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack direction="row" spacing={2} sx={{ py: 0.5 }}>
			<Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
				{label}
			</Typography>
			<Typography variant="body2" component="div">
				{children}
			</Typography>
		</Stack>
	);
}

/**
 * ui-design.md §4 상세: 기본 정보, 인증서, 적용 정책, 최근 보안 이벤트.
 *
 * 인증서는 Serial·상태·만료일만 보여준다. Certificate 전체 원문과 Private Key는
 * 화면에도 남기지 않는다(security-design.md).
 */
export default function DeviceDetailPage() {
	const { deviceId = "" } = useParams();
	const device = useDevice(deviceId);

	return (
		<>
			<PageHeader title="Device 상세" />
			<QueryState
				isLoading={device.isPending}
				isError={device.isError}
				error={device.error}
				isEmpty={false}
				onRetry={() => device.refetch()}
			>
				{device.data && (
					<Grid container spacing={2}>
						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										기본 정보
									</Typography>
									<Field label="이름">{device.data.name}</Field>
									<Field label="Device Key">{device.data.deviceKey}</Field>
									<Field label="Role">{device.data.roleName}</Field>
									<Field label="상태">
										<StatusChip
											label={deviceStatusLabel(device.data.status)}
											color={deviceStatusColor(device.data.status)}
										/>
									</Field>
									<Field label="등록일">
										<DateTimeText value={device.data.createdAt} />
									</Field>
									<Field label="마지막 접속">
										<DateTimeText value={device.data.lastSeenAt} />
									</Field>
								</CardContent>
							</Card>
						</Grid>

						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										인증서
									</Typography>
									{device.data.certificate ? (
										<>
											<Field label="Serial">{device.data.certificate.serialNumber}</Field>
											<Field label="상태">
												<StatusChip
													label={certificateStatusLabel(device.data.certificate.status)}
													color={certificateStatusColor(device.data.certificate.status)}
												/>
											</Field>
											<Field label="만료일">
												<DateTimeText value={device.data.certificate.expiresAt} />
											</Field>
										</>
									) : (
										<Typography color="text.secondary">발급된 인증서가 없습니다.</Typography>
									)}
								</CardContent>
							</Card>
						</Grid>

						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										적용 정책
									</Typography>
									{device.data.policyRules.length === 0 ? (
										<Typography color="text.secondary">허용 규칙이 없어 모든 요청이 차단됩니다.</Typography>
									) : (
										device.data.policyRules.map((rule) => (
											<Field key={`${rule.httpMethod} ${rule.pathPattern}`} label={rule.httpMethod}>
												{rule.pathPattern} · {rule.effect} · 우선순위 {rule.priority}
											</Field>
										))
									)}
								</CardContent>
							</Card>
						</Grid>

						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										최근 보안 이벤트
									</Typography>
									{device.data.recentEvents.length === 0 ? (
										<Typography color="text.secondary">최근 이벤트가 없습니다.</Typography>
									) : (
										device.data.recentEvents.map((event) => (
											<Field key={event.id} label={event.severity}>
												<DateTimeText value={event.occurredAt} /> · {event.httpMethod ?? "—"}{" "}
												{event.requestPath ?? ""} · {event.reasonCode}
											</Field>
										))
									)}
								</CardContent>
							</Card>
						</Grid>
					</Grid>
				)}
			</QueryState>
		</>
	);
}
