package tech.certgate.dashboard;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tech.certgate.certificate.CertificateService;
import tech.certgate.common.ApiException;
import tech.certgate.device.DeviceService;
import tech.certgate.enrollment.EnrollmentService;
import tech.certgate.securityevent.SecurityEventService;

/**
 * Assembles the Console Dashboard summary (docs/api-spec.md §9) by asking each
 * domain Service for its own aggregate — no cross-domain Repository access
 * (docs/repository-structure.md).
 *
 * <p>Deliberately <b>not</b> {@code @Transactional}. Each domain Service already
 * declares its own short read-only Transaction, and this method also makes an
 * outbound HTTP call to the Gateway. Wrapping the whole assembly in one
 * Transaction would hold a pooled DB Connection for the duration of that call —
 * up to the client's 5s of timeouts — so a slow Gateway would drain the
 * Connection Pool and take unrelated Management API work down with it
 * (Codex 리뷰 PR #40 M-02).
 */
@Service
public class DashboardService {

	private static final Duration DEFAULT_WINDOW = Duration.ofHours(24);
	private static final String UP = "UP";
	private static final String DOWN = "DOWN";

	private final DeviceService deviceService;
	private final CertificateService certificateService;
	private final EnrollmentService enrollmentService;
	private final SecurityEventService securityEventService;
	private final GatewayOutboxClient gatewayOutboxClient;
	private final PostgresHealthProbe postgresHealthProbe;
	private final Clock clock;

	public DashboardService(
			DeviceService deviceService,
			CertificateService certificateService,
			EnrollmentService enrollmentService,
			SecurityEventService securityEventService,
			GatewayOutboxClient gatewayOutboxClient,
			PostgresHealthProbe postgresHealthProbe,
			Clock clock) {
		this.deviceService = deviceService;
		this.certificateService = certificateService;
		this.enrollmentService = enrollmentService;
		this.securityEventService = securityEventService;
		this.gatewayOutboxClient = gatewayOutboxClient;
		this.postgresHealthProbe = postgresHealthProbe;
		this.clock = clock;
	}

	public DashboardSummaryResponse summarize(Instant from, Instant to) {
		Instant now = clock.instant();
		Instant rangeEnd = to != null ? to : now;
		Instant rangeStart = from != null ? from : rangeEnd.minus(DEFAULT_WINDOW);
		if (rangeStart.isAfter(rangeEnd)) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST_PARAMETER", "from은 to보다 뒤일 수 없습니다.");
		}

		DeviceService.DeviceCounts devices = deviceService.countByStatus();
		CertificateService.ValidCounts certificates = certificateService.countValidAndExpiringSoon();

		Optional<DashboardSummaryResponse.OutboxStats> outbox = gatewayOutboxClient.fetchStats();

		List<DashboardSummaryResponse.RequestBucket> buckets =
				securityEventService.countDecisionBuckets(rangeStart, rangeEnd).stream()
						.map(bucket -> new DashboardSummaryResponse.RequestBucket(
								bucket.startedAt(), bucket.allowed(), bucket.denied()))
						.toList();

		return new DashboardSummaryResponse(
				new DashboardSummaryResponse.DeviceCounts(devices.active(), devices.total()),
				new DashboardSummaryResponse.CertificateCounts(certificates.valid(), certificates.expiringSoon()),
				enrollmentService.countPendingRequests(),
				// Half-open [now-24h, now), matching requestBuckets. The upper bound
				// keeps a clock-skewed Gateway's future-dated Event out of a count
				// labelled "최근 24시간" (Codex 리뷰 PR #40 M-03).
				securityEventService.countCriticalBetween(now.minus(DEFAULT_WINDOW), now),
				buckets,
				serviceHealth(outbox.isPresent()),
				outbox.orElse(null),
				securityEventService.findRecentCritical());
	}

	/**
	 * docs/api-spec.md §9 lists Health alongside the counts. management-api is UP
	 * by definition — this code is running. Gateway reuses the Outbox call already
	 * made above rather than issuing a second request. Postgres DOWN is
	 * best-effort: if the database is truly unreachable the aggregate queries
	 * above have already failed, so this mainly reports latency while it is up.
	 */
	private List<DashboardSummaryResponse.ServiceHealth> serviceHealth(boolean gatewayReachable) {
		List<DashboardSummaryResponse.ServiceHealth> services = new ArrayList<>(3);
		services.add(new DashboardSummaryResponse.ServiceHealth("management-api", UP, 0));

		Optional<Integer> postgresLatencyMs = postgresHealthProbe.latencyMs();
		services.add(new DashboardSummaryResponse.ServiceHealth(
				"postgres", postgresLatencyMs.isPresent() ? UP : DOWN, postgresLatencyMs.orElse(null)));

		services.add(new DashboardSummaryResponse.ServiceHealth("gateway", gatewayReachable ? UP : DOWN, null));
		return services;
	}
}
