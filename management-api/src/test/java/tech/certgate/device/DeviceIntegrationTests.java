package tech.certgate.device;

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

/** Exercises the Device query/status/Role/Token-reissue API (docs/api-spec.md §3). */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class DeviceIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void caProperties(DynamicPropertyRegistry registry) throws Exception {
		Path dir = Files.createTempDirectory("certgate-device-test-ca");
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		registry.add("certgate.ca.intermediate-key-path", () -> ca.intermediateKeyPath().toString());
	}

	@Autowired
	private TestRestTemplate restTemplate;

	private Map<String, Object> registerDevice(String deviceKey, String roleName) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test " + deviceKey, "roleName", roleName), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		@SuppressWarnings("unchecked")
		Map<String, Object> body = response.getBody();
		return body;
	}

	@Test
	void register_missingFields_areRejectedNotServerError() {
		var missingKey = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("name", "n", "roleName", "SENSOR"), Map.class);
		assertThat(missingKey.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(missingKey.getBody().get("code")).isEqualTo("DEVICE_KEY_REQUIRED");

		var missingName = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", "d-1", "roleName", "SENSOR"), Map.class);
		assertThat(missingName.getBody().get("code")).isEqualTo("DEVICE_NAME_REQUIRED");

		var missingRole = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", "d-2", "name", "n"), Map.class);
		assertThat(missingRole.getBody().get("code")).isEqualTo("ROLE_NAME_REQUIRED");
	}

	@Test
	void register_unknownRole_isBadRequest() {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", "d-unknown-role", "name", "n", "roleName", "NOT_A_ROLE"), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("ROLE_NOT_FOUND");
	}

	@Test
	void register_duplicateDeviceKey_isConflict() {
		registerDevice("d-dup", "SENSOR");
		var second = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", "d-dup", "name", "n2", "roleName", "SENSOR"), Map.class);
		assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(second.getBody().get("code")).isEqualTo("DEVICE_KEY_DUPLICATE");
	}

	@Test
	void list_filtersByStatusAndRole() {
		Map<String, Object> sensor = registerDevice("d-list-sensor", "SENSOR");
		registerDevice("d-list-operator", "OPERATOR");
		restTemplate.exchange(
				"/api/v1/devices/" + sensor.get("id") + "/status", HttpMethod.PATCH,
				new HttpEntity<>(Map.of("status", "DISABLED")), Map.class);

		var operatorsOnly = restTemplate.getForEntity("/api/v1/devices?roleName=OPERATOR", Map.class);
		List<Map<String, Object>> operatorContent = content(operatorsOnly);
		assertThat(operatorContent).extracting(d -> d.get("deviceKey")).contains("d-list-operator");
		assertThat(operatorContent).extracting(d -> d.get("deviceKey")).doesNotContain("d-list-sensor");

		var disabledOnly = restTemplate.getForEntity("/api/v1/devices?status=DISABLED", Map.class);
		List<Map<String, Object>> disabledContent = content(disabledOnly);
		assertThat(disabledContent).extracting(d -> d.get("deviceKey")).contains("d-list-sensor");
	}

	@Test
	void list_queryMatchesDeviceKeyCaseInsensitive() {
		registerDevice("d-search-target", "SENSOR");
		var response = restTemplate.getForEntity("/api/v1/devices?query=SEARCH-TARGET", Map.class);
		assertThat(content(response)).extracting(d -> d.get("deviceKey")).contains("d-search-target");
	}

	@Test
	void list_invalidStatusQueryParam_isBadRequestNotServerError() {
		var response = restTemplate.getForEntity("/api/v1/devices?status=NOT_A_STATUS", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("INVALID_REQUEST_PARAMETER");
	}

	@Test
	void list_unknownSortField_isBadRequestNotSilentlyIgnored() {
		var response = restTemplate.getForEntity("/api/v1/devices?sort=notAField,asc", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("INVALID_REQUEST_PARAMETER");
	}

	@Test
	void list_unknownSortDirection_isBadRequestNotSilentlyCoercedToAsc() {
		var response = restTemplate.getForEntity("/api/v1/devices?sort=name,descending", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("INVALID_REQUEST_PARAMETER");
	}

	@Test
	void list_sortFieldOnlyOmittingDirection_defaultsToAscending() {
		registerDevice("d-sort-a", "SENSOR");
		registerDevice("d-sort-b", "SENSOR");

		var response = restTemplate.getForEntity("/api/v1/devices?sort=deviceKey", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
	}

	@Test
	void get_returnsDetailWithPolicyRulesAndNoCertificateYet() {
		Map<String, Object> device = registerDevice("d-detail", "OPERATOR");
		var response = restTemplate.getForEntity("/api/v1/devices/" + device.get("id"), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("certificate")).isNull();
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> rules = (List<Map<String, Object>>) response.getBody().get("policyRules");
		assertThat(rules).isNotEmpty();
		assertThat(rules).extracting(r -> r.get("pathPattern")).contains("/commands");
	}

	@Test
	void get_unknownDevice_isNotFound() {
		var response = restTemplate.getForEntity("/api/v1/devices/" + java.util.UUID.randomUUID(), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("DEVICE_NOT_REGISTERED");
	}

	@Test
	void get_afterCertificateIssued_includesCertificateSummary() throws Exception {
		Map<String, Object> device = registerDevice("d-detail-with-cert", "SENSOR");
		String token = (String) device.get("enrollmentToken");
		KeyPair keyPair = TestCaFixture.generateEcKeyPair();
		String csrPem = TestCaFixture.createDeviceCsrPem("d-detail-with-cert", keyPair);

		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(token);
		headers.setContentType(MediaType.APPLICATION_JSON);
		var submit = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrPem), headers), Map.class);
		String requestId = (String) submit.getBody().get("id");
		restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/approve", null, Map.class);

		var response = restTemplate.getForEntity("/api/v1/devices/" + device.get("id"), Map.class);
		@SuppressWarnings("unchecked")
		Map<String, Object> certificate = (Map<String, Object>) response.getBody().get("certificate");
		assertThat(certificate).isNotNull();
		assertThat(certificate.get("status")).isEqualTo("VALID");
	}

	@Test
	void updateStatus_disablesAndReEnablesDevice() {
		Map<String, Object> device = registerDevice("d-status", "SENSOR");

		var disabled = restTemplate.exchange(
				"/api/v1/devices/" + device.get("id") + "/status", HttpMethod.PATCH,
				new HttpEntity<>(Map.of("status", "DISABLED")), Map.class);
		assertThat(disabled.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(disabled.getBody().get("status")).isEqualTo("DISABLED");

		var reEnabled = restTemplate.exchange(
				"/api/v1/devices/" + device.get("id") + "/status", HttpMethod.PATCH,
				new HttpEntity<>(Map.of("status", "ACTIVE")), Map.class);
		assertThat(reEnabled.getBody().get("status")).isEqualTo("ACTIVE");
	}

	@Test
	void updateStatus_unknownDevice_isNotFound() {
		var response = restTemplate.exchange(
				"/api/v1/devices/" + java.util.UUID.randomUUID() + "/status", HttpMethod.PATCH,
				new HttpEntity<>(Map.of("status", "DISABLED")), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("DEVICE_NOT_REGISTERED");
	}

	@Test
	void updateRole_changesRoleAndReflectsInDetailPolicyRules() {
		Map<String, Object> device = registerDevice("d-role", "SENSOR");

		var response = restTemplate.exchange(
				"/api/v1/devices/" + device.get("id") + "/role", HttpMethod.PUT,
				new HttpEntity<>(Map.of("roleName", "OPERATOR")), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("roleName")).isEqualTo("OPERATOR");

		var detail = restTemplate.getForEntity("/api/v1/devices/" + device.get("id"), Map.class);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> rules = (List<Map<String, Object>>) detail.getBody().get("policyRules");
		assertThat(rules).extracting(r -> r.get("pathPattern")).contains("/commands");
	}

	@Test
	void updateRole_unknownRole_isBadRequest() {
		Map<String, Object> device = registerDevice("d-role-unknown", "SENSOR");
		var response = restTemplate.exchange(
				"/api/v1/devices/" + device.get("id") + "/role", HttpMethod.PUT,
				new HttpEntity<>(Map.of("roleName", "NOT_A_ROLE")), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("ROLE_NOT_FOUND");
	}

	@Test
	void reissueToken_revokesOldTokenAndIssuesWorkingNewOne() throws Exception {
		Map<String, Object> device = registerDevice("d-reissue", "SENSOR");
		String oldToken = (String) device.get("enrollmentToken");

		var reissued = restTemplate.postForEntity("/api/v1/devices/" + device.get("id") + "/enrollment-token", null, Map.class);
		assertThat(reissued.getStatusCode()).isEqualTo(HttpStatus.OK);
		String newToken = (String) reissued.getBody().get("enrollmentToken");
		assertThat(newToken).isNotEqualTo(oldToken);

		String csrPem = TestCaFixture.createDeviceCsrPem("d-reissue", TestCaFixture.generateEcKeyPair());

		HttpHeaders oldHeaders = new HttpHeaders();
		oldHeaders.setBearerAuth(oldToken);
		oldHeaders.setContentType(MediaType.APPLICATION_JSON);
		var withOldToken = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrPem), oldHeaders), Map.class);
		assertThat(withOldToken.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

		HttpHeaders newHeaders = new HttpHeaders();
		newHeaders.setBearerAuth(newToken);
		newHeaders.setContentType(MediaType.APPLICATION_JSON);
		var withNewToken = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrPem), newHeaders), Map.class);
		assertThat(withNewToken.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
	}

	@Test
	void reissueToken_unknownDevice_isNotFound() {
		var response = restTemplate.postForEntity(
				"/api/v1/devices/" + java.util.UUID.randomUUID() + "/enrollment-token", null, Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("DEVICE_NOT_REGISTERED");
	}

	@SuppressWarnings("unchecked")
	private static List<Map<String, Object>> content(org.springframework.http.ResponseEntity<Map> response) {
		return (List<Map<String, Object>>) response.getBody().get("content");
	}
}
