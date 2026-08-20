import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import OutboxPanel from "../features/dashboard/OutboxPanel";
import RecentCriticalPanel from "../features/dashboard/RecentCriticalPanel";
import RequestTrend from "../features/dashboard/RequestTrend";
import ServiceHealth from "../features/dashboard/ServiceHealth";
import SummaryCards from "../features/dashboard/SummaryCards";
import { useDashboardSummary } from "../features/dashboard/queries";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";

/** ui-design.md §3 순서대로 배치한다. */
export default function DashboardPage() {
	const summary = useDashboardSummary();

	return (
		<>
			<PageHeader title="Dashboard" />
			<QueryState
				isLoading={summary.isPending}
				isError={summary.isError}
				error={summary.error}
				isEmpty={false}
				onRetry={() => summary.refetch()}
			>
				{summary.data && (
					<Grid container spacing={2.5}>
						<Grid size={12}>
							<SummaryCards summary={summary.data} />
						</Grid>

						<Grid size={{ xs: 12, md: 8 }}>
							<Paper sx={{ p: 2.5 }}>
								<Typography variant="subtitle1" gutterBottom>
									최근 24시간 요청 허용·차단 추이
								</Typography>
								<RequestTrend buckets={summary.data.requestBuckets} />
							</Paper>
						</Grid>

						<Grid size={{ xs: 12, md: 4 }}>
							<Paper sx={{ p: 2.5, mb: 2.5 }}>
								<Typography variant="subtitle1" gutterBottom>
									서비스 상태
								</Typography>
								<ServiceHealth services={summary.data.services} />
							</Paper>
							<Paper sx={{ p: 2.5 }}>
								<Typography variant="subtitle1" gutterBottom>
									Gateway Outbox
								</Typography>
								<OutboxPanel outbox={summary.data.outbox} />
							</Paper>
						</Grid>

						<Grid size={12}>
							<Paper sx={{ p: 2.5 }}>
								<Typography variant="subtitle1" gutterBottom>
									최근 Critical Event
								</Typography>
								<RecentCriticalPanel events={summary.data.recentCriticalEvents} />
							</Paper>
						</Grid>
					</Grid>
				)}
			</QueryState>
		</>
	);
}
