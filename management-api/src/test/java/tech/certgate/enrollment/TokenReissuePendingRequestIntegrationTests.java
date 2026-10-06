package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
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
import org.springframework.jdbc.core.JdbcTemplate;
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

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private DataSource dataSource;

	@MockitoSpyBean
	private IntermediateCertificateAuthority certificateAuthority;

	@MockitoSpyBean
	private CsrValidator csrValidator;

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

	@Test
	void reissue_leavesAnAdministratorRejectionAsItWas() throws Exception {
		Map<String, Object> device = registerDevice("reissue-pending-rejected");
		String rejectedId = submitPendingCsr((String) device.get("enrollmentToken"), "reissue-pending-rejected");
		assertThat(decide(rejectedId, "reject").getStatusCode()).isEqualTo(HttpStatus.OK);
		Object decidedAt = getRequest(rejectedId).get("decidedAt");

		reissueToken(device.get("id"));

		Map<String, Object> rejected = getRequest(rejectedId);
		assertThat(rejected.get("status")).isEqualTo("REJECTED");
		assertThat(rejected.get("decisionNote")).isEqualTo("test");
		assertThat(rejected.get("decidedAt")).isEqualTo(decidedAt);
	}

	/**
	 * A reissue that runs while an approve of the same request is inside its
	 * locked Transaction must wait for it and then leave the APPROVED request
	 * alone. Without the Row Lock in findByDeviceIdAndStatusForUpdate the reissue
	 * reads the request as PENDING and its REJECTED update lands after approve
	 * commits, leaving a REJECTED request with a real Certificate. Waiting for
	 * the reissue to show up as a Lock waiter proves it read the request while
	 * approve was still uncommitted, with or without that Row Lock.
	 */
	@Test
	void reissue_duringApprove_waitsAndLeavesTheApprovedRequest() throws Exception {
		Map<String, Object> device = registerDevice("reissue-pending-race");
		String requestId = submitPendingCsr((String) device.get("enrollmentToken"), "reissue-pending-race");
		CountDownLatch signingStarted = new CountDownLatch(1);
		CountDownLatch releaseSigning = new CountDownLatch(1);
		doAnswer(invocation -> {
			signingStarted.countDown();
			if (!releaseSigning.await(5, TimeUnit.SECONDS)) {
				throw new AssertionError("releaseSigning was never released");
			}
			return invocation.callRealMethod();
		}).when(certificateAuthority).sign(any());

		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			var approveFuture = CompletableFuture.supplyAsync(() -> decide(requestId, "approve"), executor);
			assertThat(signingStarted.await(5, TimeUnit.SECONDS)).as("approve() reached the CA-signing step").isTrue();

			var reissueFuture = CompletableFuture.supplyAsync(() -> reissueToken(device.get("id")), executor);
			awaitLockWaiters(1);
			assertThat(reissueFuture).as("reissue must block on the Row Lock approve() holds").isNotDone();

			releaseSigning.countDown();
			assertThat(approveFuture.get(5, TimeUnit.SECONDS).getStatusCode()).isEqualTo(HttpStatus.OK);
			assertThat(reissueFuture.get(5, TimeUnit.SECONDS)).isNotBlank();
		} finally {
			executor.shutdownNow();
		}

		Map<String, Object> request = getRequest(requestId);
		assertThat(request.get("status")).isEqualTo("APPROVED");
		assertThat(request.get("decisionNote")).isEqualTo("test");
		var certificates = restTemplate.getForEntity("/api/v1/certificates?deviceId=" + device.get("id"), Map.class);
		assertThat((List<?>) certificates.getBody().get("content")).hasSize(1);
	}

	/**
	 * Reissue holds the revoked credential's row lock when a CSR arrives under
	 * the old Token. The submission must wait in resolve() and then fail as an
	 * invalid Token (api-spec.md), not as a duplicate of the request the reissue
	 * is about to reject or as the reissue-only ENROLLMENT_TOKEN_CONFLICT.
	 *
	 * The test pauses the reissue after its revoke by holding the old PENDING
	 * request's row lock on its own Connection, so the reissue waits in
	 * findByDeviceIdAndStatusForUpdate.
	 */
	@Test
	void submitUnderOldToken_duringReissue_waitsAndFailsAsInvalidToken() throws Exception {
		Map<String, Object> device = registerDevice("reissue-submit-race-1");
		String oldToken = (String) device.get("enrollmentToken");
		String pendingId = submitPendingCsr(oldToken, "reissue-submit-race-1");

		ExecutorService executor = Executors.newFixedThreadPool(2);
		ResponseEntity<Map> submission;
		String newToken;
		try (Connection blocker = dataSource.getConnection()) {
			blocker.setAutoCommit(false);
			try (var lock = blocker.prepareStatement("SELECT id FROM certificate_request WHERE id = ? FOR UPDATE")) {
				lock.setObject(1, java.util.UUID.fromString(pendingId));
				lock.executeQuery().close();
			}
			try {
				var reissueFuture = CompletableFuture.supplyAsync(() -> reissueToken(device.get("id")), executor);
				awaitLockWaiters(1);

				var submitFuture = CompletableFuture.supplyAsync(() -> submitCsrUnchecked(oldToken, "reissue-submit-race-1"), executor);
				awaitLockWaiters(2);

				blocker.rollback();
				newToken = reissueFuture.get(5, TimeUnit.SECONDS);
				submission = submitFuture.get(5, TimeUnit.SECONDS);
			} finally {
				executor.shutdownNow();
			}
		}

		assertThat(submission.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(submission.getBody().get("code")).isEqualTo("ENROLLMENT_TOKEN_INVALID");
		assertThat(requestCount(device.get("id"))).isEqualTo(1);
		assertThat(getRequest(pendingId).get("status")).isEqualTo("REJECTED");
		assertThat(activeCredentialCount(device.get("id"))).isEqualTo(1);
		assertThat(submitCsr(newToken, "reissue-submit-race-1").getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
	}

	/**
	 * The other order: a CSR submission under the old Token is between resolve()
	 * and commit when the reissue starts. The reissue's revoke must wait for it
	 * and then find and reject the request it committed.
	 */
	@Test
	void reissue_duringSubmitUnderOldToken_waitsAndRejectsTheSubmittedRequest() throws Exception {
		Map<String, Object> device = registerDevice("reissue-submit-race-2");
		String oldToken = (String) device.get("enrollmentToken");
		CountDownLatch submitResolved = new CountDownLatch(1);
		CountDownLatch releaseSubmit = new CountDownLatch(1);
		doAnswer(invocation -> {
			submitResolved.countDown();
			if (!releaseSubmit.await(5, TimeUnit.SECONDS)) {
				throw new AssertionError("releaseSubmit was never released");
			}
			return invocation.callRealMethod();
		}).when(csrValidator).validate(any(), any());

		ExecutorService executor = Executors.newFixedThreadPool(2);
		ResponseEntity<Map> submission;
		String newToken;
		try {
			var submitFuture = CompletableFuture.supplyAsync(() -> submitCsrUnchecked(oldToken, "reissue-submit-race-2"), executor);
			assertThat(submitResolved.await(5, TimeUnit.SECONDS)).as("submit resolved the old Token").isTrue();

			var reissueFuture = CompletableFuture.supplyAsync(() -> reissueToken(device.get("id")), executor);
			awaitLockWaiters(1);

			releaseSubmit.countDown();
			submission = submitFuture.get(5, TimeUnit.SECONDS);
			newToken = reissueFuture.get(5, TimeUnit.SECONDS);
		} finally {
			executor.shutdownNow();
		}

		assertThat(submission.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
		Map<String, Object> request = getRequest((String) submission.getBody().get("id"));
		assertThat(request.get("status")).isEqualTo("REJECTED");
		assertThat(request.get("decisionNote")).isEqualTo(EnrollmentTokenService.REISSUE_REJECTION_NOTE);
		assertThat(activeCredentialCount(device.get("id"))).isEqualTo(1);
		assertThat(submitCsr(newToken, "reissue-submit-race-2").getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
	}

	private ResponseEntity<Map> submitCsrUnchecked(String token, String deviceKey) {
		try {
			return submitCsr(token, deviceKey);
		} catch (Exception e) {
			throw new IllegalStateException(e);
		}
	}

	/** Waits until {@code count} other Transactions are blocked on a Row Lock in Postgres. */
	private void awaitLockWaiters(int count) throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (System.nanoTime() < deadline) {
			Integer waiters = jdbcTemplate.queryForObject(
					"SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
					Integer.class);
			if (waiters != null && waiters >= count) {
				return;
			}
			Thread.sleep(20);
		}
		throw new AssertionError(count + " Transaction(s) never ended up waiting on a Row Lock");
	}

	private int requestCount(Object deviceId) {
		return jdbcTemplate.queryForObject(
				"SELECT count(*) FROM certificate_request WHERE device_id = ?", Integer.class,
				java.util.UUID.fromString((String) deviceId));
	}

	private int activeCredentialCount(Object deviceId) {
		return jdbcTemplate.queryForObject(
				"SELECT count(*) FROM enrollment_credential WHERE device_id = ? AND revoked_at IS NULL", Integer.class,
				java.util.UUID.fromString((String) deviceId));
	}
}
