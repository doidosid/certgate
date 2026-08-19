package tech.certgate.dashboard;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
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

/**
 * Exercises GET /api/v1/dashboard/summary (docs/api-spec.md §9). The Gateway
 * internal URL points at a closed port on purpose: the Dashboard must survive
 * a Gateway outage with a null outbox rather than failing as a whole
 * (docs/architecture.md 장애 원칙).
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class DashboardIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	private static final String SERVICE_TOKEN = "test-gateway-service-token";

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		// Port 1 is reserved and closed, so the client fails fast instead of hanging.
		registry.add("certgate.gateway.internal-url", () -> "http://127.0.0.1:1");
		registry.add("certgate.gateway.internal-token", () -> "test-internal-token");
		registry.add("certgate.gateway.service-token", () -> SERVICE_TOKEN);
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@SuppressWarnings("unchecked")
	private Map<String, Object> summary() {
		var response = restTemplate.getForEntity("/api/v1/dashboard/summary", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		return response.getBody();
	}

	@Test
	void summary_returnsEveryContractField() {
		Map<String, Object> body = summary();

		assertThat(body).containsKeys(
				"devices", "certificates", "pendingCertificateRequests", "criticalEvents24h",
				"requestBuckets", "services", "outbox", "recentCriticalEvents");

		assertThat((Map<String, Object>) body.get("devices")).containsKeys("active", "total");
		assertThat((Map<String, Object>) body.get("certificates")).containsKeys("valid", "expiringSoon");
		assertThat(body.get("pendingCertificateRequests")).isInstanceOf(Number.class);
		assertThat(body.get("criticalEvents24h")).isInstanceOf(Number.class);
		assertThat(body.get("requestBuckets")).isInstanceOf(List.class);
		assertThat(body.get("services")).isInstanceOf(List.class);
		assertThat(body.get("recentCriticalEvents")).isInstanceOf(List.class);
	}

	@Test
	void summary_whenGatewayUnreachable_returnsNullOutboxNotError() {
		Map<String, Object> body = summary();

		assertThat(body.get("outbox")).isNull();
	}

	@Test
	void summary_reportsServiceHealthForEachComponent() {
		Map<String, Object> body = summary();

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> services = (List<Map<String, Object>>) body.get("services");

		assertThat(services).extracting(s -> s.get("name"))
				.containsExactlyInAnyOrder("management-api", "postgres", "gateway");

		Map<String, Object> gateway = services.stream()
				.filter(s -> "gateway".equals(s.get("name"))).findFirst().orElseThrow();
		assertThat(gateway.get("status")).isEqualTo("DOWN");

		Map<String, Object> managementApi = services.stream()
				.filter(s -> "management-api".equals(s.get("name"))).findFirst().orElseThrow();
		assertThat(managementApi.get("status")).isEqualTo("UP");

		// A reachable Postgres is what every other assertion in this class depends on.
		Map<String, Object> postgresHealth = services.stream()
				.filter(s -> "postgres".equals(s.get("name"))).findFirst().orElseThrow();
		assertThat(postgresHealth.get("status")).isEqualTo("UP");
		assertThat(postgresHealth.get("latencyMs")).isInstanceOf(Number.class);
	}

	@Test
	void summary_countsRegisteredDevice() {
		Map<String, Object> before = summary();
		@SuppressWarnings("unchecked")
		Number totalBefore = (Number) ((Map<String, Object>) before.get("devices")).get("total");

		restTemplate.postForEntity(
				"/api/v1/devices",
				Map.of("deviceKey", "sensor-dashboard-count", "name", "Dashboard Count", "roleName", "SENSOR"),
				Map.class);

		Map<String, Object> after = summary();
		@SuppressWarnings("unchecked")
		Map<String, Object> devices = (Map<String, Object>) after.get("devices");

		assertThat(((Number) devices.get("total")).longValue()).isEqualTo(totalBefore.longValue() + 1);
		assertThat(((Number) devices.get("active")).longValue()).isGreaterThanOrEqualTo(1L);
	}

	/**
	 * Buckets are computed by a native date_trunc query, so they only really get
	 * exercised once Events exist — an empty table would pass any assertion.
	 */
	@Test
	void summary_bucketsGatewayDecisionsByHour() {
		Instant occurredAt = Instant.parse("2026-08-19T04:30:00Z");
		postEvents(List.of(
				event(occurredAt, "ALLOWED", "REQUEST_ALLOWED", "INFO"),
				event(occurredAt.plusSeconds(600), "ALLOWED", "REQUEST_ALLOWED", "INFO"),
				event(occurredAt.plusSeconds(900), "DENIED", "ACCESS_DENIED", "WARNING")));

		var response = restTemplate.getForEntity(
				"/api/v1/dashboard/summary?from=2026-08-19T04:00:00Z&to=2026-08-19T05:00:00Z", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> buckets = (List<Map<String, Object>>) response.getBody().get("requestBuckets");

		assertThat(buckets).hasSize(1);
		Map<String, Object> bucket = buckets.get(0);
		assertThat(((Number) bucket.get("allowed")).longValue()).isEqualTo(2L);
		assertThat(((Number) bucket.get("denied")).longValue()).isEqualTo(1L);
		assertThat(Instant.parse((String) bucket.get("startedAt"))).isEqualTo(Instant.parse("2026-08-19T04:00:00Z"));
	}

	@Test
	void summary_countsAndListsCriticalEvents() {
		postEvents(List.of(event(Instant.now(), "DENIED", "CERTIFICATE_REVOKED", "CRITICAL")));

		Map<String, Object> body = summary();

		assertThat(((Number) body.get("criticalEvents24h")).longValue()).isGreaterThanOrEqualTo(1L);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> recent = (List<Map<String, Object>>) body.get("recentCriticalEvents");
		assertThat(recent).isNotEmpty();
		assertThat(recent).allSatisfy(e -> assertThat(e.get("severity")).isEqualTo("CRITICAL"));
	}

	/**
	 * "최근 24시간"이라는 이름이 맞으려면 상한이 있어야 한다. Gateway나 장비의
	 * 시계가 앞서 있으면 미래 시각 Event가 저장될 수 있다(Batch 입력에 미래 상한
	 * 검증이 없다).
	 */
	@Test
	void summary_criticalCountExcludesFutureDatedEvents() {
		Map<String, Object> before = summary();
		long countBefore = ((Number) before.get("criticalEvents24h")).longValue();

		postEvents(List.of(event(Instant.now().plus(Duration.ofDays(2)), "DENIED", "CERTIFICATE_REVOKED", "CRITICAL")));

		Map<String, Object> after = summary();
		assertThat(((Number) after.get("criticalEvents24h")).longValue()).isEqualTo(countBefore);
	}

	@Test
	void summary_rejectsFromAfterTo() {
		var response = restTemplate.getForEntity(
				"/api/v1/dashboard/summary?from=2026-08-19T05:00:00Z&to=2026-08-19T04:00:00Z", Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).containsEntry("code", "INVALID_REQUEST_PARAMETER");
	}

	private Map<String, Object> event(Instant occurredAt, String decision, String reasonCode, String severity) {
		return Map.of(
				"id", UUID.randomUUID().toString(),
				"occurredAt", occurredAt.toString(),
				"type", "ACCESS",
				"severity", severity,
				"decision", decision,
				"reasonCode", reasonCode,
				"httpMethod", "POST",
				"requestPath", "/telemetry",
				"traceId", UUID.randomUUID().toString());
	}

	private void postEvents(List<Map<String, Object>> events) {
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(SERVICE_TOKEN);
		headers.setContentType(MediaType.APPLICATION_JSON);
		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", new HttpEntity<>(Map.of("events", events), headers), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
	}

	@Test
	void summary_rejectsUnparsableTimeRange() {
		var response = restTemplate.getForEntity("/api/v1/dashboard/summary?from=not-a-timestamp", Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).containsEntry("code", "INVALID_REQUEST_PARAMETER");
	}
}
