package tech.certgate.dashboard;

import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.certificate.CertificateService;
import tech.certgate.common.ApiException;
import tech.certgate.device.DeviceService;
import tech.certgate.enrollment.EnrollmentService;
import tech.certgate.securityevent.SecurityEventService;

/**
 * Assembles the Console Dashboard summary (docs/api-spec.md §9) by asking each
 * domain Service for its own aggregate — no cross-domain Repository access
 * (docs/repository-structure.md).
 */
@Service
public class DashboardService {

	private static final Logger log = LoggerFactory.getLogger(DashboardService.class);
	private static final Duration DEFAULT_WINDOW = Duration.ofHours(24);
	private static final String UP = "UP";
	private static final String DOWN = "DOWN";

	private final DeviceService deviceService;
	private final CertificateService certificateService;
	private final EnrollmentService enrollmentService;
	private final SecurityEventService securityEventService;
	private final GatewayOutboxClient gatewayOutboxClient;
	private final EntityManager entityManager;
	private final Clock clock;

	public DashboardService(
			DeviceService deviceService,
			CertificateService certificateService,
			EnrollmentService enrollmentService,
			SecurityEventService securityEventService,
			GatewayOutboxClient gatewayOutboxClient,
			EntityManager entityManager,
			Clock clock) {
		this.deviceService = deviceService;
		this.certificateService = certificateService;
		this.enrollmentService = enrollmentService;
		this.securityEventService = securityEventService;
		this.gatewayOutboxClient = gatewayOutboxClient;
		this.entityManager = entityManager;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public DashboardSummaryResponse summarize(Instant from, Instant to) {
		Instant now = clock.instant();
		Instant rangeEnd = to != null ? to : now;
		Instant rangeStart = from != null ? from : rangeEnd.minus(DEFAULT_WINDOW);
		if (rangeStart.isAfter(rangeEnd)) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST_PARAMETER", "from은 to보다 뒤일 수 없습니다.");
		}

		DeviceService.DeviceCounts devices = deviceService.countByStatus();
		CertificateService.ValidCounts certificates = certificateService.countValidAndExpiringSoon();

		var outbox = gatewayOutboxClient.fetchStats();

		List<DashboardSummaryResponse.RequestBucket> buckets =
				securityEventService.countDecisionBuckets(rangeStart, rangeEnd).stream()
						.map(bucket -> new DashboardSummaryResponse.RequestBucket(
								bucket.startedAt(), bucket.allowed(), bucket.denied()))
						.toList();

		return new DashboardSummaryResponse(
				new DashboardSummaryResponse.DeviceCounts(devices.active(), devices.total()),
				new DashboardSummaryResponse.CertificateCounts(certificates.valid(), certificates.expiringSoon()),
				enrollmentService.countPendingRequests(),
				securityEventService.countCriticalSince(now.minus(DEFAULT_WINDOW)),
				buckets,
				serviceHealth(outbox.isPresent()),
				outbox.orElse(null),
				securityEventService.findRecentCritical());
	}

	/**
	 * docs/api-spec.md §9 lists Health alongside the counts. management-api is
	 * UP by definition — this code is running. Postgres is probed with the
	 * cheapest possible round trip so the reported latency is the connection's,
	 * not a query's. Gateway reuses the Outbox call already made above rather
	 * than issuing a second request.
	 */
	private List<DashboardSummaryResponse.ServiceHealth> serviceHealth(boolean gatewayReachable) {
		List<DashboardSummaryResponse.ServiceHealth> services = new ArrayList<>(3);
		services.add(new DashboardSummaryResponse.ServiceHealth("management-api", UP, 0));

		long startedAt = System.nanoTime();
		String postgresStatus;
		Integer postgresLatencyMs;
		try {
			entityManager.createNativeQuery("SELECT 1").getSingleResult();
			postgresStatus = UP;
			postgresLatencyMs = (int) Duration.ofNanos(System.nanoTime() - startedAt).toMillis();
		} catch (RuntimeException e) {
			// Reaching here means the read Transaction itself is in trouble; report
			// it rather than failing the whole Dashboard.
			log.warn("Dashboard의 PostgreSQL Health 확인에 실패했습니다: {}", e.getMessage());
			postgresStatus = DOWN;
			postgresLatencyMs = null;
		}
		services.add(new DashboardSummaryResponse.ServiceHealth("postgres", postgresStatus, postgresLatencyMs));

		services.add(new DashboardSummaryResponse.ServiceHealth("gateway", gatewayReachable ? UP : DOWN, null));
		return services;
	}
}
