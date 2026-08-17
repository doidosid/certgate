package tech.certgate.securityevent;

import static org.assertj.core.api.Assertions.assertThat;

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

/** Exercises POST /internal/security-events/batch (docs/api-spec.md §7). */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class SecurityEventBatchIntegrationTests {

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

	private HttpEntity<Map<String, Object>> requestWithEvents(List<Map<String, Object>> events) {
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(SERVICE_TOKEN);
		headers.setContentType(MediaType.APPLICATION_JSON);
		return new HttpEntity<>(Map.of("events", events), headers);
	}

	private Map<String, Object> sampleEvent(UUID id) {
		Map<String, Object> event = new java.util.HashMap<>();
		event.put("id", id.toString());
		event.put("occurredAt", "2026-08-17T05:50:00Z");
		event.put("type", "ACCESS");
		event.put("severity", "INFO");
		event.put("decision", "ALLOWED");
		event.put("reasonCode", "REQUEST_ALLOWED");
		event.put("httpMethod", "POST");
		event.put("requestPath", "/telemetry");
		event.put("traceId", UUID.randomUUID().toString());
		return event;
	}

	@Test
	void batch_acceptsNewEvents() {
		Map<String, Object> event = sampleEvent(UUID.randomUUID());

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of(event)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("acceptedCount")).isEqualTo(1);
		assertThat(response.getBody().get("duplicateCount")).isEqualTo(0);
	}

	@Test
	void batch_resubmittingSameEventId_isIdempotent() {
		Map<String, Object> event = sampleEvent(UUID.randomUUID());
		restTemplate.postForEntity("/internal/security-events/batch", requestWithEvents(List.of(event)), Map.class);

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of(event)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("acceptedCount")).isEqualTo(0);
		assertThat(response.getBody().get("duplicateCount")).isEqualTo(1);
	}

	@Test
	void batch_mixOfNewAndDuplicateEvents_countsEachCorrectly() {
		Map<String, Object> alreadyStored = sampleEvent(UUID.randomUUID());
		restTemplate.postForEntity("/internal/security-events/batch", requestWithEvents(List.of(alreadyStored)), Map.class);

		Map<String, Object> freshEvent = sampleEvent(UUID.randomUUID());
		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of(alreadyStored, freshEvent)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("acceptedCount")).isEqualTo(1);
		assertThat(response.getBody().get("duplicateCount")).isEqualTo(1);
	}

	@Test
	void batch_withoutServiceToken_isRejected() {
		HttpHeaders headers = new HttpHeaders();
		headers.setContentType(MediaType.APPLICATION_JSON);
		var response = restTemplate.postForEntity(
				"/internal/security-events/batch",
				new HttpEntity<>(Map.of("events", List.of(sampleEvent(UUID.randomUUID()))), headers), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(response.getBody().get("code")).isEqualTo("SERVICE_TOKEN_INVALID");
	}

	@Test
	void batch_withEmptyEventsList_returnsZeroCounts() {
		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of()), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("acceptedCount")).isEqualTo(0);
		assertThat(response.getBody().get("duplicateCount")).isEqualTo(0);
	}

	@Test
	void batch_withSameNewEventIdTwiceInOneRequest_insertsOnceAndCountsOneDuplicate() {
		Map<String, Object> event = sampleEvent(UUID.randomUUID());

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of(event, event)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("acceptedCount")).isEqualTo(1);
		assertThat(response.getBody().get("duplicateCount")).isEqualTo(1);
	}

	@Test
	void batch_withMissingRequiredField_isRejectedAndStoresNothing() {
		Map<String, Object> incomplete = sampleEvent(UUID.randomUUID());
		incomplete.remove("reasonCode");

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of(incomplete)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("SECURITY_EVENT_INVALID");
	}

	@Test
	void batch_withActualNullEventInList_isRejectedNotServerError() {
		// A real JSON null element ({"events":[{...},null]}), not just an empty
		// object -- List.of() rejects null elements, so build the list by hand.
		List<Map<String, Object>> events = new java.util.ArrayList<>();
		events.add(sampleEvent(UUID.randomUUID()));
		events.add(null);

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(events), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("SECURITY_EVENT_INVALID");
	}

	@Test
	void batch_withExplicitNullRequiredField_isRejected() {
		// Distinct from the missing-key case: the key is present with a JSON null value.
		Map<String, Object> event = sampleEvent(UUID.randomUUID());
		event.put("reasonCode", null);

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of(event)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("SECURITY_EVENT_INVALID");
	}

	@Test
	void batch_rejectedBatch_doesNotPartiallyStoreValidEventsFromSameRequest() {
		UUID validEventId = UUID.randomUUID();
		Map<String, Object> valid = sampleEvent(validEventId);
		Map<String, Object> invalid = sampleEvent(UUID.randomUUID());
		invalid.remove("type");

		restTemplate.postForEntity("/internal/security-events/batch", requestWithEvents(List.of(valid, invalid)), Map.class);

		var resubmit = restTemplate.postForEntity(
				"/internal/security-events/batch", requestWithEvents(List.of(sampleEvent(validEventId))), Map.class);

		assertThat(resubmit.getBody().get("acceptedCount")).isEqualTo(1);
		assertThat(resubmit.getBody().get("duplicateCount")).isEqualTo(0);
	}
}
