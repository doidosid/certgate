package tech.certgate.securityevent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class SecurityEventRetentionTest {

	private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");

	@Test
	void zeroKeepsEventsForever() {
		assertThat(new SecurityEventRetention(0).cutoff(NOW)).isEmpty();
	}

	@ParameterizedTest
	@ValueSource(ints = {7, 90})
	void cutoffIsRetentionDaysBeforeNow(int days) {
		assertThat(new SecurityEventRetention(days).cutoff(NOW)).contains(NOW.minusSeconds(days * 86_400L));
	}

	/**
	 * A value below the minimum would drop Events a Gateway kept in its
	 * Outbox through a Management API outage of only a few days, so it fails
	 * startup instead of being silently accepted.
	 */
	@ParameterizedTest
	@ValueSource(ints = {-1, 1, 6})
	void rejectsNegativeOrBelowMinimum(int days) {
		assertThatThrownBy(() -> new SecurityEventRetention(days))
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("SECURITY_EVENT_RETENTION_DAYS");
	}
}
