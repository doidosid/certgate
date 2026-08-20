import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Mono from "../../shared/ui/Mono";
import type { DashboardSummary } from "../../shared/api/types";

interface Props {
	buckets: DashboardSummary["requestBuckets"];
}

function hourLabel(startedAt: string): string {
	const date = new Date(startedAt);
	if (Number.isNaN(date.getTime())) {
		return "—";
	}
	return `${String(date.getHours()).padStart(2, "0")}:00`;
}

/**
 * ui-design.md §3 "최근 24시간 요청 허용·차단 추이". 차트 라이브러리를 새로 넣지
 * 않는다(계획 문서, Task 13) — `requestBuckets`는 시간별 두 계열뿐이라 `LinearProgress`
 * 두 줄로 충분히 표현되고, 막대 하나 그리자고 의존성을 늘릴 이유가 없다.
 *
 * 막대 길이는 전체 버킷 중 최댓값 기준으로 정규화한다. 각 시간을 그 시간의 총량으로
 * 정규화하면 트래픽이 거의 없던 시간의 작은 차단 1건이 절반을 채운 막대로 보여
 * 실제 규모를 왜곡한다.
 */
export default function RequestTrend({ buckets }: Props) {
	if (buckets.length === 0) {
		return (
			<Typography color="textSecondary" variant="body2">
				최근 24시간 동안 처리된 요청이 없습니다.
			</Typography>
		);
	}

	const max = Math.max(1, ...buckets.map((bucket) => bucket.allowed + bucket.denied));

	return (
		<Stack spacing={1.25}>
			{buckets.map((bucket) => (
				<Box key={bucket.startedAt} sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
					<Box sx={{ width: 48, flexShrink: 0 }}>
						<Mono>{hourLabel(bucket.startedAt)}</Mono>
					</Box>
					<Box sx={{ flexGrow: 1 }}>
						<LinearProgress
							variant="determinate"
							color="success"
							value={(bucket.allowed / max) * 100}
							sx={{ height: 6, borderRadius: 3, mb: 0.5 }}
						/>
						<LinearProgress
							variant="determinate"
							color="error"
							value={(bucket.denied / max) * 100}
							sx={{ height: 6, borderRadius: 3 }}
						/>
					</Box>
					<Box sx={{ width: 96, flexShrink: 0, textAlign: "right" }}>
						<Typography variant="body2" color="success" component="span">
							<Mono tabular>{bucket.allowed}</Mono>
						</Typography>
						{" / "}
						<Typography variant="body2" color="error" component="span">
							<Mono tabular>{bucket.denied}</Mono>
						</Typography>
					</Box>
				</Box>
			))}
		</Stack>
	);
}
