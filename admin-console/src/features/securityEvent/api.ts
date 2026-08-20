import { apiGet } from "../../shared/api/client";
import type { PageResponse, SecurityEvent } from "../../shared/api/types";

/**
 * api-spec.md §9 `GET /security-events?from=&to=&deviceId=&decision=&reasonCode=
 * &severity=&page=&size=`. from·to는 서버가 ISO 8601 Instant로 받는다
 * (SecurityEventQueryController의 @DateTimeFormat ISO.DATE_TIME).
 */
export interface SecurityEventListParams {
	from?: string;
	to?: string;
	deviceId?: string;
	decision?: string;
	reasonCode?: string;
	severity?: string;
	page: number;
	size: number;
}

export function fetchSecurityEvents(params: SecurityEventListParams): Promise<PageResponse<SecurityEvent>> {
	return apiGet("/security-events", { ...params });
}

export function fetchSecurityEvent(eventId: string): Promise<SecurityEvent> {
	return apiGet(`/security-events/${eventId}`);
}
