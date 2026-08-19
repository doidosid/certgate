package tech.certgate.securityevent;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.common.ApiException;
import tech.certgate.common.PageResponse;

/**
 * Cross-domain read view of a Device's recent Security Events (docs/
 * repository-structure.md Service 경계, Codex 리뷰 PR #26 Medium) — used by
 * the Device detail view without exposing the {@link SecurityEvent} Entity
 * or {@link SecurityEventRepository} outside this package. Also serves the
 * Console-facing search/detail queries (docs/api-spec.md §9).
 */
@Service
public class SecurityEventService {

	private static final UUID NO_DEVICE_ID = new UUID(0L, 0L);
	private static final String NO_STRING_FILTER = "";
	/** Severity values are stored as the Gateway sent them (docs/data-model.md SecurityEvent). */
	private static final String CRITICAL = "CRITICAL";

	private final SecurityEventRepository securityEvents;

	public SecurityEventService(SecurityEventRepository securityEvents) {
		this.securityEvents = securityEvents;
	}

	public record EventView(
			UUID id, Instant occurredAt, String type, String severity, String decision, String reasonCode,
			String httpMethod, String requestPath) {
	}

	@Transactional(readOnly = true)
	public List<EventView> recentForDevice(UUID deviceId) {
		return securityEvents.findTop10ByDeviceIdOrderByOccurredAtDesc(deviceId).stream()
				.map(event -> new EventView(
						event.getId(), event.getOccurredAt(), event.getType(), event.getSeverity(), event.getDecision(),
						event.getReasonCode(), event.getHttpMethod(), event.getRequestPath()))
				.toList();
	}

	@Transactional(readOnly = true)
	public PageResponse<SecurityEventResponse> search(
			Instant from, Instant to, UUID deviceId, String decision, String reasonCode, String severity, Pageable pageable) {
		Page<SecurityEvent> page = securityEvents.search(
				from != null, from != null ? from : Instant.EPOCH,
				to != null, to != null ? to : Instant.EPOCH,
				deviceId != null, deviceId != null ? deviceId : NO_DEVICE_ID,
				decision != null && !decision.isBlank(), decision != null ? decision : NO_STRING_FILTER,
				reasonCode != null && !reasonCode.isBlank(), reasonCode != null ? reasonCode : NO_STRING_FILTER,
				severity != null && !severity.isBlank(), severity != null ? severity : NO_STRING_FILTER,
				pageable);
		return PageResponse.of(page.map(SecurityEventResponse::from));
	}

	@Transactional(readOnly = true)
	public SecurityEventResponse get(UUID eventId) {
		return securityEvents.findById(eventId)
				.map(SecurityEventResponse::from)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SECURITY_EVENT_NOT_FOUND", "Security Event를 찾을 수 없습니다."));
	}

	// --- Dashboard 집계 (docs/api-spec.md §9) ---

	/** Half-open [from, to) — see the Repository method for why the upper bound matters. */
	@Transactional(readOnly = true)
	public long countCriticalBetween(Instant from, Instant to) {
		return securityEvents.countBySeverityAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(CRITICAL, from, to);
	}

	@Transactional(readOnly = true)
	public List<SecurityEventResponse> findRecentCritical() {
		return securityEvents.findTop10BySeverityOrderByOccurredAtDesc(CRITICAL).stream()
				.map(SecurityEventResponse::from)
				.toList();
	}

	/** One entry per hour that actually had traffic, ascending. Empty hours are omitted. */
	@Transactional(readOnly = true)
	public List<DecisionBucket> countDecisionBuckets(Instant from, Instant to) {
		return securityEvents.countDecisionsByHour(from, to).stream()
				.map(row -> new DecisionBucket(
						toInstant(row[0]),
						((Number) row[1]).longValue(),
						((Number) row[2]).longValue()))
				.toList();
	}

	/**
	 * A native query's timestamptz reaches us as whatever the JDBC driver
	 * decided; accept the shapes the Postgres driver actually produces rather
	 * than betting the Dashboard on one of them.
	 */
	private static Instant toInstant(Object value) {
		return switch (value) {
			case java.sql.Timestamp timestamp -> timestamp.toInstant();
			case java.time.OffsetDateTime offsetDateTime -> offsetDateTime.toInstant();
			case Instant instant -> instant;
			default -> throw new IllegalStateException(
					"예상하지 못한 시각 타입입니다: " + value.getClass().getName());
		};
	}

	public record DecisionBucket(Instant startedAt, long allowed, long denied) {
	}
}
