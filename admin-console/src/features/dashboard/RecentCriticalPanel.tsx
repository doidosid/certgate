import { Link as RouterLink } from "react-router-dom";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DateTimeText from "../../shared/ui/DateTimeText";
import DeviceNameLink from "../device/DeviceNameLink";
import Mono from "../../shared/ui/Mono";
import type { SecurityEvent } from "../../shared/api/types";

interface Props {
	events: SecurityEvent[];
}

/**
 * ui-design.md §3 "최근 Critical Security Event 패널. 패널 항목 클릭 시 보안 이벤트
 * 상세로 이동".
 *
 * Security Events 화면에는 이 Event 하나만 여는 route가 없다 — 목록 + Drawer뿐이다
 * (Task 8). 그래서 목록 URL에 `eventId`를 실어 그 Event의 Drawer를 연다. 같은
 * reasonCode로 필터링만 하면 그 코드가 여러 건일 때 어느 것이 원인인지 지목하지
 * 못한다(Codex 리뷰 PR #49 Medium).
 *
 * 항목 전체가 링크다(`<a>` 하나). Device 이름은 별도 링크로 만들지 않는다 — `<a>` 안에
 * `<a>`를 중첩하면 무효한 HTML이 되고 클릭 대상이 모호해진다.
 */
export default function RecentCriticalPanel({ events }: Props) {
	if (events.length === 0) {
		return (
			<Typography color="textSecondary" variant="body2">
				최근 Critical Event가 없습니다.
			</Typography>
		);
	}

	return (
		<Stack spacing={1.5}>
			{events.map((event) => (
				<RouterLink
					key={event.id}
					to={`/security-events?eventId=${encodeURIComponent(event.id)}`}
					style={{ color: "inherit", textDecoration: "none" }}
				>
					<Stack
						direction="row"
						sx={{
							alignItems: "center",
							justifyContent: "space-between",
							p: 1,
							borderRadius: 1,
							"&:hover": { backgroundColor: "action.hover" },
						}}
					>
						<Stack>
							<Typography variant="body2" sx={{ fontWeight: 600 }}>
								{event.reasonCode}
							</Typography>
							<Typography variant="body2" color="textSecondary">
								<DeviceNameLink deviceId={event.deviceId} linkless />
							</Typography>
						</Stack>
						<Typography variant="body2" color="textSecondary">
							<Mono tabular>
								<DateTimeText value={event.occurredAt} />
							</Mono>
						</Typography>
					</Stack>
				</RouterLink>
			))}
		</Stack>
	);
}
