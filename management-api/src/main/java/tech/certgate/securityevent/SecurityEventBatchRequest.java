package tech.certgate.securityevent;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** docs/api-spec.md §7 "Security Event Batch". */
public record SecurityEventBatchRequest(List<EventPayload> events) {

	public record EventPayload(
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
	}
}
