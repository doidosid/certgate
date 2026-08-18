package tech.certgate.securityevent;

import java.time.Instant;
import java.util.UUID;

/**
 * Published after a newly-stored (not a resend duplicate) Security Event with
 * {@code severity == CRITICAL} commits, so the dashboard package can push it
 * to connected Console SSE clients without this package depending on that
 * one (docs/api-spec.md §9 "Critical Event SSE"). {@code deviceKey} is
 * resolved here, best-effort, so subscribers never need to look the Device
 * back up themselves — it is null if the Device is unknown or absent.
 */
public record CriticalSecurityEventStoredEvent(UUID eventId, Instant occurredAt, String deviceKey, String reasonCode) {
}
