package tech.certgate.securityevent;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Exercises GET /security-events and GET /security-events/{eventId} (docs/api-spec.md §9 "Console 조회 API"). */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class SecurityEventQueryIntegrationTests {

	private static final String SERVICE_TOKEN = "test-gateway-service-token";

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("certgate.gateway.service-token", () -> SERVICE_TOKEN);
	}

	@Autowired
	private TestRestTemplate restTemplate;

	private String registerDevice(String deviceKey) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test " + deviceKey, "roleName", "SENSOR"), Map.class);
		return response.getBody().get("id").toString();
	}

	private UUID submitEvent(String deviceId, String decision, String severity, String reasonCode, String occurredAt) {
		UUID eventId = UUID.randomUUID();
		Map<String, Object> event = new HashMap<>();
		event.put("id", eventId.toString());
		event.put("occurredAt", occurredAt);
		event.put("type", "ACCESS");
		event.put("severity", severity);
		event.put("decision", decision);
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
		return eventId;
	}

	@Test
	void list_filtersBySeverityAndDeviceId() {
		String deviceA = registerDevice("sensor-query-a");
		String deviceB = registerDevice("sensor-query-b");
		submitEvent(deviceA, "ALLOWED", "INFO", "REQUEST_ALLOWED", "2026-08-18T01:00:00Z");
		UUID criticalId = submitEvent(deviceA, "DENIED", "CRITICAL", "CERTIFICATE_REVOKED", "2026-08-18T02:00:00Z");
		submitEvent(deviceB, "DENIED", "CRITICAL", "CERTIFICATE_REVOKED", "2026-08-18T02:00:00Z");

		var response = restTemplate.getForEntity(
				"/api/v1/security-events?severity=CRITICAL&deviceId=" + deviceA, Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> content = (List<Map<String, Object>>) response.getBody().get("content");
		assertThat(content).hasSize(1);
		assertThat(content.get(0).get("id")).isEqualTo(criticalId.toString());
	}

	@Test
	void list_filtersByTimeRange() {
		String deviceId = registerDevice("sensor-query-range");
		UUID inRange = submitEvent(deviceId, "ALLOWED", "INFO", "REQUEST_ALLOWED", "2026-08-18T05:00:00Z");
		submitEvent(deviceId, "ALLOWED", "INFO", "REQUEST_ALLOWED", "2026-08-18T09:00:00Z");

		var response = restTemplate.getForEntity(
				"/api/v1/security-events?from=2026-08-18T04:00:00Z&to=2026-08-18T06:00:00Z", Map.class);

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> content = (List<Map<String, Object>>) response.getBody().get("content");
		assertThat(content).extracting(e -> e.get("id")).containsExactly(inRange.toString());
	}

	@Test
	void get_returnsDetail() {
		String deviceId = registerDevice("sensor-query-detail");
		UUID eventId = submitEvent(deviceId, "DENIED", "CRITICAL", "CERTIFICATE_REVOKED", "2026-08-18T03:00:00Z");

		var response = restTemplate.getForEntity("/api/v1/security-events/" + eventId, Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("reasonCode")).isEqualTo("CERTIFICATE_REVOKED");
		assertThat(response.getBody().get("severity")).isEqualTo("CRITICAL");
		assertThat(response.getBody().get("deviceId")).isEqualTo(deviceId);
	}

	@Test
	void get_unknownEventId_isNotFound() {
		var response = restTemplate.getForEntity("/api/v1/security-events/" + UUID.randomUUID(), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("SECURITY_EVENT_NOT_FOUND");
	}
}
