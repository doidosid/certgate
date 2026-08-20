import { apiGet } from "../../shared/api/client";
import type { DashboardSummary } from "../../shared/api/types";

/** api-spec.md §9 "Console 조회 API" — Dashboard 요약. */
export function fetchDashboardSummary(): Promise<DashboardSummary> {
	return apiGet("/dashboard/summary");
}
