package tech.certgate.securityevent;

import java.time.Clock;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.common.ApiException;

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

	private final SecurityEventRepository securityEvents;
	private final Clock clock;

	public SecurityEventBatchService(SecurityEventRepository securityEvents, Clock clock) {
		this.securityEvents = securityEvents;
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

		return new SecurityEventBatchResponse(toInsert.size(), events.size() - toInsert.size());
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
