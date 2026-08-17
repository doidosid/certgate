package tech.certgate.common;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Injectable Clock so expiry-related logic can be tested with a fixed or
 * offset time instead of the system clock (docs/development-guide.md).
 */
@Configuration
public class ClockConfig {

	@Bean
	public Clock clock() {
		return Clock.systemUTC();
	}
}
