import { useQuery } from "@tanstack/react-query";
import { fetchDashboardSummary } from "./api";

export const dashboardKeys = {
	summary: ["dashboard", "summary"] as const,
};

/**
 * 30초마다 다시 읽는다. Dashboard는 실시간 계기판이 아니지만(그건 CRITICAL Event
 * SSE·Task 14의 몫이다), Outbox 적체·서비스 상태처럼 방금 바뀔 수 있는 값을 화면을
 * 열어 둔 채로 계속 낡게 두지 않는다.
 */
export function useDashboardSummary() {
	return useQuery({
		queryKey: dashboardKeys.summary,
		queryFn: fetchDashboardSummary,
		refetchInterval: 30 * 1000,
	});
}
