package tech.certgate.policy;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
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
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tech.certgate.enrollment.TestCaFixture;

/**
 * Exercises GET /internal/access-context (docs/api-spec.md §7), the API the
 * Gateway calls per request to decide ALLOW/DENY (docs/security-design.md §5).
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class AccessContextIntegrationTests {

	private static final String SERVICE_TOKEN = "test-gateway-service-token";

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) throws Exception {
		Path dir = Files.createTempDirectory("certgate-access-context-test-ca");
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		registry.add("certgate.ca.intermediate-key-path", () -> ca.intermediateKeyPath().toString());
		registry.add("certgate.gateway.service-token", () -> SERVICE_TOKEN);
	}

	@Autowired
	private TestRestTemplate restTemplate;

	private HttpHeaders serviceTokenHeaders() {
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(SERVICE_TOKEN);
		return headers;
	}

	private String issueCertificateFor(String deviceKey) throws Exception {
		return issueCertificateFor(deviceKey, "SENSOR");
	}

	/** Registers a Device, runs it through CSR submit + approve, and returns its issued Certificate's serial number. */
	private String issueCertificateFor(String deviceKey, String roleName) throws Exception {
		var registerResponse = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test Device", "roleName", roleName), Map.class);
		String token = (String) registerResponse.getBody().get("enrollmentToken");

		KeyPair deviceKeyPair = TestCaFixture.generateEcKeyPair();
		String csrPem = TestCaFixture.createDeviceCsrPem(deviceKey, deviceKeyPair);

		HttpHeaders enrollmentHeaders = new HttpHeaders();
		enrollmentHeaders.setBearerAuth(token);
		enrollmentHeaders.setContentType(MediaType.APPLICATION_JSON);
		var submitResponse = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", csrPem), enrollmentHeaders), Map.class);
		String requestId = (String) submitResponse.getBody().get("id");

		restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/approve", null, Map.class);

		var certResponse = restTemplate.exchange(
				"/api/v1/enrollments/certificate-requests/" + requestId + "/certificate", HttpMethod.GET,
				new HttpEntity<>(enrollmentHeaders), Map.class);
		return (String) certResponse.getBody().get("serialNumber");
	}

	@Test
	void accessContext_returnsCertificateDeviceAndRoleRules() throws Exception {
		String serialNumber = issueCertificateFor("sensor-access-ctx-01");

		var response = restTemplate.exchange(
				"/internal/access-context?serialNumber=" + serialNumber, HttpMethod.GET,
				new HttpEntity<>(serviceTokenHeaders()), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		Map<String, Object> body = response.getBody();
		assertThat(body.get("serialNumber")).isEqualTo(serialNumber);
		assertThat(body.get("certificateStatus")).isEqualTo("VALID");
		assertThat(body.get("deviceKey")).isEqualTo("sensor-access-ctx-01");
		assertThat(body.get("deviceStatus")).isEqualTo("ACTIVE");
		assertThat(body.get("roleName")).isEqualTo("SENSOR");

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> rules = (List<Map<String, Object>>) body.get("rules");
		assertThat(rules).extracting(r -> r.get("pathPattern")).containsExactlyInAnyOrder("/telemetry", "/heartbeat");
	}

	@Test
	void accessContext_operatorRoleIncludesCommandsRule() throws Exception {
		String serialNumber = issueCertificateFor("operator-access-ctx-01", "OPERATOR");

		var response = restTemplate.exchange(
				"/internal/access-context?serialNumber=" + serialNumber, HttpMethod.GET,
				new HttpEntity<>(serviceTokenHeaders()), Map.class);

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> rules = (List<Map<String, Object>>) response.getBody().get("rules");
		assertThat(rules).extracting(r -> r.get("pathPattern")).containsExactlyInAnyOrder("/telemetry", "/heartbeat", "/commands");
	}

	@Test
	void accessContext_withoutServiceToken_isRejected() throws Exception {
		String serialNumber = issueCertificateFor("sensor-access-ctx-no-token");

		var response = restTemplate.getForEntity("/internal/access-context?serialNumber=" + serialNumber, Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(response.getBody().get("code")).isEqualTo("SERVICE_TOKEN_INVALID");
	}

	@Test
	void accessContext_withWrongServiceToken_isRejected() throws Exception {
		String serialNumber = issueCertificateFor("sensor-access-ctx-wrong-token");

		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth("not-the-real-token");
		var response = restTemplate.exchange(
				"/internal/access-context?serialNumber=" + serialNumber, HttpMethod.GET, new HttpEntity<>(headers), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(response.getBody().get("code")).isEqualTo("SERVICE_TOKEN_INVALID");
	}

	@Test
	void accessContext_unknownSerialNumber_returnsNotFound() {
		var response = restTemplate.exchange(
				"/internal/access-context?serialNumber=DOES-NOT-EXIST", HttpMethod.GET,
				new HttpEntity<>(serviceTokenHeaders()), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("CERTIFICATE_NOT_FOUND");
	}
}
