package tech.certgate.dashboard;

import java.time.Instant;
import java.util.List;
import tech.certgate.securityevent.SecurityEventResponse;

/**
 * docs/api-spec.md §9 "Dashboard 응답 핵심 형태".
 *
 * <p>{@code outbox} is null when the Gateway could not be reached. The Gateway's
 * SQLite Outbox lives inside the Gateway process, so its absence is a partial
 * failure that must not take the rest of the Dashboard down with it
 * (docs/architecture.md 장애 원칙).
 */
public record DashboardSummaryResponse(
		DeviceCounts devices,
		CertificateCounts certificates,
		long pendingCertificateRequests,
		long criticalEvents24h,
		List<RequestBucket> requestBuckets,
		List<ServiceHealth> services,
		OutboxStats outbox,
		List<SecurityEventResponse> recentCriticalEvents) {

	public record DeviceCounts(long active, long total) {
	}

	public record CertificateCounts(long valid, long expiringSoon) {
	}

	/** One hour of Gateway access decisions, keyed by the hour it starts. */
	public record RequestBucket(Instant startedAt, long allowed, long denied) {
	}

	/** {@code latencyMs} is null when the check could not be timed (e.g. the component is DOWN). */
	public record ServiceHealth(String name, String status, Integer latencyMs) {
	}

	public record OutboxStats(int pendingCount, int oldestAgeSeconds) {
	}
}
