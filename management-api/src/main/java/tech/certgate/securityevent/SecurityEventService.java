package tech.certgate.securityevent;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Cross-domain read view of a Device's recent Security Events (docs/
 * repository-structure.md Service 경계, Codex 리뷰 PR #26 Medium) — used by
 * the Device detail view without exposing the {@link SecurityEvent} Entity
 * or {@link SecurityEventRepository} outside this package.
 */
@Service
public class SecurityEventService {

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
}
