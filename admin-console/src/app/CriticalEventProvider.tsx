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
 * 화면에 떠 있는 알림 하나. SSE로 받은 것과 보완 조회로 받은 것이 섞이는데 두 응답의
 * 모양이 다르다 — SSE(`CriticalEventPayload`)에는 사용자용 message와 deviceKey가
 * 있고, 목록 조회(`SecurityEvent`)에는 deviceId만 있다. 서버의 한국어 message 표를
 * Console에 복제하면 두 곳이 조용히 어긋나므로, 보완 조회 항목은 화면 다른 곳
 * (Security Events 목록·Dashboard 패널)과 같이 reasonCode를 그대로 보여준다.
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
 * 한 번에 화면에 쌓는 Toast 수. 넘치는 것은 **버리지 않고** 큐에 남았다가 위의 것을
 * 닫으면 차례로 올라온다 — 사용자가 닫지 않은 CRITICAL 알림을 조용히 없애면
 * ui-design.md §8("사용자가 직접 닫는다")을 어긴다(Codex 리뷰 PR #49 Medium).
 */
const MAX_VISIBLE_TOASTS = 5;

/** 보완 조회 한 페이지 크기. 서버 상한은 100이다(SecurityEventQueryController). */
const BACKFILL_PAGE_SIZE = 50;

/**
 * 보완 조회가 훑는 최대 페이지 수. 단절이 이보다 길면 나머지는 Toast로 밀어내지 않고
 * "Security Events에서 확인" 안내로 넘긴다 — 원본은 목록에 그대로 있다
 * (api-spec.md §9 "Security Event가 원본 데이터"). 조용히 자르지는 않는다.
 */
const BACKFILL_MAX_PAGES = 4;

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

/**
 * 화면에 그리는 값의 Type까지 확인한다. `eventId`만 보고 통과시키면 `message`에 객체가
 * 담긴 응답이 그대로 JSX child가 되어 Provider가 감싼 **화면 전체**가 내려간다.
 * `shared/api/client.ts`의 `isErrorResponse`가 같은 이유로 모든 렌더 필드를 검사한다
 * (Codex 리뷰 PR #49 Medium).
 */
function isPayload(value: unknown): value is CriticalEventPayload {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.eventId === "string" &&
		candidate.eventId !== "" &&
		typeof candidate.occurredAt === "string" &&
		!Number.isNaN(new Date(candidate.occurredAt).getTime()) &&
		typeof candidate.reasonCode === "string" &&
		typeof candidate.message === "string" &&
		(candidate.deviceKey === null || typeof candidate.deviceKey === "string")
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
 * **보완 조회의 커서는 서버가 준 `occurredAt`만 쓴다.** 브라우저 시계로 커서를 만들면
 * 서버보다 앞선 기기에서 gap query가 미래에서 시작해 단절 구간을 통째로 건너뛴다
 * (Codex 리뷰 PR #49 High). 그래서 마운트 시점에 서버에서 최신 CRITICAL 한 페이지를
 * 읽어 커서를 세운다. 이때 읽은 것은 **페이지를 열기 전의 기록**이라 Toast로 띄우지
 * 않고 커서와 중복 방지 Set에만 넣는다.
 *
 * **보완 조회는 첫 연결에서도 한다.** 마운트와 서버의 emitter 등록 사이에 생긴 Event는
 * SSE로 오지 않으므로 이 조회가 유일한 전달 경로다. 경계에 걸린 Event가 두 번 뜨지
 * 않는 것은 `eventId` Set이 보장한다 — SSE의 `eventId`는 `SecurityEvent`의 id와 같다
 * (`CriticalEventListener`가 `event.getId()`를 그대로 싣는다).
 */
export default function CriticalEventProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<CriticalToast[]>([]);
	const [hasOlderUnseen, setHasOlderUnseen] = useState(false);
	const seenEventIds = useRef(new Set<string>());
	/** 서버가 준 시각만 들어간다. null이면 아직 기준을 모른다는 뜻이다. */
	const cursor = useRef<string | null>(null);

	useEffect(() => {
		function markSeen(items: CriticalToast[]): CriticalToast[] {
			const fresh = items.filter((item) => !seenEventIds.current.has(item.eventId));
			for (const item of fresh) {
				seenEventIds.current.add(item.eventId);
			}
			return fresh;
		}

		function advanceCursor(items: CriticalToast[]) {
			for (const item of items) {
				if (cursor.current === null || item.occurredAt > cursor.current) {
					cursor.current = item.occurredAt;
				}
			}
		}

		function pushToasts(items: CriticalToast[]) {
			if (items.length > 0) {
				setToasts((previous) => [...items, ...previous]);
			}
		}

		/**
		 * 커서 이후의 CRITICAL을 전부 훑는다. 페이지를 다 돌기 전에 실패하면 커서를
		 * 옮기지 않아서 다음 연결이 같은 구간을 다시 조회한다. 이미 띄운 것은 Set이
		 * 걸러내므로 중복되지 않는다.
		 */
		async function backfill() {
			const from = cursor.current ?? undefined;
			const collected: CriticalToast[] = [];
			for (let page = 0; page < BACKFILL_MAX_PAGES; page += 1) {
				const result = await fetchSecurityEvents({
					severity: "CRITICAL",
					from,
					page,
					size: BACKFILL_PAGE_SIZE,
				});
				collected.push(...result.content.map(toToast));
				if (result.content.length < BACKFILL_PAGE_SIZE) {
					pushToasts(markSeen(collected));
					advanceCursor(collected);
					return;
				}
			}
			// 상한에 걸렸다. 가져온 만큼은 띄우고 더 있다는 사실을 화면에 남긴다.
			pushToasts(markSeen(collected));
			advanceCursor(collected);
			setHasOlderUnseen(true);
		}

		const source = new EventSource(securityEventStreamUrl);

		/**
		 * 커서를 세우는 최초 조회와 이후 보완 조회를 한 줄로 이어 붙인다. 첫 `onopen`이
		 * 최초 조회보다 먼저 와도 순서가 뒤집히지 않는다.
		 */
		let pending: Promise<unknown> = fetchSecurityEvents({
			severity: "CRITICAL",
			page: 0,
			size: BACKFILL_PAGE_SIZE,
		})
			.then((result) => {
				const before = result.content.map(toToast);
				markSeen(before);
				advanceCursor(before);
			})
			.catch(() => undefined);

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
			const toast: CriticalToast = { ...payload, deviceId: null };
			pushToasts(markSeen([toast]));
			advanceCursor([toast]);
		});

		source.onopen = () => {
			pending = pending.then(backfill).catch(() => undefined);
		};

		return () => source.close();
	}, []);

	function dismiss(eventId: string) {
		setToasts((previous) => previous.filter((toast) => toast.eventId !== eventId));
	}

	const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);
	const queued = toasts.length - visible.length;

	return (
		<>
			{children}
			<Snackbar open={toasts.length > 0} anchorOrigin={{ vertical: "top", horizontal: "right" }}>
				<Stack spacing={1} sx={{ maxWidth: 420 }}>
					{visible.map((toast) => (
						<Alert
							key={toast.eventId}
							severity="error"
							variant="filled"
							closeText="닫기"
							onClose={() => dismiss(toast.eventId)}
						>
							{/*
							 * 실제 anchor다 — 새 탭·가운데 클릭이 동작하고, Toast 전체를 클릭 영역으로
							 * 만들었을 때 닫기 버튼과 클릭이 겹치는 문제도 없다. 원인이 된 Event 하나를
							 * 지목해 상세를 연다(ui-design.md §8) — 같은 reasonCode 목록으로만 보내면
							 * 그 코드가 여러 건일 때 어느 것이 원인인지 알 수 없다(Codex 리뷰 PR #49 Medium).
							 */}
							<Link
								component={RouterLink}
								to={`/security-events?eventId=${encodeURIComponent(toast.eventId)}`}
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

					{(queued > 0 || hasOlderUnseen) && (
						<Alert severity="error" variant="outlined" sx={{ backgroundColor: "background.paper" }}>
							<Link component={RouterLink} to="/security-events?severity=CRITICAL" underline="hover">
								{queued > 0
									? `확인하지 않은 CRITICAL 알림 ${queued}건 더 — 위 알림을 닫으면 이어서 표시됩니다`
									: "표시하지 못한 CRITICAL 알림이 더 있습니다 — Security Events에서 확인"}
							</Link>
						</Alert>
					)}
				</Stack>
			</Snackbar>
		</>
	);
}
