package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
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
 * Uses a deliberately broken Intermediate CA key path (its own Spring
 * context, isolated from the other CA-backed test classes) so every approve
 * attempt fails with CA_SIGNING_FAILED — verifying docs/architecture.md
 * "CA 서명 실패는 CertificateRequest를 APPROVED로 바꾸지 않고 CRITICAL
 * Event 기록": the CertificateRequest stays PENDING, and the CRITICAL
 * Security Event still persists even though EnrollmentService#approve's own
 * Transaction rolls back (SecurityEventRecorder#recordCritical runs in its
 * own REQUIRES_NEW Transaction).
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class CaSigningFailureIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void brokenCaProperties(DynamicPropertyRegistry registry) throws Exception {
		var dir = java.nio.file.Files.createTempDirectory("certgate-ca-signing-failure-test");
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		// Deliberately wrong: readPrivateKey() will fail every time loadCaMaterial() is called.
		registry.add("certgate.ca.intermediate-key-path", () -> dir.resolve("does-not-exist.key").toString());

		// Issue #30: the default Pool (10) is large enough that a regression
		// where the outer approve() Transaction holds its Connection while
		// waiting on SecurityEventRecorder's REQUIRES_NEW Connection would
		// still pass here by accident. Pool=1 makes that specific bug
		// deterministically fail with a Connection-timeout instead.
		registry.add("spring.datasource.hikari.maximum-pool-size", () -> "1");
		registry.add("spring.datasource.hikari.connection-timeout", () -> "2000");
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@Test
	void approve_caSigningFailure_keepsRequestPendingAndRecordsCriticalEvent() throws Exception {
		var registerResponse = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", "sensor-ca-fail-01", "name", "Test Device", "roleName", "SENSOR"), Map.class);
		String token = (String) registerResponse.getBody().get("enrollmentToken");
		String deviceId = registerResponse.getBody().get("id").toString();

		String csrPem = TestCaFixture.createDeviceCsrPem("sensor-ca-fail-01", TestCaFixture.generateEcKeyPair());
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(token);
		headers.setContentType(MediaType.APPLICATION_JSON);
		var submitResponse = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrPem), headers), Map.class);
		String requestId = (String) submitResponse.getBody().get("id");

		var approveResponse = restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/approve", null, Map.class);
		assertThat(approveResponse.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
		assertThat(approveResponse.getBody().get("code")).isEqualTo("CA_SIGNING_FAILED");

		var detail = restTemplate.getForEntity("/api/v1/certificate-requests/" + requestId, Map.class);
		assertThat(detail.getBody().get("status")).isEqualTo("PENDING");

		var events = restTemplate.getForEntity("/api/v1/security-events?severity=CRITICAL&deviceId=" + deviceId, Map.class);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> content = (List<Map<String, Object>>) events.getBody().get("content");
		assertThat(content).extracting(e -> e.get("reasonCode")).contains("CA_SIGNING_FAILED");
	}
}
