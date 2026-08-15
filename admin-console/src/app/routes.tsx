import type { RouteObject } from "react-router-dom";
import AppLayout from "../shared/ui/AppLayout";
import DashboardPage from "../pages/DashboardPage";
import DevicesPage from "../pages/DevicesPage";
import CertificateRequestsPage from "../pages/CertificateRequestsPage";
import CertificatesPage from "../pages/CertificatesPage";
import SecurityEventsPage from "../pages/SecurityEventsPage";

export const routes: RouteObject[] = [
	{
		path: "/",
		element: <AppLayout />,
		children: [
			{ index: true, element: <DashboardPage /> },
			{ path: "devices", element: <DevicesPage /> },
			{ path: "certificate-requests", element: <CertificateRequestsPage /> },
			{ path: "certificates", element: <CertificatesPage /> },
			{ path: "security-events", element: <SecurityEventsPage /> },
		],
	},
];
