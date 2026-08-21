package tech.certgate.certificate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
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
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tech.certgate.enrollment.TestCaFixture;

/**
 * Exercises the Certificate query/download/revoke API and confirms revoking
 * a Certificate both takes effect in the Access Context the Gateway reads
 * (docs/api-spec.md §7) and calls the Gateway's Cache invalidation API only
 * after the revocation Transaction commits (docs/security-design.md §6). The
 * Gateway side is faked with a plain JDK HttpServer — no new test dependency.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class CertificateIntegrationTests {

	private static final String INTERNAL_TOKEN = "test-internal-token";

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	private static HttpServer fakeGateway;
	private static final ConcurrentLinkedQueue<String> invalidationRequests = new ConcurrentLinkedQueue<>();
	/**
	 * Snapshot, taken from a brand-new connection at the exact moment each
	 * invalidation call reaches the fake Gateway, of whether the revoked
	 * Certificate's row was already visible as committed. A different thread
	 * (the JDK HttpServer's) reading through {@link CertificateRepository}
	 * cannot see another transaction's uncommitted write — so if the
	 * revocation Transaction hadn't actually committed yet when the listener
	 * fired (e.g. the phase regressed from AFTER_COMMIT), this reads {@code
	 * false} instead of the revoke() call's own in-progress changes.
	 */
	private static final ConcurrentLinkedQueue<Boolean> revokedVisibleAtInvalidation = new ConcurrentLinkedQueue<>();
	private static volatile CertificateRepository certificateRepositoryRef;
	private static final ObjectMapper objectMapper = new ObjectMapper();

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) throws Exception {
		Path dir = Files.createTempDirectory("certgate-certificate-test-ca");
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		registry.add("certgate.ca.intermediate-key-path", () -> ca.intermediateKeyPath().toString());

		fakeGateway = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		fakeGateway.createContext("/internal/cache/invalidations", exchange -> {
			String auth = exchange.getRequestHeaders().getFirst("Authorization");
			byte[] body = exchange.getRequestBody().readAllBytes();
			if (!("Bearer " + INTERNAL_TOKEN).equals(auth)) {
				exchange.sendResponseHeaders(401, -1);
				exchange.close();
				return;
			}
			String bodyText = new String(body);
			invalidationRequests.add(bodyText);
			recordVisibilityAtInvalidation(bodyText);
			exchange.sendResponseHeaders(204, -1);
			exchange.close();
		});
		fakeGateway.start();

		registry.add("certgate.gateway.internal-url", () -> "http://127.0.0.1:" + fakeGateway.getAddress().getPort());
		registry.add("certgate.gateway.internal-token", () -> INTERNAL_TOKEN);
	}

	/** Reads the invalidated Certificate through a fresh Repository call — a new Connection, no shared Transaction. */
	private static void recordVisibilityAtInvalidation(String invalidationBody) {
		CertificateRepository repository = certificateRepositoryRef;
		if (repository == null) {
			return;
		}
		try {
			String serialNumber = objectMapper.readTree(invalidationBody).get("key").asText();
			boolean revokedVisible = repository.findBySerialNumber(serialNumber)
					.map(certificate -> certificate.getRevokedAt() != null)
					.orElse(false);
			revokedVisibleAtInvalidation.add(revokedVisible);
		} catch (Exception e) {
			revokedVisibleAtInvalidation.add(false);
		}
	}

	@AfterEach
	void clearInvalidationRequests() {
		invalidationRequests.clear();
		revokedVisibleAtInvalidation.clear();
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@Autowired
	private CertificateRepository certificateRepository;

	@BeforeEach
	void captureCertificateRepositoryForFakeGateway() {
		certificateRepositoryRef = certificateRepository;
	}

	private record IssuedTestCertificate(String certificateId, String serialNumber) {
	}

	/** Registers a Device, runs it through CSR submit + approve, and returns the issued Certificate. */
	private IssuedTestCertificate issueCertificateFor(String deviceKey) throws Exception {
		var registerResponse = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test Device", "roleName", "SENSOR"), Map.class);
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
		String serialNumber = (String) certResponse.getBody().get("serialNumber");

		var listResponse = restTemplate.getForEntity("/api/v1/certificates?deviceId=" + registerResponse.getBody().get("id"), Map.class);
		@SuppressWarnings("unchecked")
		List<Map<String, Object>> content = (List<Map<String, Object>>) listResponse.getBody().get("content");
		String certificateId = (String) content.get(0).get("id");

		return new IssuedTestCertificate(certificateId, serialNumber);
	}

	@Test
	void get_returnsValidStatusBeforeRevocation() throws Exception {
		IssuedTestCertificate issued = issueCertificateFor("sensor-cert-get-01");

		var response = restTemplate.getForEntity("/api/v1/certificates/" + issued.certificateId(), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().get("status")).isEqualTo("VALID");
		assertThat(response.getBody().get("serialNumber")).isEqualTo(issued.serialNumber());
	}

	@Test
	void download_returnsRawPem() throws Exception {
		IssuedTestCertificate issued = issueCertificateFor("sensor-cert-download-01");

		var response = restTemplate.getForEntity("/api/v1/certificates/" + issued.certificateId() + "/download", String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).contains("BEGIN CERTIFICATE");
	}

	@Test
	void revoke_marksCertificateRevokedAndReflectsInAccessContext() throws Exception {
		IssuedTestCertificate issued = issueCertificateFor("sensor-cert-revoke-01");

		var revokeResponse = restTemplate.postForEntity(
				"/api/v1/certificates/" + issued.certificateId() + "/revoke",
				Map.of("reason", "KEY_COMPROMISE", "note", "분실 신고"), Map.class);

		assertThat(revokeResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(revokeResponse.getBody().get("status")).isEqualTo("REVOKED");
		assertThat(revokeResponse.getBody().get("revocationReason")).isEqualTo("KEY_COMPROMISE");

		var getResponse = restTemplate.getForEntity("/api/v1/certificates/" + issued.certificateId(), Map.class);
		assertThat(getResponse.getBody().get("status")).isEqualTo("REVOKED");
	}

	@Test
	void revoke_callsGatewayCacheInvalidationAfterCommit() throws Exception {
		IssuedTestCertificate issued = issueCertificateFor("sensor-cert-revoke-cache-01");

		restTemplate.postForEntity(
				"/api/v1/certificates/" + issued.certificateId() + "/revoke",
				Map.of("reason", "KEY_COMPROMISE"), Map.class);

		await().atMost(Duration.ofSeconds(2)).until(() -> invalidationRequests.stream().anyMatch(body -> body.contains(issued.serialNumber())));

		// docs/security-design.md §6 requires the Commit to happen before the
		// invalidation call, not just that the call happens at some point.
		// revokedVisibleAtInvalidation was read through a brand-new
		// Repository call from the HttpServer's own thread at the exact
		// moment each invalidation arrived — a different Transaction phase
		// (e.g. BEFORE_COMMIT) would still eventually make this call, but
		// the row wouldn't be visibly REVOKED yet when it did.
		assertThat(revokedVisibleAtInvalidation).isNotEmpty().allMatch(Boolean::booleanValue);
	}

	@Test
	void revoke_twice_isConflict() throws Exception {
		IssuedTestCertificate issued = issueCertificateFor("sensor-cert-revoke-twice-01");
		restTemplate.postForEntity(
				"/api/v1/certificates/" + issued.certificateId() + "/revoke", Map.of("reason", "KEY_COMPROMISE"), Map.class);

		var secondResponse = restTemplate.postForEntity(
				"/api/v1/certificates/" + issued.certificateId() + "/revoke", Map.of("reason", "KEY_COMPROMISE"), Map.class);

		assertThat(secondResponse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(secondResponse.getBody().get("code")).isEqualTo("CONFLICT");
	}

	/**
	 * Regression test for the Codex 리뷰 PR #24 concurrency finding: two
	 * concurrent revoke requests for the same Certificate must not both
	 * succeed and overwrite each other's revocation reason (row locked via
	 * {@link CertificateRepository#findByIdForUpdate}).
	 */
	@Test
	void revoke_concurrentRequests_onlyOneSucceeds() throws Exception {
		IssuedTestCertificate issued = issueCertificateFor("sensor-cert-revoke-concurrent-01");
		CyclicBarrier barrier = new CyclicBarrier(2);
		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			var first = CompletableFuture.supplyAsync(
					() -> revokeAfterBarrier(issued.certificateId(), "KEY_COMPROMISE", barrier), executor);
			var second = CompletableFuture.supplyAsync(
					() -> revokeAfterBarrier(issued.certificateId(), "SUPERSEDED", barrier), executor);
			var responses = List.of(first.get(), second.get());

			assertThat(responses).extracting(r -> r.getStatusCode())
					.containsExactlyInAnyOrder(HttpStatus.OK, HttpStatus.CONFLICT);

			var getResponse = restTemplate.getForEntity("/api/v1/certificates/" + issued.certificateId(), Map.class);
			String persistedReason = (String) getResponse.getBody().get("revocationReason");
			String winningReason = responses.stream()
					.filter(r -> r.getStatusCode() == HttpStatus.OK)
					.findFirst().orElseThrow().getBody().get("revocationReason").toString();
			assertThat(persistedReason).isEqualTo(winningReason);
		} finally {
			executor.shutdownNow();
		}
	}

	private ResponseEntity<Map> revokeAfterBarrier(String certificateId, String reason, CyclicBarrier barrier) {
		try {
			barrier.await();
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
		return restTemplate.postForEntity("/api/v1/certificates/" + certificateId + "/revoke", Map.of("reason", reason), Map.class);
	}

	@Test
	void revoke_blankReason_isRejected() throws Exception {
		IssuedTestCertificate issued = issueCertificateFor("sensor-cert-revoke-blank-reason-01");

		var response = restTemplate.postForEntity(
				"/api/v1/certificates/" + issued.certificateId() + "/revoke", Map.of("reason", ""), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody().get("code")).isEqualTo("REVOCATION_REASON_REQUIRED");
	}

	@Test
	void revoke_unknownCertificateId_isNotFound() {
		var response = restTemplate.postForEntity(
				"/api/v1/certificates/" + java.util.UUID.randomUUID() + "/revoke",
				Map.of("reason", "KEY_COMPROMISE"), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody().get("code")).isEqualTo("CERTIFICATE_NOT_FOUND");
	}

	@Test
	void list_filtersByStatus() throws Exception {
		IssuedTestCertificate valid = issueCertificateFor("sensor-cert-list-valid-01");
		IssuedTestCertificate revoked = issueCertificateFor("sensor-cert-list-revoked-01");
		restTemplate.postForEntity(
				"/api/v1/certificates/" + revoked.certificateId() + "/revoke", Map.of("reason", "KEY_COMPROMISE"), Map.class);

		var response = restTemplate.getForEntity("/api/v1/certificates?status=REVOKED", Map.class);

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> content = (List<Map<String, Object>>) response.getBody().get("content");
		assertThat(content).extracting(c -> c.get("serialNumber")).contains(revoked.serialNumber());
		assertThat(content).extracting(c -> c.get("serialNumber")).doesNotContain(valid.serialNumber());
	}
}
