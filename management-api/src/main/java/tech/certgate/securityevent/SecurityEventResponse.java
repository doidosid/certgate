package tech.certgate.securityevent;

import java.time.Instant;
import java.util.UUID;

/** docs/api-spec.md §9 "Console 조회 API" — 검색 목록·상세 공용 응답. */
public record SecurityEventResponse(
		UUID id,
		Instant occurredAt,
		String type,
		String severity,
		UUID deviceId,
		String certificateSerial,
		String httpMethod,
		String requestPath,
		String decision,
		String reasonCode,
		String clientIp,
		Integer latencyMs,
		String traceId) {

	public static SecurityEventResponse from(SecurityEvent event) {
		return new SecurityEventResponse(
				event.getId(), event.getOccurredAt(), event.getType(), event.getSeverity(), event.getDeviceId(),
				event.getCertificateSerial(), event.getHttpMethod(), event.getRequestPath(), event.getDecision(),
				event.getReasonCode(), event.getClientIp(), event.getLatencyMs(), event.getTraceId());
	}
}
