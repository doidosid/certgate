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

const DRAWER_WIDTH = 220;

export default function AppLayout() {
	return (
		<Box sx={{ display: "flex" }}>
			<AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
				<Toolbar>
					<Typography variant="h6" noWrap>
						CertGate Console
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
				<List>
					{NAV_ITEMS.map((item) => (
						<ListItemButton key={item.to} component={NavLink} to={item.to} end={item.to === "/"}>
							<ListItemText primary={item.label} />
						</ListItemButton>
					))}
				</List>
			</Drawer>
			<Box component="main" sx={{ flexGrow: 1, p: 3 }}>
				<Toolbar />
				<Outlet />
			</Box>
		</Box>
	);
}
