import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface Props {
	title: string;
	actions?: ReactNode;
}

/**
 * 콘텐츠 영역의 흰 헤더 띠. 사이드바가 최상단부터 내려오므로 상단바는 이 영역에만 걸린다
 * (레퍼런스 구조). 페이지 본문은 이 아래 회색 바닥 위에 놓인다.
 *
 * routes.test.tsx가 getByRole("heading", { name })으로 화면을 찾으므로, 모든 페이지는 이
 * 컴포넌트를 쓰고 제목 문자열을 유지해야 한다.
 */
export default function PageHeader({ title, actions }: Props) {
	return (
		<Box
			sx={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 2,
				// main의 좌우 여백을 상쇄해 헤더만 콘텐츠 영역 전체 폭으로 흘려보낸다.
				mx: -3,
				px: 3,
				py: 2.25,
				mb: 3,
				backgroundColor: "background.paper",
				borderBottom: 1,
				borderColor: "divider",
			}}
		>
			<Typography variant="h4" component="h1">
				{title}
			</Typography>
			{actions}
		</Box>
	);
}
