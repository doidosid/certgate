package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.cert.CertPath;
import java.security.cert.CertPathValidator;
import java.security.cert.CertificateFactory;
import java.security.cert.PKIXParameters;
import java.security.cert.TrustAnchor;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Exercises the full Enrollment vertical slice: register -> submit CSR ->
 * approve -> download certificate + chain -> chain verifies against Root CA
 * (Issue #1 completion criteria), plus the required failure paths from
 * docs/testing.md (invalid token, SAN/Device Key mismatch, PENDING dedup).
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class EnrollmentFlowIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	static TestCaFixture.CaPaths ca;

	@DynamicPropertySource
	static void caProperties(DynamicPropertyRegistry registry) throws Exception {
		Path dir = Files.createTempDirectory("certgate-test-ca");
		ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		registry.add("certgate.ca.intermediate-key-path", () -> ca.intermediateKeyPath().toString());
	}

	@Autowired
	private TestRestTemplate restTemplate;

	@Autowired
	private EnrollmentCredentialRepository enrollmentCredentials;

	private Map<String, Object> registerDevice(String deviceKey) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test Sensor", "roleName", "SENSOR"), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		@SuppressWarnings("unchecked")
		Map<String, Object> body = response.getBody();
		return body;
	}

	private HttpHeaders bearerHeaders(String token) {
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(token);
		headers.setContentType(MediaType.APPLICATION_JSON);
		return headers;
	}

	@Test
	void fullEnrollmentFlow_issuesCertificateThatChainsToRoot() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-01");
		String token = (String) device.get("enrollmentToken");

		KeyPair deviceKeyPair = TestCaFixture.generateEcKeyPair();
		String csrPem = TestCaFixture.createDeviceCsrPem("sensor-e2e-01", deviceKeyPair);

		HttpHeaders headers = bearerHeaders(token);
		var submitResponse = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", csrPem), headers), Map.class);
		assertThat(submitResponse.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
		String requestId = (String) submitResponse.getBody().get("id");
		assertThat(submitResponse.getBody().get("status")).isEqualTo("PENDING");

		var statusResponse = restTemplate.exchange(
				"/api/v1/enrollments/certificate-requests/" + requestId, HttpMethod.GET,
				new HttpEntity<>(headers), Map.class);
		assertThat(statusResponse.getBody().get("status")).isEqualTo("PENDING");

		var approveResponse = restTemplate.postForEntity(
				"/api/v1/certificate-requests/" + requestId + "/approve", null, Map.class);
		assertThat(approveResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(approveResponse.getBody().get("status")).isEqualTo("APPROVED");

		var certResponse = restTemplate.exchange(
				"/api/v1/enrollments/certificate-requests/" + requestId + "/certificate", HttpMethod.GET,
				new HttpEntity<>(headers), Map.class);
		assertThat(certResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
		String certificatePem = (String) certResponse.getBody().get("certificatePem");
		String caChainPem = (String) certResponse.getBody().get("caChainPem");

		assertThatCode(() -> assertChainVerifiesAgainstRoot(certificatePem, caChainPem, ca.rootCert())).doesNotThrowAnyException();
	}

	@Test
	void certificateFromUnrelatedCa_doesNotVerifyAgainstThisRoot() throws Exception {
		// Simulates docs/testing.md Device Profile C ("다른 CA"): a chain issued by
		// a completely independent CA must fail verification against our root.
		Path otherDir = Files.createTempDirectory("certgate-other-ca");
		TestCaFixture.CaPaths otherCa = TestCaFixture.generate(otherDir);

		Map<String, Object> device = registerDevice("sensor-e2e-other-ca");
		String token = (String) device.get("enrollmentToken");
		KeyPair deviceKeyPair = TestCaFixture.generateEcKeyPair();
		String csrPem = TestCaFixture.createDeviceCsrPem("sensor-e2e-other-ca", deviceKeyPair);
		HttpHeaders headers = bearerHeaders(token);

		var submitResponse = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", csrPem), headers), Map.class);
		String requestId = (String) submitResponse.getBody().get("id");
		restTemplate.postForEntity("/api/v1/certificate-requests/" + requestId + "/approve", null, Map.class);
		var certResponse = restTemplate.exchange(
				"/api/v1/enrollments/certificate-requests/" + requestId + "/certificate", HttpMethod.GET,
				new HttpEntity<>(headers), Map.class);
		String certificatePem = (String) certResponse.getBody().get("certificatePem");
		String caChainPem = (String) certResponse.getBody().get("caChainPem");

		assertThatThrownBy(() -> assertChainVerifiesAgainstRoot(certificatePem, caChainPem, otherCa.rootCert()))
				.isInstanceOf(java.security.cert.CertPathValidatorException.class);
	}

	@Test
	void submitWithInvalidToken_isRejected() {
		HttpHeaders headers = bearerHeaders("cg_enroll_does-not-exist");
		var response = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", "not-a-real-csr"), headers), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(response.getBody().get("code")).isEqualTo("ENROLLMENT_TOKEN_INVALID");
	}

	@Test
	void submitWithSanDeviceKeyMismatch_isRejected() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-mismatch");
		String token = (String) device.get("enrollmentToken");
		KeyPair deviceKeyPair = TestCaFixture.generateEcKeyPair();
		// CSR's SAN URI carries a different device key than the token's owner.
		String csrPem = TestCaFixture.createDeviceCsrPem("someone-elses-device", deviceKeyPair);

		var response = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", csrPem), bearerHeaders(token)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
		assertThat(response.getBody().get("code")).isEqualTo("SAN_URI_INVALID");
	}

	@Test
	void duplicatePendingRequest_isRejected() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-dup");
		String token = (String) device.get("enrollmentToken");
		HttpHeaders headers = bearerHeaders(token);

		String firstCsr = TestCaFixture.createDeviceCsrPem("sensor-e2e-dup", TestCaFixture.generateEcKeyPair());
		var first = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", firstCsr), headers), Map.class);
		assertThat(first.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

		String secondCsr = TestCaFixture.createDeviceCsrPem("sensor-e2e-dup", TestCaFixture.generateEcKeyPair());
		var second = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", secondCsr), headers), Map.class);

		assertThat(second.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(second.getBody().get("code")).isEqualTo("CERTIFICATE_REQUEST_DUPLICATE");
	}

	// --- codexReview.md follow-ups ---

	@Test
	void submitWithoutAuthorizationHeader_isRejectedNotServerError() {
		HttpHeaders headers = new HttpHeaders();
		headers.setContentType(MediaType.APPLICATION_JSON);
		var response = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", "irrelevant"), headers), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(response.getBody().get("code")).isEqualTo("ENROLLMENT_TOKEN_INVALID");
	}

	@Test
	void submitWithMalformedJsonBody_isRejectedAsBadRequestNotServerError() {
		HttpHeaders headers = bearerHeaders("cg_enroll_whatever");
		var response = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>("{not-json", headers), String.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(response.getBody()).contains("MALFORMED_REQUEST_BODY");
	}

	@Test
	void submitWithNullCsrPem_isRejectedNotServerError() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-null-csr");
		String token = (String) device.get("enrollmentToken");

		var response = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Collections.singletonMap("csrPem", null), bearerHeaders(token)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
		assertThat(response.getBody().get("code")).isEqualTo("CSR_SIGNATURE_INVALID");
	}

	@Test
	void submitWithExtraNonUriSan_isRejected() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-extra-san");
		String token = (String) device.get("enrollmentToken");
		String csrPem = TestCaFixture.createDeviceCsrPemWithExtraDnsSan(
				"sensor-e2e-extra-san", TestCaFixture.generateEcKeyPair(), "unrelated.example.com");

		var response = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", csrPem), bearerHeaders(token)), Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
		assertThat(response.getBody().get("code")).isEqualTo("SAN_URI_INVALID");
	}

	@Test
	void csrValidationRunsBeforeDuplicatePendingCheck() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-order");
		String token = (String) device.get("enrollmentToken");
		HttpHeaders headers = bearerHeaders(token);

		String validCsr = TestCaFixture.createDeviceCsrPem("sensor-e2e-order", TestCaFixture.generateEcKeyPair());
		var first = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", validCsr), headers), Map.class);
		assertThat(first.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

		// A PENDING request already exists, but this second CSR is itself invalid
		// (wrong SAN device key). It must fail on CSR validation, not on the
		// PENDING-duplicate check (docs/api-spec.md §4 order).
		String mismatchedCsr = TestCaFixture.createDeviceCsrPem("someone-elses-device", TestCaFixture.generateEcKeyPair());
		var second = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", mismatchedCsr), headers), Map.class);

		assertThat(second.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
		assertThat(second.getBody().get("code")).isEqualTo("SAN_URI_INVALID");
	}

	@Test
	void concurrentCsrSubmission_onlyOneSucceeds() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-race");
		String token = (String) device.get("enrollmentToken");
		HttpHeaders headers = bearerHeaders(token);

		String csrA = TestCaFixture.createDeviceCsrPem("sensor-e2e-race", TestCaFixture.generateEcKeyPair());
		String csrB = TestCaFixture.createDeviceCsrPem("sensor-e2e-race", TestCaFixture.generateEcKeyPair());

		CyclicBarrier barrier = new CyclicBarrier(2);
		Callable<Integer> submitA = () -> {
			barrier.await(10, TimeUnit.SECONDS);
			return restTemplate.postForEntity(
					"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrA), headers), Map.class)
					.getStatusCode().value();
		};
		Callable<Integer> submitB = () -> {
			barrier.await(10, TimeUnit.SECONDS);
			return restTemplate.postForEntity(
					"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrB), headers), Map.class)
					.getStatusCode().value();
		};

		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			Future<Integer> resultA = executor.submit(submitA);
			Future<Integer> resultB = executor.submit(submitB);
			List<Integer> results = List.of(resultA.get(10, TimeUnit.SECONDS), resultB.get(10, TimeUnit.SECONDS));
			assertThat(results).containsExactlyInAnyOrder(HttpStatus.ACCEPTED.value(), HttpStatus.CONFLICT.value());
		} finally {
			executor.shutdownNow();
		}
	}

	@Test
	void statusPoll_persistsTokenLastUsedAt() throws Exception {
		Map<String, Object> device = registerDevice("sensor-e2e-lastused");
		String token = (String) device.get("enrollmentToken");
		UUID deviceId = UUID.fromString((String) device.get("id"));
		HttpHeaders headers = bearerHeaders(token);

		String csrPem = TestCaFixture.createDeviceCsrPem("sensor-e2e-lastused", TestCaFixture.generateEcKeyPair());
		var submitResponse = restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests", new HttpEntity<>(Map.of("csrPem", csrPem), headers), Map.class);
		String requestId = (String) submitResponse.getBody().get("id");

		restTemplate.exchange(
				"/api/v1/enrollments/certificate-requests/" + requestId, HttpMethod.GET, new HttpEntity<>(headers), Map.class);

		EnrollmentCredential credential = enrollmentCredentials.findByDeviceIdAndRevokedAtIsNull(deviceId).orElseThrow();
		assertThat(credential.getLastUsedAt()).isNotNull();
	}

	private static void assertChainVerifiesAgainstRoot(String certificatePem, String caChainPem, X509Certificate trustedRoot)
			throws Exception {
		CertificateFactory certificateFactory = CertificateFactory.getInstance("X.509");
		X509Certificate leaf = (X509Certificate) certificateFactory.generateCertificate(
				new ByteArrayInputStream(certificatePem.getBytes(StandardCharsets.UTF_8)));
		@SuppressWarnings("unchecked")
		List<X509Certificate> chainCerts = (List<X509Certificate>) (List<?>) certificateFactory
				.generateCertificates(new ByteArrayInputStream(caChainPem.getBytes(StandardCharsets.UTF_8)))
				.stream().toList();
		X509Certificate intermediate = chainCerts.get(0);

		CertPath certPath = certificateFactory.generateCertPath(List.of(leaf, intermediate));

		Set<TrustAnchor> anchors = new HashSet<>();
		anchors.add(new TrustAnchor(trustedRoot, null));
		PKIXParameters params = new PKIXParameters(anchors);
		params.setRevocationEnabled(false);

		CertPathValidator validator = CertPathValidator.getInstance("PKIX");
		validator.validate(certPath, params);
	}
}
