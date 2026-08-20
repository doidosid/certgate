import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Mono from "../../shared/ui/Mono";
import StatusChip from "../../shared/ui/StatusChip";
import type { DashboardSummary } from "../../shared/api/types";

interface Props {
	services: DashboardSummary["services"];
}

/** ui-design.md §3 "Gateway, Management API, PostgreSQL 상태". */
export default function ServiceHealth({ services }: Props) {
	return (
		<Stack spacing={1.5}>
			{services.map((service) => (
				<Stack key={service.name} direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
					<Typography variant="body2">{service.name}</Typography>
					<Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
						{/* 조회 실패 시(latencyMs null) 0ms처럼 보이게 두지 않는다. */}
						<Typography variant="body2" color="textSecondary">
							<Mono tabular>{service.latencyMs === null ? "—" : `${service.latencyMs}ms`}</Mono>
						</Typography>
						<StatusChip
							label={service.status === "UP" ? "정상" : "장애"}
							color={service.status === "UP" ? "success" : "error"}
						/>
					</Stack>
				</Stack>
			))}
		</Stack>
	);
}
