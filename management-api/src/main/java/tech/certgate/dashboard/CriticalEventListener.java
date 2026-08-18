package tech.certgate.dashboard;

import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tech.certgate.securityevent.CriticalSecurityEventStoredEvent;

/**
 * Bridges a newly-stored CRITICAL Security Event to the SSE broadcaster only
 * after the storing Transaction commits — the same after-commit discipline
 * used for Gateway Cache invalidation on Certificate revoke
 * ({@code GatewayCacheInvalidationListener}), so a Console can never be
 * notified about an Event that a rolled-back Transaction ultimately didn't
 * persist. {@code @Async} hands the actual fan-out to
 * {@link SseBroadcastExecutorConfig}'s bounded pool so a batch of slow SSE
 * Clients can't delay the Gateway's Security Event Batch response, which
 * runs on the same thread that triggers this listener (Codex 리뷰 PR #28
 * Medium).
 */
@Component
public class CriticalEventListener {

	private final CriticalEventBroadcaster broadcaster;

	public CriticalEventListener(CriticalEventBroadcaster broadcaster) {
		this.broadcaster = broadcaster;
	}

	@Async(SseBroadcastExecutorConfig.BEAN_NAME)
	@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
	public void onCriticalSecurityEventStored(CriticalSecurityEventStoredEvent event) {
		broadcaster.broadcast(new CriticalEventPayload(
				event.eventId().toString(), event.occurredAt(), event.deviceKey(), event.reasonCode(),
				CriticalEventMessages.forReasonCode(event.reasonCode())));
	}
}
