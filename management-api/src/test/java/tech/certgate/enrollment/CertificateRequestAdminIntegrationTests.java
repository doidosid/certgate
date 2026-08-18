package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
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

/** Exercises the admin CSR list/detail/reject endpoints (docs/api-spec.md §4 "관리자 CSR 관리"). */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class CertificateRequestAdminIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void caProperties(DynamicPropertyRegistry registry) throws Exception {
		Path dir = Files.createTempDirectory("certgate-csr-admin-test-ca");
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		registry.add("certgate.ca.intermediate-key-path", () -> ca.intermediateKeyPath().toString());
	}

	@Autowired
	private TestRestTemplate restTemplate;

	private String submitCsrFor(String deviceKey) throws Exception {
		var registerResponse = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test Device", "roleName", "SENSOR"), Map.class);
		String token = (String) registerResponse.getBody().get("enrollmentToken");

		String csrPem = TestCaFixture.createDeviceCsrPem(deviceKey, TestCaFixture.generateEcKeyPair());
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(token);
		headers.setContentType(MediaType.APPLICATION_JSON);
		var submitResponse = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrPem), headers), Map.class);
		return (String) submitResponse.getBody().get("id");
	}

	@Test
	void reject_setsRejectedStatusAndDecisionNote() throws Exception {
		String requestId = submitCsrFor("sensor-reject-01");

		var response = restTemplate.postForEntity(
				"/api/v1/certificate-requests/" + requestId + "/reject",
				Map.of("decisionNote", "CSR 정책 위반"), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("status")).isEqualTo("REJECTED");

		var detail = restTemplate.getForEntity("/api/v1/certificate-requests/" + requestId, Map.class);
		assertThat(detail.getBody().get("status")).isEqualTo("REJECTED");
		assertThat(detail.getBody().get("decisionNote")).isEqualTo("CSR 정책 위반");
	}

	@Test
	void reject_alreadyDecided_isConflict() throws Exception {
		String requestId = submitCsrFor("sensor-reject-twice-01");
		restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/reject", null, Map.class);

		var second = restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/reject", null, Map.class);

		assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(second.getBody().get("code")).isEqualTo("CERTIFICATE_REQUEST_NOT_PENDING");
	}

	@Test
	void approve_afterReject_isConflict() throws Exception {
		String requestId = submitCsrFor("sensor-reject-then-approve-01");
		restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/reject", null, Map.class);

		var approve = restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/approve", null, Map.class);

		assertThat(approve.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(approve.getBody().get("code")).isEqualTo("CERTIFICATE_REQUEST_NOT_PENDING");
	}

	/**
	 * Regression test for the Codex 리뷰 PR #26 Critical finding: concurrent
	 * approve+reject on the same PENDING request must not both succeed. Without
	 * the row lock in {@code requireRequestForUpdate}, the losing decision could
	 * commit after the winner already signed and stored a Certificate, leaving
	 * a REJECTED request with a real, downloadable Certificate.
	 */
	@Test
	void approveAndReject_concurrent_onlyOneSucceeds() throws Exception {
		String requestId = submitCsrFor("sensor-approve-reject-race-01");
		CyclicBarrier barrier = new CyclicBarrier(2);
		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			var approveFuture = CompletableFuture.supplyAsync(() -> decisionAfterBarrier(requestId, "approve", barrier), executor);
			var rejectFuture = CompletableFuture.supplyAsync(() -> decisionAfterBarrier(requestId, "reject", barrier), executor);
			var responses = List.of(approveFuture.get(), rejectFuture.get());

			assertThat(responses).extracting(r -> r.getStatusCode())
					.containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);

			var detail = restTemplate.getForEntity("/api/v1/certificate-requests/" + requestId, Map.class);
			String finalStatus = (String) detail.getBody().get("status");
			assertThat(finalStatus).isIn("APPROVED", "REJECTED");

			var certificatesResponse = restTemplate.getForEntity(
					"/api/v1/certificates?deviceId=" + detail.getBody().get("deviceId"), Map.class);
			@SuppressWarnings("unchecked")
			List<Map<String, Object>> certificates = (List<Map<String, Object>>) certificatesResponse.getBody().get("content");

			// The invariant this fix protects: a REJECTED request must never have
			// a real Certificate row, and an APPROVED one must have exactly one.
			if ("REJECTED".equals(finalStatus)) {
				assertThat(certificates).isEmpty();
			} else {
				assertThat(certificates).hasSize(1);
			}
		} finally {
			executor.shutdownNow();
		}
	}

	private ResponseEntity<Map> decisionAfterBarrier(String requestId, String decision, CyclicBarrier barrier) {
		try {
			barrier.await();
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
		return restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/" + decision, null, Map.class);
	}

	@Test
	void reject_unknownRequestId_isNotFound() {
		var response = restTemplate.postForEntity(
				"/api/v1/certificate-requests/" + java.util.UUID.randomUUID() + "/reject", null, Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("CERTIFICATE_REQUEST_NOT_FOUND");
	}

	@Test
	void get_returnsDetailWithoutCsrPem() throws Exception {
		String requestId = submitCsrFor("sensor-detail-01");

		var response = restTemplate.getForEntity("/api/v1/certificate-requests/" + requestId, Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("status")).isEqualTo("PENDING");
		assertThat(response.getBody().get("sanUri")).isEqualTo("urn:certgate:device:sensor-detail-01");
		assertThat(response.getBody()).doesNotContainKey("csrPem");
	}

	@Test
	void get_unknownRequestId_isNotFound() {
		var response = restTemplate.getForEntity("/api/v1/certificate-requests/" + java.util.UUID.randomUUID(), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("CERTIFICATE_REQUEST_NOT_FOUND");
	}

	@Test
	void list_filtersByStatus() throws Exception {
		String pendingId = submitCsrFor("sensor-list-pending-01");
		String rejectedId = submitCsrFor("sensor-list-rejected-01");
		restTemplate.postForEntity("/api/v1/certificate-requests/" + rejectedId + "/reject", null, Map.class);

		var response = restTemplate.getForEntity("/api/v1/certificate-requests?status=REJECTED", Map.class);

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> content = (List<Map<String, Object>>) response.getBody().get("content");
		assertThat(content).extracting(r -> r.get("id")).contains(rejectedId).doesNotContain(pendingId);
	}

	@Test
	void list_invalidStatusQueryParam_isBadRequestNotServerError() {
		var response = restTemplate.getForEntity("/api/v1/certificate-requests?status=NOT_A_STATUS", Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("INVALID_REQUEST_PARAMETER");
	}
}
