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
 * Serial Number, Trace ID, Reason Code, IP, 숫자 같은 ASCII 식별자를 등폭으로 읽히게
 * 한다. 지문과 Serial을 눈으로 비교하는 화면이라 실제로 도움이 된다.
 *
 * 한글에는 쓰지 않는다 — 등폭 face에 한글 글리프가 없어 한글 face로 떨어지면서
 * 등폭이 아니게 되고 자폭만 어긋난다.
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
