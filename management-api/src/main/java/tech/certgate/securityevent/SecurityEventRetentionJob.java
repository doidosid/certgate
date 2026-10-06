package tech.certgate.securityevent;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Deletes Security Events past {@link SecurityEventRetention} once a day.
 * Each batch commits on its own so a large backlog never becomes one long
 * Transaction holding row locks against incoming Gateway batches.
 */
@Component
public class SecurityEventRetentionJob {

	static final int DELETE_BATCH_SIZE = 1000;

	private static final Logger log = LoggerFactory.getLogger(SecurityEventRetentionJob.class);

	private final SecurityEventRepository securityEvents;
	private final SecurityEventRetention retention;
	private final TransactionTemplate transactionTemplate;
	private final Clock clock;

	public SecurityEventRetentionJob(
			SecurityEventRepository securityEvents, SecurityEventRetention retention,
			PlatformTransactionManager transactionManager, Clock clock) {
		this.securityEvents = securityEvents;
		this.retention = retention;
		this.transactionTemplate = new TransactionTemplate(transactionManager);
		this.clock = clock;
	}

	@Scheduled(cron = "0 30 3 * * *", zone = "UTC")
	public void purgeDaily() {
		purgeExpired();
	}

	/** Returns how many Events were deleted. */
	public long purgeExpired() {
		Optional<Instant> cutoff = retention.cutoff(clock.instant());
		if (cutoff.isEmpty()) {
			return 0;
		}
		// The cutoff is fixed for the whole run, so the loop ends even while
		// the Gateway keeps inserting new Events.
		long total = 0;
		int deleted;
		do {
			Integer batch = transactionTemplate.execute(
					status -> securityEvents.deleteOccurredBefore(cutoff.get(), DELETE_BATCH_SIZE));
			deleted = batch == null ? 0 : batch;
			total += deleted;
		} while (deleted == DELETE_BATCH_SIZE);
		if (total > 0) {
			log.info("Deleted {} Security Events older than {}", total, cutoff.get());
		}
		return total;
	}
}
