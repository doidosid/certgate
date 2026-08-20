import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";

interface Props {
	open: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
	width?: number;
}

/**
 * 목록 옆에서 한 건을 열어 보는 오른쪽 패널. 목록의 필터·페이지를 잃지 않고 여러 건을
 * 이어서 확인하는 흐름이라 별도 화면이 아니라 Drawer다.
 *
 * Toolbar spacer가 왜 필요한지 — AppLayout의 AppBar는 zIndex를 drawer + 1로 올려 항상
 * 위에 있다. 이게 없으면 Drawer의 첫 줄(제목)이 AppBar에 가려 보이지 않는다. 브라우저로
 * 확인해서 찾은 문제이고 DOM만 보는 테스트로는 잡히지 않으므로, 화면마다 다시 실수하지
 * 않도록 여기에 한 번만 둔다.
 *
 * 제목은 h2다 — 페이지 제목(h1) 다음 단계를 건너뛰지 않는다.
 */
export default function DetailDrawer({ open, title, onClose, children, width = 440 }: Props) {
	return (
		<Drawer anchor="right" open={open} onClose={onClose}>
			<Toolbar />
			<Box sx={{ width, p: 3 }}>
				<Typography variant="h6" component="h2" gutterBottom>
					{title}
				</Typography>
				{children}
			</Box>
		</Drawer>
	);
}
