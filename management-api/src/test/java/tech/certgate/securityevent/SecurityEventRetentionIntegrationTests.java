package tech.certgate.securityevent;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * SECURITY_EVENT_RETENTION_DAYS (docs/operations.md "Security Event 보관"):
 * Events whose occurred_at is older than the retention period are deleted by
 * the daily job, and ones that arrive already past it are not stored.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@RecordApplicationEvents
class SecurityEventRetentionIntegrationTests {

	private static final String SERVICE_TOKEN = "test-gateway-service-token";
	private static final Instant NOW = Instant.parse("2026-10-06T00:00:00Z");
	private static final Duration RETENTION = Duration.ofDays(30);
	private static final Instant CUTOFF = NOW.minus(RETENTION);

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("certgate.gateway.service-token", () -> SERVICE_TOKEN);
		registry.add("certgate.security-event.retention-days", () -> "30");
	}

	@TestConfiguration
	static class FixedClock {
		@Bean
		@Primary
		Clock fixedClock() {
			return Clock.fixed(NOW, ZoneOffset.UTC);
		}
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private SecurityEventRetentionJob retentionJob;

	@Autowired
	private SecurityEventBatchService batchService;

	@Autowired
	private ApplicationEvents applicationEvents;

	@Autowired
	private ThreadPoolTaskScheduler taskScheduler;

	@BeforeEach
	void clearEvents() {
		jdbcTemplate.update("DELETE FROM security_event");
	}

	@Test
	void purge_deletesOnlyEventsOlderThanRetentionAcrossSeveralBatches() {
		int expired = SecurityEventRetentionJob.DELETE_BATCH_SIZE * 2 + 500;
		insertEvents(expired, CUTOFF.minusSeconds(1));
		UUID atCutoff = insertEvent(CUTOFF);
		UUID recent = insertEvent(NOW.minus(Duration.ofDays(1)));

		long deleted = retentionJob.purgeExpired();

		assertThat(deleted).isEqualTo(expired);
		assertThat(jdbcTemplate.queryForList("SELECT id FROM security_event", UUID.class))
				.containsExactlyInAnyOrder(atCutoff, recent);
	}

	@Test
	void purge_withNothingExpiredDeletesNothing() {
		UUID recent = insertEvent(NOW.minus(Duration.ofDays(1)));

		assertThat(retentionJob.purgeExpired()).isZero();
		assertThat(jdbcTemplate.queryForList("SELECT id FROM security_event", UUID.class)).containsExactly(recent);
	}

	/**
	 * A Gateway Outbox resend that arrives after its Event already passed the
	 * retention period is answered 200 (so the Gateway drops it from the
	 * Outbox) but not stored — otherwise the daily job would delete it again,
	 * and an Event the job already deleted would come back as "new".
	 */
	@Test
	void batch_dropsEventsAlreadyPastRetention() {
		String deviceId = registerDevice("retention-late-" + UUID.randomUUID());
		Map<String, Object> late = event(UUID.randomUUID(), CUTOFF.minusSeconds(1), "INFO", deviceId);
		Map<String, Object> lateCritical = event(UUID.randomUUID(), CUTOFF.minusSeconds(2), "CRITICAL", null);
		Map<String, Object> onTime = event(UUID.randomUUID(), CUTOFF, "INFO", null);

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", batch(List.of(late, lateCritical, onTime)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody())
				.containsEntry("acceptedCount", 1)
				.containsEntry("duplicateCount", 0)
				.containsEntry("expiredCount", 2);
		assertThat(jdbcTemplate.queryForList("SELECT id::text FROM security_event", String.class))
				.containsExactly(onTime.get("id").toString());
		// A dropped ALLOWED Event is not "the last allowed request" either.
		assertThat(jdbcTemplate.queryForObject(
				"SELECT last_seen_at FROM device WHERE id = ?::uuid", Timestamp.class, deviceId)).isNull();
	}

	/**
	 * The job deleted a CRITICAL Event, then the Gateway resends the same id
	 * (its 200 was lost). It must stay deleted and not alert the Console again.
	 * The service is called on the test thread so ApplicationEvents sees what
	 * it publishes; the on-time Event is the control proving it would.
	 */
	@Test
	void resendAfterPurgeIsNotStoredOrAlertedAgain() {
		UUID purged = insertEvent(CUTOFF.minusSeconds(1));
		assertThat(retentionJob.purgeExpired()).isEqualTo(1);
		UUID onTime = UUID.randomUUID();

		SecurityEventBatchResponse response = batchService.accept(new SecurityEventBatchRequest(List.of(
				criticalPayload(purged, CUTOFF.minusSeconds(1)), criticalPayload(onTime, CUTOFF))));

		assertThat(response).isEqualTo(new SecurityEventBatchResponse(1, 0, 1));
		assertThat(jdbcTemplate.queryForList("SELECT id FROM security_event", UUID.class)).containsExactly(onTime);
		assertThat(applicationEvents.stream(CriticalSecurityEventStoredEvent.class).map(CriticalSecurityEventStoredEvent::eventId))
				.containsExactly(onTime);
	}

	/**
	 * A long purge runs on the scheduler thread; with Boot's default pool of 1
	 * it would hold back the SSE heartbeat (CriticalEventBroadcaster) meanwhile.
	 */
	@Test
	void schedulerHasRoomForPurgeAndHeartbeat() {
		assertThat(taskScheduler.getPoolSize()).isGreaterThanOrEqualTo(2);
	}

	@Test
	void batch_resendOfStoredEventPastRetentionCountsAsDuplicate() {
		UUID id = insertEvent(CUTOFF.minusSeconds(1));

		var response = restTemplate.postForEntity(
				"/internal/security-events/batch", batch(List.of(event(id, CUTOFF.minusSeconds(1), "INFO", null))), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody())
				.containsEntry("acceptedCount", 0)
				.containsEntry("duplicateCount", 1)
				.containsEntry("expiredCount", 0);
	}

	private UUID insertEvent(Instant occurredAt) {
		UUID id = UUID.randomUUID();
		jdbcTemplate.update("""
				INSERT INTO security_event (id, occurred_at, type, severity, decision, reason_code, trace_id, created_at)
				VALUES (?, ?, 'ACCESS', 'INFO', 'ALLOWED', 'REQUEST_ALLOWED', 'trace', ?)
				""", id, Timestamp.from(occurredAt), Timestamp.from(NOW));
		return id;
	}

	/** {@code count} Events ending at {@code newest}, one second apart going back. */
	private void insertEvents(int count, Instant newest) {
		jdbcTemplate.update("""
				INSERT INTO security_event (id, occurred_at, type, severity, decision, reason_code, trace_id, created_at)
				SELECT gen_random_uuid(), ?::timestamptz - ((g - 1) * interval '1 second'), 'ACCESS', 'INFO', 'ALLOWED',
					'REQUEST_ALLOWED', 'trace', ?::timestamptz
				FROM generate_series(1, ?::int) g
				""", Timestamp.from(newest), Timestamp.from(NOW), count);
	}

	private static SecurityEventBatchRequest.EventPayload criticalPayload(UUID id, Instant occurredAt) {
		return new SecurityEventBatchRequest.EventPayload(
				id, occurredAt, "ACCESS", "CRITICAL", null, null, null, null, "DENIED", "CERTIFICATE_REVOKED", null, null,
				UUID.randomUUID().toString());
	}

	private Map<String, Object> event(UUID id, Instant occurredAt, String severity, String deviceId) {
		Map<String, Object> event = new HashMap<>();
		event.put("id", id.toString());
		event.put("occurredAt", occurredAt.toString());
		event.put("type", "ACCESS");
		event.put("severity", severity);
		event.put("decision", "ALLOWED");
		event.put("reasonCode", "REQUEST_ALLOWED");
		event.put("traceId", UUID.randomUUID().toString());
		if (deviceId != null) {
			event.put("deviceId", deviceId);
		}
		return event;
	}

	private HttpEntity<Map<String, Object>> batch(List<Map<String, Object>> events) {
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(SERVICE_TOKEN);
		headers.setContentType(MediaType.APPLICATION_JSON);
		return new HttpEntity<>(Map.of("events", events), headers);
	}

	private String registerDevice(String deviceKey) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test " + deviceKey, "roleName", "SENSOR"), Map.class);
		return response.getBody().get("id").toString();
	}
}
