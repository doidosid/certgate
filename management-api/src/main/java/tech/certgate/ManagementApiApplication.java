package tech.certgate;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * {@code @EnableScheduling}: Critical Event SSE heartbeat
 * ({@code CriticalEventBroadcaster}). {@code @EnableAsync}: bounded-pool
 * fan-out of Critical Event SSE broadcasts off the Security Event ingest
 * thread ({@code CriticalEventListener}, {@code SseBroadcastExecutorConfig}).
 */
@EnableScheduling
@EnableAsync
@SpringBootApplication
public class ManagementApiApplication {

	public static void main(String[] args) {
		SpringApplication.run(ManagementApiApplication.class, args);
	}
}
