import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DeviceNameLink from "../features/device/DeviceNameLink";
import { fetchSecurityEvents } from "../features/securityEvent/api";
import DateTimeText from "../shared/ui/DateTimeText";
import { securityEventStreamUrl } from "../shared/api/env";
import type { CriticalEventPayload, SecurityEvent } from "../shared/api/types";

/**
 * 화면에 떠 있는 알림 하나. SSE로 받은 것과 재연결 보완 조회로 받은 것이 섞이는데
 * 두 응답의 모양이 다르다 — SSE(`CriticalEventPayload`)에는 사용자용 message와
 * deviceKey가 있고, 목록 조회(`SecurityEvent`)에는 deviceId만 있다. 서버의 한국어
 * message 표를 Console에 복제하면 두 곳이 조용히 어긋나므로, 보완 조회 항목은
 * 화면 다른 곳(Security Events 목록·Dashboard 패널)과 같이 reasonCode를 그대로
 * 보여준다.
 */
interface CriticalToast {
	eventId: string;
	occurredAt: string;
	reasonCode: string;
	/** SSE로 받은 항목에만 있다. */
	message: string | null;
	/** SSE로 받은 항목에만 있다. */
	deviceKey: string | null;
	/** 보완 조회로 받은 항목에만 있다. */
	deviceId: string | null;
}

/**
 * 화면에 동시에 띄우는 최대 개수이자 재연결 한 번에 조회하는 개수. 놓친 구간이
 * 길더라도 Toast로 화면을 덮지 않는다 — 원본은 Security Events 목록에 그대로 남아
 * 있다(api-spec.md §9 "Security Event가 원본 데이터"). 넘치면 오래된 것부터 내린다.
 */
const MAX_TOASTS = 5;

function toToast(event: SecurityEvent): CriticalToast {
	return {
		eventId: event.id,
		occurredAt: event.occurredAt,
		reasonCode: event.reasonCode,
		message: null,
		deviceKey: null,
		deviceId: event.deviceId,
	};
}

function isPayload(value: unknown): value is CriticalEventPayload {
	const candidate = value as Partial<CriticalEventPayload> | null;
	return (
		typeof candidate === "object" &&
		candidate !== null &&
		typeof candidate.eventId === "string" &&
		typeof candidate.occurredAt === "string" &&
		typeof candidate.reasonCode === "string"
	);
}

/** deviceKey는 SSE에만, deviceId는 보완 조회에만 온다. 둘 다 없으면 Device와 무관한 Event다. */
function ToastDevice({ toast }: { toast: CriticalToast }) {
	if (toast.deviceKey !== null) {
		return <>{toast.deviceKey}</>;
	}
	if (toast.deviceId !== null) {
		return <DeviceNameLink deviceId={toast.deviceId} linkless />;
	}
	return <>—</>;
}

/**
 * CRITICAL Security Event를 화면 오른쪽 위 Toast로 띄운다(ui-design.md §8).
 *
 * 자동으로 사라지지 않는다 — 사용자가 닫아야 한다. 닫아도 서버에는 아무것도 보내지
 * 않는다. Toast는 화면 상태일 뿐이고 원본 Event는 Security Events 목록에 남는다.
 *
 * 연결이 끊긴 동안의 Event는 브라우저가 자동 재연결한 뒤(`onopen`이 두 번째로 불릴 때)
 * 마지막으로 본 시각 이후의 CRITICAL을 다시 조회해 채운다. 이미 본 eventId는 걸러내므로
 * 경계에 걸친 Event가 두 번 뜨지 않는다 — SSE의 eventId는 SecurityEvent의 id와 같다
 * (CriticalEventListener가 `event.getId()`를 그대로 싣는다).
 */
export default function CriticalEventProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<CriticalToast[]>([]);
	const seenEventIds = useRef(new Set<string>());
	const lastSeenAt = useRef<string | null>(null);

	useEffect(() => {
		if (lastSeenAt.current === null) {
			// 연결 전의 Event까지 거슬러 올라가지 않는다. 첫 재연결의 보완 조회 시작점이다.
			lastSeenAt.current = new Date().toISOString();
		}

		function add(items: CriticalToast[]) {
			const fresh = items.filter((item) => !seenEventIds.current.has(item.eventId));
			if (fresh.length === 0) {
				return;
			}
			for (const item of fresh) {
				seenEventIds.current.add(item.eventId);
				if (lastSeenAt.current === null || item.occurredAt > lastSeenAt.current) {
					lastSeenAt.current = item.occurredAt;
				}
			}
			setToasts((previous) => [...fresh, ...previous].slice(0, MAX_TOASTS));
		}

		const source = new EventSource(securityEventStreamUrl);
		let connectedBefore = false;

		source.addEventListener("critical-security-event", (event) => {
			let payload: unknown;
			try {
				payload = JSON.parse((event as MessageEvent).data as string);
			} catch {
				// 계약에 없는 본문은 무시한다. 알림 하나를 놓치는 것이 화면을 깨뜨리는 것보다 낫다.
				return;
			}
			if (!isPayload(payload)) {
				return;
			}
			add([{ ...payload, message: payload.message ?? null, deviceId: null }]);
		});

		source.onopen = () => {
			if (!connectedBefore) {
				connectedBefore = true;
				return;
			}
			// 실패해도 lastSeenAt을 앞당기지 않으므로 다음 재연결이 같은 구간을 다시 조회한다.
			void fetchSecurityEvents({
				severity: "CRITICAL",
				from: lastSeenAt.current ?? undefined,
				page: 0,
				size: MAX_TOASTS,
			})
				.then((page) => add(page.content.map(toToast)))
				.catch(() => undefined);
		};

		return () => source.close();
	}, []);

	function dismiss(eventId: string) {
		setToasts((previous) => previous.filter((toast) => toast.eventId !== eventId));
	}

	return (
		<>
			{children}
			<Snackbar open={toasts.length > 0} anchorOrigin={{ vertical: "top", horizontal: "right" }}>
				<Stack spacing={1} sx={{ maxWidth: 420 }}>
					{toasts.map((toast) => (
						<Alert
							key={toast.eventId}
							severity="error"
							variant="filled"
							closeText="닫기"
							onClose={() => dismiss(toast.eventId)}
						>
							{/*
							 * 실제 anchor다 — 새 탭·가운데 클릭이 동작하고, Toast 전체를 클릭 영역으로
							 * 만들었을 때 닫기 버튼과 클릭이 겹치는 문제도 없다. 목록에 이 Event 하나만
							 * 여는 화면이 없어 같은 reasonCode로 필터링한 목록으로 보낸다
							 * (Dashboard의 Critical Event 패널과 같은 판단).
							 */}
							<Link
								component={RouterLink}
								to={`/security-events?reasonCode=${encodeURIComponent(toast.reasonCode)}`}
								color="inherit"
								underline="hover"
								sx={{ fontWeight: 600 }}
								onClick={() => dismiss(toast.eventId)}
							>
								{toast.message ?? toast.reasonCode}
							</Link>
							<Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center" }}>
								<Typography component="span" variant="body2">
									<ToastDevice toast={toast} />
								</Typography>
								<Typography component="span" variant="body2">
									<DateTimeText value={toast.occurredAt} />
								</Typography>
							</Stack>
						</Alert>
					))}
				</Stack>
			</Snackbar>
		</>
	);
}
