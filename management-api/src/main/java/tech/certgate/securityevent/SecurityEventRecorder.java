package tech.certgate.securityevent;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.common.TraceIdFilter;
import tech.certgate.device.DeviceService;

/**
 * Records a CRITICAL Security Event that Management API itself produces
 * (docs/architecture.md "CA 서명 실패는 ... CRITICAL Event 기록") — as
 * opposed to {@link SecurityEventBatchService}, which only ingests Events the
 * Gateway already decided and batched. Each such call runs in its own
 * {@code REQUIRES_NEW} Transaction so the audit record survives even when the
 * caller's Transaction (e.g. a failed CSR approval) rolls back — recording
 * the failure is the entire point.
 */
@Service
public class SecurityEventRecorder {

	private static final String CRITICAL_SEVERITY = "CRITICAL";
	private static final String ERROR_DECISION = "ERROR";

	private final SecurityEventRepository securityEvents;
	private final DeviceService deviceService;
	private final ApplicationEventPublisher eventPublisher;
	private final Clock clock;

	public SecurityEventRecorder(
			SecurityEventRepository securityEvents, DeviceService deviceService,
			ApplicationEventPublisher eventPublisher, Clock clock) {
		this.securityEvents = securityEvents;
		this.deviceService = deviceService;
		this.eventPublisher = eventPublisher;
		this.clock = clock;
	}

	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public void recordCritical(String type, String reasonCode, UUID deviceId, String certificateSerial) {
		Instant now = clock.instant();
		SecurityEvent event = new SecurityEvent(
				UUID.randomUUID(), now, type, CRITICAL_SEVERITY, deviceId, certificateSerial,
				null, null, ERROR_DECISION, reasonCode, null, null, TraceIdFilter.current(), now);
		securityEvents.save(event);

		String deviceKey = deviceId == null ? null
				: deviceService.findDevice(deviceId).map(DeviceService.DeviceIdentity::deviceKey).orElse(null);
		eventPublisher.publishEvent(new CriticalSecurityEventStoredEvent(event.getId(), now, deviceKey, reasonCode));
	}
}
