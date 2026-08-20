import type { ReactNode } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

interface Props {
	label: string;
	children: ReactNode;
}

/** 상세 화면의 라벨·값 한 줄. Device 상세와 보안 이벤트 상세가 같은 모양을 쓴다. */
export default function Field({ label, children }: Props) {
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
