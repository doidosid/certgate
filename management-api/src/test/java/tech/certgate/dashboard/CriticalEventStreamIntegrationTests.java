package tech.certgate.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Exercises GET /security-events/stream end to end: a real connected SSE
 * client actually receives the CRITICAL Event pushed after it commits
 * (docs/api-spec.md §9 "Critical Event SSE").
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class CriticalEventStreamIntegrationTests {

	private static final String SERVICE_TOKEN = "test-gateway-service-token";

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("certgate.gateway.service-token", () -> SERVICE_TOKEN);
	}

	@LocalServerPort
	private int port;

	@Autowired
	private TestRestTemplate restTemplate;

	private String registerDevice(String deviceKey) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test " + deviceKey, "roleName", "SENSOR"), Map.class);
		return response.getBody().get("id").toString();
	}

	private void submitEvent(String deviceId, String severity, String reasonCode) {
		Map<String, Object> event = new HashMap<>();
		event.put("id", UUID.randomUUID().toString());
		event.put("occurredAt", "2026-08-18T04:00:00Z");
		event.put("type", "ACCESS");
		event.put("severity", severity);
		event.put("decision", "DENIED");
		event.put("reasonCode", reasonCode);
		event.put("httpMethod", "POST");
		event.put("requestPath", "/telemetry");
		event.put("traceId", UUID.randomUUID().toString());
		if (deviceId != null) {
			event.put("deviceId", deviceId);
		}

		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(SERVICE_TOKEN);
		headers.setContentType(MediaType.APPLICATION_JSON);
		restTemplate.postForEntity(
				"/internal/security-events/batch", new HttpEntity<>(Map.of("events", List.of(event)), headers), Map.class);
	}

	private record Subscription(HttpClient client, CompletableFuture<String> firstDataLine) {
	}

	/** Reads SSE lines off a live connection on a background thread until it finds a "data:" line, then completes. */
	private Subscription subscribeAndCaptureFirstDataLine() {
		HttpClient client = HttpClient.newHttpClient();
		HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/security-events/stream"))
				.GET().build();
		CompletableFuture<String> firstDataLine = new CompletableFuture<>();
		Thread reader = new Thread(() -> {
			try {
				HttpResponse<Stream<String>> response = client.send(request, HttpResponse.BodyHandlers.ofLines());
				response.body().filter(line -> line.startsWith("data:")).findFirst()
						.ifPresentOrElse(firstDataLine::complete, () -> firstDataLine.complete(null));
			} catch (Exception e) {
				firstDataLine.completeExceptionally(e);
			}
		});
		reader.setDaemon(true);
		reader.start();
		return new Subscription(client, firstDataLine);
	}

	@Test
	void criticalEvent_isPushedToConnectedSseClient() throws Exception {
		String deviceId = registerDevice("sensor-sse-01");
		Subscription subscription = subscribeAndCaptureFirstDataLine();
		try {
			Thread.sleep(300); // let the SSE subscription register before the event fires

			submitEvent(deviceId, "CRITICAL", "CERTIFICATE_REVOKED");

			String dataLine = subscription.firstDataLine().get(5, TimeUnit.SECONDS);
			assertThat(dataLine).contains("CERTIFICATE_REVOKED").contains("sensor-sse-01").contains("폐기된 인증서");
		} finally {
			subscription.client().shutdownNow();
		}
	}

	@Test
	void nonCriticalEvent_isNotPushedButChannelStaysAliveForALaterCriticalOne() throws Exception {
		String deviceId = registerDevice("sensor-sse-02");
		Subscription subscription = subscribeAndCaptureFirstDataLine();
		try {
			Thread.sleep(300);

			submitEvent(deviceId, "INFO", "REQUEST_ALLOWED");
			submitEvent(deviceId, "WARNING", "ACCESS_DENIED");
			submitEvent(deviceId, "CRITICAL", "CERTIFICATE_REVOKED");

			String dataLine = subscription.firstDataLine().get(5, TimeUnit.SECONDS);
			assertThat(dataLine).contains("CERTIFICATE_REVOKED");
			assertThat(dataLine).doesNotContain("REQUEST_ALLOWED").doesNotContain("ACCESS_DENIED");
		} finally {
			subscription.client().shutdownNow();
		}
	}
}
