import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface Props {
	title: string;
	actions?: ReactNode;
}

/**
 * routes.test.tsx가 getByRole("heading", { name })으로 화면을 찾으므로, 모든
 * 페이지는 이 컴포넌트를 쓰고 제목 문자열을 유지해야 한다.
 *
 * 제목 왼쪽의 3px 세로선은 활성 메뉴의 선과 같은 것이다 — 인증서 체인이 권한을
 * 물려주는 모양을 화면에서 두 번만 말하고 그 외에는 쓰지 않는다.
 */
export default function PageHeader({ title, actions }: Props) {
	return (
		<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5 }}>
			<Typography
				variant="h4"
				component="h1"
				sx={{ borderLeft: 3, borderColor: "primary.main", pl: 1.75, lineHeight: 1.1 }}
			>
				{title}
			</Typography>
			{actions}
		</Box>
	);
}
