import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Mono from "../../shared/ui/Mono";
import type { DashboardSummary } from "../../shared/api/types";

interface Props {
	summary: DashboardSummary;
}

interface CardSpec {
	label: string;
	value: string;
	tone?: "default" | "warning" | "error";
}

/** ui-design.md §3 "상단 요약 카드: 활성 디바이스, 유효 인증서, 승인 대기 CSR, Critical Event". */
export default function SummaryCards({ summary }: Props) {
	const cards: CardSpec[] = [
		{ label: "활성 디바이스", value: `${summary.devices.active} / ${summary.devices.total}` },
		{
			label: "유효 인증서",
			value: `${summary.certificates.valid}`,
			tone: summary.certificates.expiringSoon > 0 ? "warning" : "default",
		},
		{
			label: "승인 대기 CSR",
			value: `${summary.pendingCertificateRequests}`,
			tone: summary.pendingCertificateRequests > 0 ? "warning" : "default",
		},
		{
			label: "Critical Event (24h)",
			value: `${summary.criticalEvents24h}`,
			tone: summary.criticalEvents24h > 0 ? "error" : "default",
		},
	];

	return (
		<Grid container spacing={2.5}>
			{cards.map((card) => (
				<Grid key={card.label} size={{ xs: 12, sm: 6, md: 3 }}>
					<Paper sx={{ p: 2.5 }}>
						<Typography variant="subtitle1" gutterBottom>
							{card.label}
						</Typography>
						<Typography
							variant="h4"
							component="p"
							color={card.tone && card.tone !== "default" ? card.tone : "textPrimary"}
						>
							<Mono tabular>{card.value}</Mono>
						</Typography>
						{card.label === "유효 인증서" && summary.certificates.expiringSoon > 0 && (
							<Typography variant="body2" color="warning">
								만료 임박 {summary.certificates.expiringSoon}건
							</Typography>
						)}
					</Paper>
				</Grid>
			))}
		</Grid>
	);
}
