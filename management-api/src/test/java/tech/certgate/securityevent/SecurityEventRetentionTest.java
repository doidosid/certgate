package tech.certgate.securityevent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

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

	private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
			.withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration.class))
			.withUserConfiguration(SecurityEventRetention.class);

	@Test
	void unsetPropertyKeepsEventsForever() {
		contextRunner.run(context -> assertThat(context.getBean(SecurityEventRetention.class).cutoff(NOW)).isEmpty());
	}

	@Test
	void validPropertyStartsContext() {
		contextRunner.withPropertyValues("certgate.security-event.retention-days=7")
				.run(context -> assertThat(context.getBean(SecurityEventRetention.class).cutoff(NOW))
						.contains(NOW.minusSeconds(7 * 86_400L)));
	}

	/**
	 * Outside Compose (which substitutes 0 for a missing value), an empty or
	 * non-numeric value is a misconfiguration and fails startup rather than
	 * silently meaning "forever" — the same as a value below the minimum.
	 */
	@ParameterizedTest
	@ValueSource(strings = {"1", "-1", "", "abc"})
	void invalidPropertyFailsStartup(String value) {
		contextRunner.withPropertyValues("certgate.security-event.retention-days=" + value)
				.run(context -> assertThat(context).hasFailed());
	}
}
