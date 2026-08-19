package tech.certgate.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
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
 * Regression for Codex 리뷰 PR #40 M-01. A misconfigured Gateway URL fails
 * while the request URI is being built, which raises IllegalArgumentException
 * rather than RestClientException. Catching only the latter let that escape and
 * turned the whole Dashboard into a 500 — the opposite of the degradation this
 * endpoint promises.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class DashboardMalformedGatewayUrlIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("certgate.gateway.internal-url", () -> "not a valid url at all");
		registry.add("certgate.gateway.internal-token", () -> "test-internal-token");
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@Test
	void summary_withMalformedGatewayUrl_stillReturnsDashboardWithoutOutbox() {
		var response = restTemplate.getForEntity("/api/v1/dashboard/summary", Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("outbox")).isNull();
		assertThat(response.getBody().get("devices")).isNotNull();

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> services = (List<Map<String, Object>>) response.getBody().get("services");
		Map<String, Object> gateway = services.stream()
				.filter(s -> "gateway".equals(s.get("name"))).findFirst().orElseThrow();
		assertThat(gateway.get("status")).isEqualTo("DOWN");
	}
}
