package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Reissuing a Device's Enrollment Token rejects the PENDING CSR submitted
 * under the previous Token (ADR-005). Without this the old request would
 * keep blocking the new Token's CSR as a duplicate, and an administrator
 * could still approve a key that came in under the Token they just replaced.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class TokenReissuePendingRequestIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void caProperties(DynamicPropertyRegistry registry) throws Exception {
		var dir = java.nio.file.Files.createTempDirectory("certgate-test-ca");
		var ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		registry.add("certgate.ca.intermediate-key-path", () -> ca.intermediateKeyPath().toString());
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@MockitoSpyBean
	private IntermediateCertificateAuthority certificateAuthority;

	private Map<String, Object> registerDevice(String deviceKey) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test Sensor", "roleName", "SENSOR"), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		@SuppressWarnings("unchecked")
		Map<String, Object> body = response.getBody();
		return body;
	}

	private String reissueToken(Object deviceId) {
		var response = restTemplate.postForEntity("/api/v1/devices/" + deviceId + "/enrollment-token", null, Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		return (String) response.getBody().get("enrollmentToken");
	}

	private ResponseEntity<Map> submitCsr(String token, String deviceKey) throws Exception {
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(token);
		headers.setContentType(MediaType.APPLICATION_JSON);
		String csrPem = TestCaFixture.createDeviceCsrPem(deviceKey, TestCaFixture.generateEcKeyPair());
		return restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrPem), headers), Map.class);
	}

	private String submitPendingCsr(String token, String deviceKey) throws Exception {
		var response = submitCsr(token, deviceKey);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
		return (String) response.getBody().get("id");
	}

	private Map<String, Object> getRequest(String requestId) {
		var response = restTemplate.getForEntity("/api/v1/certificate-requests/" + requestId, Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		@SuppressWarnings("unchecked")
		Map<String, Object> body = response.getBody();
		return body;
	}

	private ResponseEntity<Map> decide(String requestId, String decision) {
		return restTemplate.postForEntity(
				"/api/v1/certificate-requests/" + requestId + "/" + decision, Map.of("decisionNote", "test"), Map.class);
	}

	@Test
	void reissue_rejectsThePendingRequestSubmittedUnderThePreviousToken() throws Exception {
		Map<String, Object> device = registerDevice("reissue-pending-reject");
		String requestId = submitPendingCsr((String) device.get("enrollmentToken"), "reissue-pending-reject");

		reissueToken(device.get("id"));

		Map<String, Object> request = getRequest(requestId);
		assertThat(request.get("status")).isEqualTo("REJECTED");
		assertThat(request.get("decidedAt")).isNotNull();
		assertThat(request.get("decisionNote")).isEqualTo("Enrollment Token 재발급으로 자동 거절");
	}

	@Test
	void reissue_letsTheNewTokenSubmitInsteadOfHittingTheDuplicateCheck() throws Exception {
		Map<String, Object> device = registerDevice("reissue-pending-resubmit");
		submitPendingCsr((String) device.get("enrollmentToken"), "reissue-pending-resubmit");

		String newToken = reissueToken(device.get("id"));
		var response = submitCsr(newToken, "reissue-pending-resubmit");

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
		assertThat(response.getBody().get("status")).isEqualTo("PENDING");
	}

	@Test
	void reissue_leavesTheOldRequestUnapprovable() throws Exception {
		Map<String, Object> device = registerDevice("reissue-pending-approve");
		String requestId = submitPendingCsr((String) device.get("enrollmentToken"), "reissue-pending-approve");

		reissueToken(device.get("id"));
		var approval = decide(requestId, "approve");

		assertThat(approval.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(approval.getBody().get("code")).isEqualTo("CERTIFICATE_REQUEST_NOT_PENDING");
		assertThat(getRequest(requestId).get("status")).isEqualTo("REJECTED");
	}

	@Test
	void reissue_leavesDecidedRequestsAndOtherDevicesUntouched() throws Exception {
		Map<String, Object> device = registerDevice("reissue-pending-decided");
		String approvedId = submitPendingCsr((String) device.get("enrollmentToken"), "reissue-pending-decided");
		assertThat(decide(approvedId, "approve").getStatusCode()).isEqualTo(HttpStatus.OK);
		Map<String, Object> other = registerDevice("reissue-pending-other");
		String otherPendingId = submitPendingCsr((String) other.get("enrollmentToken"), "reissue-pending-other");

		reissueToken(device.get("id"));

		Map<String, Object> approved = getRequest(approvedId);
		assertThat(approved.get("status")).isEqualTo("APPROVED");
		assertThat(approved.get("decisionNote")).isEqualTo("test");
		assertThat(getRequest(otherPendingId).get("status")).isEqualTo("PENDING");
	}
}
