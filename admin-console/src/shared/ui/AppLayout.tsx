import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { NavLink, Outlet } from "react-router-dom";
import { sidebar } from "../../app/theme";
import NavIcon, { type NavIconName } from "./NavIcon";

const NAV_ITEMS: Array<{ label: string; to: string; icon: NavIconName }> = [
	{ label: "Dashboard", to: "/", icon: "dashboard" },
	{ label: "Devices", to: "/devices", icon: "device" },
	{ label: "Certificate Requests", to: "/certificate-requests", icon: "request" },
	{ label: "Certificates", to: "/certificates", icon: "certificate" },
	{ label: "Security Events", to: "/security-events", icon: "event" },
];

const DRAWER_WIDTH = 236;

/**
 * 어두운 사이드바 + 밝은 콘텐츠. 사이드바가 최상단부터 전체 높이를 차지하고 페이지 헤더는
 * 콘텐츠 영역 안에만 걸린다(사용자가 준 레퍼런스 구조).
 *
 * AppBar를 두지 않는다. 브랜드가 사이드바 위에 있으므로 상단에 또 하나의 bar가 필요하지
 * 않고, 덕분에 상세 Drawer가 AppBar에 가려지던 z-index 문제도 생기지 않는다.
 *
 * 로그아웃·사용자 프로필 블록은 만들지 않는다 — 레퍼런스에는 있지만 이 MVP에는 관리자
 * 인증이 없다(api-spec.md: 배포 제한으로만 보호). 없는 기능을 화면에 두지 않는다.
 */
export default function AppLayout() {
	return (
		<Box sx={{ display: "flex", minHeight: "100vh" }}>
			<Drawer
				variant="permanent"
				sx={{
					width: DRAWER_WIDTH,
					flexShrink: 0,
					[`& .MuiDrawer-paper`]: {
						width: DRAWER_WIDTH,
						boxSizing: "border-box",
						backgroundColor: sidebar.background,
						borderRight: `1px solid ${sidebar.border}`,
					},
				}}
			>
				<Box sx={{ px: 2.5, py: 3, display: "flex", alignItems: "center", gap: 1.25 }}>
					{/* 인증서의 봉인 자리 — 브랜드 표시를 강조색으로 한 번만 쓴다. */}
					<Box
						sx={{ width: 10, height: 10, borderRadius: "2px", backgroundColor: sidebar.mark, flexShrink: 0 }}
					/>
					<Typography sx={{ color: sidebar.brand, fontSize: "1.0625rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
						CertGate
					</Typography>
				</Box>

				<List sx={{ px: 1.5, py: 0 }}>
					{NAV_ITEMS.map((item) => (
						<ListItemButton
							key={item.to}
							component={NavLink}
							to={item.to}
							end={item.to === "/"}
							// 활성 항목은 강조색으로 꽉 찬 블록이다(레퍼런스). 흰 글자 대비 4.9:1.
							sx={{
								mb: 0.5,
								py: 1,
								px: 1.5,
								borderRadius: 1.5,
								color: sidebar.text,
								"&:hover": { backgroundColor: "rgba(255, 255, 255, 0.06)" },
								"&.active": {
									backgroundColor: sidebar.activeFill,
									color: sidebar.textActive,
									"&:hover": { backgroundColor: sidebar.activeFill },
									"& .MuiListItemText-primary": { fontWeight: 700 },
								},
							}}
						>
							<ListItemIcon sx={{ minWidth: 32, color: "inherit" }}>
								<NavIcon name={item.icon} />
							</ListItemIcon>
							<ListItemText primary={item.label} />
						</ListItemButton>
					))}
				</List>
			</Drawer>

			<Box component="main" sx={{ flexGrow: 1, minWidth: 0, px: 3, pb: 6 }}>
				<Outlet />
			</Box>
		</Box>
	);
}
