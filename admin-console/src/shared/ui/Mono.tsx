import type { ReactNode } from "react";
import Box from "@mui/material/Box";

interface Props {
	children: ReactNode;
	/** 표의 숫자 열처럼 자리를 맞춰야 할 때 켠다. */
	tabular?: boolean;
	/** CSR 지문처럼 끊을 곳이 없는 긴 값을 좁은 폭에서 접을 때 켠다. */
	breakAll?: boolean;
}

/**
 * Serial Number, Trace ID, Reason Code, IP, 숫자 같은 식별자를 등폭으로 읽히게 한다.
 * 지문과 Serial을 눈으로 비교하는 화면이라 실제로 도움이 된다.
 *
 * 화면 문구(라벨·문장)에는 쓰지 않는다 — 등폭 face에 한글 글리프가 없어 한글 face로
 * 떨어지면서 등폭이 아니게 되고 자폭만 어긋난다.
 *
 * 다만 서버 데이터에 한글이 없다고 보장할 수는 없다 — `deviceKey`는 비어 있지 않은지만
 * 검증하고 ASCII 제약이 없으며, Gateway가 기록하는 요청 경로도 한글을 담을 수 있다
 * (Codex 리뷰 PR #46 Low). 그런 값이 오면 글리프는 fallback으로 정상 표시되고 정렬만
 * 어긋난다. 표시가 깨지는 것이 아니라 등폭 이점을 잃는 정도라 그대로 둔다.
 */
export default function Mono({ children, tabular = false, breakAll = false }: Props) {
	return (
		<Box
			component="span"
			sx={{
				// 등폭 스택은 theme의 caption 변형이 이미 들고 있다.
				fontFamily: (theme) => theme.typography.caption.fontFamily,
				fontSize: "0.8125rem",
				fontVariantNumeric: tabular ? "tabular-nums" : undefined,
				wordBreak: breakAll ? "break-all" : undefined,
			}}
		>
			{children}
		</Box>
	);
}
