package tech.certgate;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Verifies that /actuator/health reflects real PostgreSQL reachability
 * instead of only the application process being alive.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class HealthIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void hikariFastFailureProperties(DynamicPropertyRegistry registry) {
		// Fail fast on connection loss instead of the 30s Hikari default so the
		// DOWN-after-outage assertion below does not need a long poll window.
		registry.add("spring.datasource.hikari.connection-timeout", () -> "2000");
		registry.add("spring.datasource.hikari.validation-timeout", () -> "2000");
		registry.add("spring.datasource.hikari.maximum-pool-size", () -> "1");
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@Test
	void healthIsUpWhilePostgresIsReachable() {
		var response = restTemplate.getForEntity("/actuator/health", String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).contains("\"status\":\"UP\"");
	}

	@Test
	void healthReportsDownWhenPostgresBecomesUnreachable() throws InterruptedException {
		postgres.stop();

		Duration timeout = Duration.ofSeconds(20);
		Instant deadline = Instant.now().plus(timeout);
		var response = restTemplate.getForEntity("/actuator/health", String.class);

		while (!response.getBody().contains("\"status\":\"DOWN\"") && Instant.now().isBefore(deadline)) {
			Thread.sleep(500);
			response = restTemplate.getForEntity("/actuator/health", String.class);
		}

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
		assertThat(response.getBody()).contains("\"status\":\"DOWN\"");
	}
}
