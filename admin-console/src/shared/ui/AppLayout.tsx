import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import AppBar from "@mui/material/AppBar";
import Typography from "@mui/material/Typography";
import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
	{ label: "Dashboard", to: "/" },
	{ label: "Devices", to: "/devices" },
	{ label: "Certificate Requests", to: "/certificate-requests" },
	{ label: "Certificates", to: "/certificates" },
	{ label: "Security Events", to: "/security-events" },
] as const;

const DRAWER_WIDTH = 232;

export default function AppLayout() {
	return (
		<Box sx={{ display: "flex", minHeight: "100vh" }}>
			<AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
				<Toolbar>
					<Typography variant="h6" noWrap sx={{ color: "text.primary" }}>
						CertGate
					</Typography>
					{/*
					 * 제품 이름 옆의 한 줄. 이 콘솔이 무엇을 보는 화면인지 먼저 말한다 —
					 * 장치가 아니라 장치의 신원이다.
					 */}
					<Typography
						variant="caption"
						noWrap
						sx={{ ml: 1.5, pl: 1.5, borderLeft: 1, borderColor: "rgba(255,255,255,0.24)", color: "rgba(255,255,255,0.66)" }}
					>
						device identity control
					</Typography>
				</Toolbar>
			</AppBar>

			<Drawer
				variant="permanent"
				sx={{
					width: DRAWER_WIDTH,
					flexShrink: 0,
					[`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: "border-box" },
				}}
			>
				<Toolbar />
				<List sx={{ py: 1 }}>
					{NAV_ITEMS.map((item) => (
						<ListItemButton
							key={item.to}
							component={NavLink}
							to={item.to}
							end={item.to === "/"}
							/*
							 * 시그니처 — 활성 항목에 3px 녹청 세로선을 둔다. 인증서 체인이
							 * 권한을 위에서 아래로 물려주는 모양을 화면에서 한 번만 말한다.
							 * 같은 선이 페이지 제목에 한 번 더 나오고, 그 외에는 쓰지 않는다.
							 */
							sx={{
								py: 0.85,
								pl: 2.25,
								borderLeft: "3px solid transparent",
								color: "text.secondary",
								"&.active": {
									borderLeftColor: "primary.main",
									backgroundColor: "background.paper",
									color: "text.primary",
									"& .MuiListItemText-primary": { fontWeight: 700 },
								},
							}}
						>
							<ListItemText primary={item.label} />
						</ListItemButton>
					))}
				</List>
			</Drawer>

			<Box component="main" sx={{ flexGrow: 1, minWidth: 0, px: 3, pb: 6 }}>
				<Toolbar />
				<Box sx={{ maxWidth: 1440, pt: 3 }}>
					<Outlet />
				</Box>
			</Box>
		</Box>
	);
}
