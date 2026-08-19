package tech.certgate.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
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
 * The reachable-Gateway half of the Dashboard contract. Kept apart from
 * {@link DashboardIntegrationTests} because the Gateway URL is class-level
 * configuration: that class points at a closed port to prove the failure path,
 * this one at a stub that answers, to prove the success path actually fills
 * {@code outbox} and reports the Gateway UP.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class DashboardGatewayReachableIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	private static HttpServer stubGateway;

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) throws IOException {
		stubGateway = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		stubGateway.createContext("/internal/outbox/stats", exchange -> {
			byte[] body = "{\"pendingCount\":12,\"oldestAgeSeconds\":24}".getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().add("Content-Type", "application/json");
			exchange.sendResponseHeaders(200, body.length);
			try (OutputStream out = exchange.getResponseBody()) {
				out.write(body);
			}
		});
		stubGateway.start();

		registry.add("certgate.gateway.internal-url", () -> "http://127.0.0.1:" + stubGateway.getAddress().getPort());
		registry.add("certgate.gateway.internal-token", () -> "test-internal-token");
	}

	@AfterAll
	static void stopStubGateway() {
		if (stubGateway != null) {
			stubGateway.stop(0);
		}
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@Test
	void summary_whenGatewayAnswers_fillsOutboxAndReportsGatewayUp() {
		var response = restTemplate.getForEntity("/api/v1/dashboard/summary", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

		@SuppressWarnings("unchecked")
		Map<String, Object> outbox = (Map<String, Object>) response.getBody().get("outbox");
		assertThat(outbox).isNotNull();
		assertThat(((Number) outbox.get("pendingCount")).intValue()).isEqualTo(12);
		assertThat(((Number) outbox.get("oldestAgeSeconds")).intValue()).isEqualTo(24);

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> services = (List<Map<String, Object>>) response.getBody().get("services");
		Map<String, Object> gateway = services.stream()
				.filter(s -> "gateway".equals(s.get("name"))).findFirst().orElseThrow();
		assertThat(gateway.get("status")).isEqualTo("UP");
	}
}
