package tech.certgate.dashboard;

import java.time.Instant;

/** docs/api-spec.md §9 "SSE 형식" — JSON shape of the {@code data:} field. */
public record CriticalEventPayload(String eventId, Instant occurredAt, String deviceKey, String reasonCode, String message) {
}
