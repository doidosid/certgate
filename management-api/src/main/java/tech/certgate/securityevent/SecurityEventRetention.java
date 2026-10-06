package tech.certgate.securityevent;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * SECURITY_EVENT_RETENTION_DAYS (docs/operations.md "Security Event 보관"):
 * how long a Security Event is kept, counted from its occurred_at. 0 keeps
 * Events forever.
 */
@Component
public class SecurityEventRetention {

	/**
	 * A Gateway keeps Events in its Outbox while the Management API is down and
	 * sends them once it is back. A shorter period would drop Events that waited
	 * out an outage of only a few days, so such a value fails startup.
	 */
	static final int MINIMUM_DAYS = 7;

	private final int retentionDays;

	public SecurityEventRetention(@Value("${certgate.security-event.retention-days:0}") int retentionDays) {
		if (retentionDays < 0 || (retentionDays > 0 && retentionDays < MINIMUM_DAYS)) {
			throw new IllegalStateException("SECURITY_EVENT_RETENTION_DAYS must be 0 (keep forever) or at least "
					+ MINIMUM_DAYS + ", but was " + retentionDays);
		}
		this.retentionDays = retentionDays;
	}

	/** Events with occurred_at before the returned instant are past retention; empty when kept forever. */
	public Optional<Instant> cutoff(Instant now) {
		return retentionDays == 0 ? Optional.empty() : Optional.of(now.minus(Duration.ofDays(retentionDays)));
	}
}
