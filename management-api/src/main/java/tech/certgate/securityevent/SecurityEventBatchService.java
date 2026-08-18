package tech.certgate.securityevent;

import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.common.ApiException;
import tech.certgate.device.DeviceService;

/**
 * Accepts the Gateway's Security Event batch and stores it idempotently by
 * event id (docs/api-spec.md §7, docs/architecture.md). A single Gateway
 * instance resends its Outbox sequentially after a lost response, never
 * concurrently, so a pre-check-then-insert is enough to dedupe against
 * already-stored events in practice; within-batch duplicate ids are also
 * deduped so a single request never sends the same id to the DB twice.
 */
@Service
public class SecurityEventBatchService {

	private static final String ALLOWED_DECISION = "ALLOWED";
	private static final String CRITICAL_SEVERITY = "CRITICAL";
	private static final Set<String> VALID_SEVERITIES = Set.of("INFO", "WARNING", "CRITICAL");

	private final SecurityEventRepository securityEvents;
	private final DeviceService deviceService;
	private final ApplicationEventPublisher eventPublisher;
	private final Clock clock;

	public SecurityEventBatchService(
			SecurityEventRepository securityEvents, DeviceService deviceService, ApplicationEventPublisher eventPublisher, Clock clock) {
		this.securityEvents = securityEvents;
		this.deviceService = deviceService;
		this.eventPublisher = eventPublisher;
		this.clock = clock;
	}

	@Transactional
	public SecurityEventBatchResponse accept(SecurityEventBatchRequest request) {
		List<SecurityEventBatchRequest.EventPayload> events = request.events() == null ? List.of() : request.events();
		validate(events);
		if (events.isEmpty()) {
			return new SecurityEventBatchResponse(0, 0);
		}

		Map<UUID, SecurityEventBatchRequest.EventPayload> distinctById = new LinkedHashMap<>();
		for (SecurityEventBatchRequest.EventPayload event : events) {
			distinctById.putIfAbsent(event.id(), event);
		}

		Set<UUID> existingIds = new HashSet<>();
		securityEvents.findAllByIdIn(List.copyOf(distinctById.keySet())).forEach(event -> existingIds.add(event.getId()));

		List<SecurityEvent> toInsert = distinctById.values().stream()
				.filter(event -> !existingIds.contains(event.id()))
				.map(this::toEntity)
				.toList();
		securityEvents.saveAll(toInsert);
		updateDeviceLastSeen(toInsert);
		publishCriticalEvents(toInsert);

		return new SecurityEventBatchResponse(toInsert.size(), events.size() - toInsert.size());
	}

	/**
	 * docs/api-spec.md §9 "Critical Event SSE" — only newly-stored Events (not
	 * resend duplicates) are broadcast, so reconnecting/retrying the same
	 * Outbox batch never re-notifies a Console that already saw it live.
	 */
	private void publishCriticalEvents(List<SecurityEvent> inserted) {
		for (SecurityEvent event : inserted) {
			if (!CRITICAL_SEVERITY.equals(event.getSeverity())) {
				continue;
			}
			String deviceKey = event.getDeviceId() == null ? null
					: deviceService.findDevice(event.getDeviceId()).map(DeviceService.DeviceIdentity::deviceKey).orElse(null);
			this.eventPublisher.publishEvent(new CriticalSecurityEventStoredEvent(
					event.getId(), event.getOccurredAt(), deviceKey, event.getReasonCode()));
		}
	}

	/**
	 * docs/data-model.md "last_seen_at: 마지막 허용 요청 시각" — updated from
	 * newly stored ALLOWED Events only (not from ones already in the DB before
	 * this batch), one write per Device even when several of its Events land
	 * in the same batch (Codex 리뷰 PR #26 Medium).
	 */
	private void updateDeviceLastSeen(List<SecurityEvent> inserted) {
		Map<UUID, Instant> latestAllowedByDevice = new LinkedHashMap<>();
		for (SecurityEvent event : inserted) {
			if (event.getDeviceId() == null || !ALLOWED_DECISION.equals(event.getDecision())) {
				continue;
			}
			latestAllowedByDevice.merge(event.getDeviceId(), event.getOccurredAt(), (a, b) -> a.isAfter(b) ? a : b);
		}
		latestAllowedByDevice.forEach(deviceService::updateLastSeenIfNewer);
	}

	private void validate(List<SecurityEventBatchRequest.EventPayload> events) {
		for (SecurityEventBatchRequest.EventPayload event : events) {
			if (event == null
					|| event.id() == null
					|| event.occurredAt() == null
					|| isBlank(event.type())
					|| isBlank(event.severity())
					|| isBlank(event.decision())
					|| isBlank(event.reasonCode())
					|| isBlank(event.traceId())) {
				throw new ApiException(HttpStatus.BAD_REQUEST, "SECURITY_EVENT_INVALID", "Security Event 필수 필드가 비어 있습니다.");
			}
			// The Producer (Gateway today) judges severity, not this Service — but
			// an unrecognized value would either silently miss the SSE Critical
			// path or, if it happened to be treated as CRITICAL, false-alarm the
			// Console (Codex 리뷰 PR #28 Medium; docs/security-design.md §9).
			if (!VALID_SEVERITIES.contains(event.severity())) {
				throw new ApiException(HttpStatus.BAD_REQUEST, "SECURITY_EVENT_INVALID", "severity 값이 올바르지 않습니다.");
			}
		}
	}

	private static boolean isBlank(String value) {
		return value == null || value.isBlank();
	}

	private SecurityEvent toEntity(SecurityEventBatchRequest.EventPayload event) {
		return new SecurityEvent(
				event.id(), event.occurredAt(), event.type(), event.severity(), event.deviceId(), event.certificateSerial(),
				event.httpMethod(), event.requestPath(), event.decision(), event.reasonCode(), event.clientIp(),
				event.latencyMs(), event.traceId(), clock.instant());
	}
}
