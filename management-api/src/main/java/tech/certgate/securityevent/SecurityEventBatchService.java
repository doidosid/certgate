package tech.certgate.securityevent;

import java.time.Clock;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accepts the Gateway's Security Event batch and stores it idempotently by
 * event id (docs/api-spec.md §7, docs/architecture.md). A single Gateway
 * instance resends its Outbox sequentially after a lost response, never
 * concurrently, so a pre-check-then-insert is enough to dedupe in practice.
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
		if (events.isEmpty()) {
			return new SecurityEventBatchResponse(0, 0);
		}

		Set<UUID> existingIds = new HashSet<>();
		securityEvents.findAllByIdIn(events.stream().map(SecurityEventBatchRequest.EventPayload::id).toList())
				.forEach(event -> existingIds.add(event.getId()));

		List<SecurityEvent> toInsert = events.stream()
				.filter(event -> !existingIds.contains(event.id()))
				.map(this::toEntity)
				.toList();
		securityEvents.saveAll(toInsert);

		return new SecurityEventBatchResponse(toInsert.size(), events.size() - toInsert.size());
	}

	private SecurityEvent toEntity(SecurityEventBatchRequest.EventPayload event) {
		return new SecurityEvent(
				event.id(), event.occurredAt(), event.type(), event.severity(), event.deviceId(), event.certificateSerial(),
				event.httpMethod(), event.requestPath(), event.decision(), event.reasonCode(), event.clientIp(),
				event.latencyMs(), event.traceId(), clock.instant());
	}
}
