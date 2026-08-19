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
 */
export default function PageHeader({ title, actions }: Props) {
	return (
		<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
			<Typography variant="h4" component="h1">
				{title}
			</Typography>
			{actions}
		</Box>
	);
}
