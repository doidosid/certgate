import { useQuery } from "@tanstack/react-query";
import { fetchSecurityEvent, fetchSecurityEvents, type SecurityEventListParams } from "./api";

export const securityEventKeys = {
	all: ["security-events"] as const,
	list: (params: SecurityEventListParams) => [...securityEventKeys.all, "list", params] as const,
	detail: (eventId: string) => [...securityEventKeys.all, "detail", eventId] as const,
};

export function useSecurityEvents(params: SecurityEventListParams) {
	return useQuery({ queryKey: securityEventKeys.list(params), queryFn: () => fetchSecurityEvents(params) });
}

/**
 * 목록에서 고른 Event는 이미 상세와 같은 응답(SecurityEventResponse)이라 다시
 * 조회할 필요가 없다. 이 Hook은 Event ID만 아는 곳(SSE 알림에서 넘어온 링크 등)을
 * 위한 것이다.
 */
export function useSecurityEvent(eventId: string) {
	return useQuery({
		queryKey: securityEventKeys.detail(eventId),
		queryFn: () => fetchSecurityEvent(eventId),
		enabled: eventId !== "",
	});
}
