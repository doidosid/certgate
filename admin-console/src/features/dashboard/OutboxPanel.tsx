import Typography from "@mui/material/Typography";
import Mono from "../../shared/ui/Mono";
import type { DashboardSummary } from "../../shared/api/types";

interface Props {
	outbox: DashboardSummary["outbox"];
}

/**
 * ui-design.md §3 "Gateway SQLite Outbox 대기 건수와 가장 오래된 미전송 시간".
 *
 * 임계값은 security-design.md §9의 CRITICAL 조건(대기 100건 이상, Gateway
 * `DefaultDelayThresholdSeconds` 60초)과 같은 값이다 — 여기서 강조로 쓰는 기준이
 * CRITICAL Event를 만드는 기준과 다르면 화면과 실제 판정이 어긋난 것처럼 보인다.
 */
const CRITICAL_BACKLOG = 100;
const CRITICAL_DELAY_SECONDS = 60;

export default function OutboxPanel({ outbox }: Props) {
	if (outbox === null) {
		// Gateway를 조회하지 못해도 Dashboard 나머지는 정상 표시된다(DashboardSummary 계약).
		// 값을 0으로 지어내지 않고 조회 실패 자체를 알린다.
		return <Typography color="textSecondary">Gateway Outbox 상태를 확인할 수 없습니다.</Typography>;
	}

	const critical = outbox.pendingCount >= CRITICAL_BACKLOG || outbox.oldestAgeSeconds >= CRITICAL_DELAY_SECONDS;

	return (
		<Typography color={critical ? "error" : "textPrimary"}>
			대기 <Mono tabular>{outbox.pendingCount}</Mono>건 · 최고 지연{" "}
			<Mono tabular>{outbox.oldestAgeSeconds}</Mono>초
		</Typography>
	);
}
