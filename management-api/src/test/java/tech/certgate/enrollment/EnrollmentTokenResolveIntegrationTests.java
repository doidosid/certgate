package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.KeyPair;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tech.certgate.common.ApiException;

/**
 * Regression tests for a reported bug: resolving one device's Enrollment
 * Token appeared to return a different device's credential after a token
 * reissue. Direct inspection of EnrollmentTokenService.resolve() and
 * EnrollmentCredentialRepository (a single unambiguous
 * findByTokenHashForUpdate(String), a DB-level UNIQUE constraint on token_hash, and
 * no caching anywhere in the path) found no code defect.
 *
 * The first and second tests below go through the full public stack — the
 * real reissue endpoint (POST /devices/{id}/enrollment-token) and the real
 * CSR-submission endpoint with a real CSR — so they don't just confirm
 * resolve()'s own correctness in isolation; they confirm the HTTP boundary
 * (path variable binding, Bearer header parsing, device ownership) carries
 * the right device through too. The remaining tests check resolve()'s own
 * edge cases (revoked/expired/unknown) directly against the service/DB
 * boundary, which is simpler to set up precisely for those conditions.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class EnrollmentTokenResolveIntegrationTests {

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
	private EnrollmentTokenService tokenService;

	@Autowired
	private EnrollmentCredentialRepository enrollmentCredentials;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private Map<String, Object> registerDevice(String deviceKey) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices", Map.of("deviceKey", deviceKey, "name", "Test Sensor", "roleName", "SENSOR"), Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		@SuppressWarnings("unchecked")
		Map<String, Object> body = response.getBody();
		return body;
	}

	/** Calls the real reissue endpoint, not the service directly. */
	private String reissueTokenViaApi(UUID deviceId) {
		var response = restTemplate.postForEntity(
				"/api/v1/devices/" + deviceId + "/enrollment-token", null, Map.class);
		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		return (String) response.getBody().get("enrollmentToken");
	}

	private HttpHeaders bearerHeaders(String token) {
		HttpHeaders headers = new HttpHeaders();
		headers.setBearerAuth(token);
		headers.setContentType(MediaType.APPLICATION_JSON);
		return headers;
	}

	/** Submits csrPem with token over the real HTTP endpoint and returns the response. */
	private org.springframework.http.ResponseEntity<Map> submitCsr(String token, String csrPem) {
		return restTemplate.postForEntity(
				"/api/v1/enrollments/certificate-requests",
				new HttpEntity<>(Map.of("csrPem", csrPem), bearerHeaders(token)), Map.class);
	}

	@Test
	void reissuedTokenSubmitsSuccessfullyForTheSameDeviceThroughTheFullHttpStack() throws Exception {
		Map<String, Object> device = registerDevice("token-e2e-reissue");
		UUID deviceId = UUID.fromString((String) device.get("id"));

		String newToken = reissueTokenViaApi(deviceId);

		KeyPair keyPair = TestCaFixture.generateEcKeyPair();
		String csrPem = TestCaFixture.createDeviceCsrPem("token-e2e-reissue", keyPair);

		var response = submitCsr(newToken, csrPem);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
		assertThat(response.getBody().get("status")).isEqualTo("PENDING");
	}

	@Test
	void reissuingOneDevicesTokenThroughTheApiNeverLetsItSubmitForAnotherDevice() throws Exception {
		Map<String, Object> deviceA = registerDevice("token-e2e-a");
		String tokenA = (String) deviceA.get("enrollmentToken");
		Map<String, Object> deviceB = registerDevice("token-e2e-b");
		UUID deviceIdB = UUID.fromString((String) deviceB.get("id"));

		// Reissue B's token through the real admin endpoint, exactly as the
		// reported bug's repro steps did.
		String newTokenB = reissueTokenViaApi(deviceIdB);

		// A's own, still-active original token must keep working for A.
		KeyPair keyPairA = TestCaFixture.generateEcKeyPair();
		String csrPemA = TestCaFixture.createDeviceCsrPem("token-e2e-a", keyPairA);
		var responseA = submitCsr(tokenA, csrPemA);
		assertThat(responseA.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

		// B's new token must resolve to B, not A: a CSR carrying A's SAN
		// submitted with B's new token must be rejected as a mismatch — the
		// exact SAN_URI_INVALID symptom from the bug report must NOT occur
		// for B's own CSR, and must occur (correctly, as a real mismatch)
		// if B's CSR were submitted under a different device's identity.
		KeyPair keyPairB = TestCaFixture.generateEcKeyPair();
		String csrPemB = TestCaFixture.createDeviceCsrPem("token-e2e-b", keyPairB);
		var responseB = submitCsr(newTokenB, csrPemB);
		assertThat(responseB.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

		// Cross-check: B's new token must reject a CSR built for A's SAN.
		String crossCsr = TestCaFixture.createDeviceCsrPem("token-e2e-a", TestCaFixture.generateEcKeyPair());
		var crossResponse = submitCsr(newTokenB, crossCsr);
		assertThat(crossResponse.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
		assertThat(crossResponse.getBody().get("code")).isEqualTo("SAN_URI_INVALID");
	}

	@Test
	void reissuingTheFirstRegisteredDevicesTokenThroughTheApiNeverLetsItSubmitForTheSecondDevice() throws Exception {
		// codexReview/PR-enrollment-token-resolve.md Medium finding: the
		// previous test only ever reissued the SECOND-registered device
		// (B). The reported bug registered A first, then (per the DB
		// evidence gathered during triage) reissued A's own token — so this
		// mirrors that exact order instead, reissuing the FIRST device.
		Map<String, Object> deviceA = registerDevice("token-e2e-first-reissue-a");
		UUID deviceIdA = UUID.fromString((String) deviceA.get("id"));
		Map<String, Object> deviceB = registerDevice("token-e2e-first-reissue-b");
		String tokenB = (String) deviceB.get("enrollmentToken");

		String newTokenA = reissueTokenViaApi(deviceIdA);

		// A's new token must resolve to A, not B.
		KeyPair keyPairA = TestCaFixture.generateEcKeyPair();
		String csrPemA = TestCaFixture.createDeviceCsrPem("token-e2e-first-reissue-a", keyPairA);
		var responseA = submitCsr(newTokenA, csrPemA);
		assertThat(responseA.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

		// B's own, untouched token must still work for B after A's reissue.
		KeyPair keyPairB = TestCaFixture.generateEcKeyPair();
		String csrPemB = TestCaFixture.createDeviceCsrPem("token-e2e-first-reissue-b", keyPairB);
		var responseB = submitCsr(tokenB, csrPemB);
		assertThat(responseB.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);

		// Cross-check: A's new token must reject a CSR built for B's SAN.
		String crossCsr = TestCaFixture.createDeviceCsrPem("token-e2e-first-reissue-b", TestCaFixture.generateEcKeyPair());
		var crossResponse = submitCsr(newTokenA, crossCsr);
		assertThat(crossResponse.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
		assertThat(crossResponse.getBody().get("code")).isEqualTo("SAN_URI_INVALID");
	}

	@Test
	void resolve_rejectsRevokedToken() {
		Map<String, Object> device = registerDevice("token-revoked");
		UUID deviceId = UUID.fromString((String) device.get("id"));
		String oldToken = (String) device.get("enrollmentToken");

		tokenService.issueFor(deviceId); // revokes oldToken's credential

		assertThatThrownBy(() -> tokenService.resolve(oldToken))
				.isInstanceOf(ApiException.class)
				.satisfies(e -> assertThat(((ApiException) e).getReasonCode()).isEqualTo("ENROLLMENT_TOKEN_INVALID"));
	}

	@Test
	void resolve_rejectsExpiredToken() {
		Map<String, Object> device = registerDevice("token-expired");
		UUID deviceId = UUID.fromString((String) device.get("id"));
		String token = (String) device.get("enrollmentToken");

		EnrollmentCredential credential = enrollmentCredentials.findByDeviceIdAndRevokedAtIsNull(deviceId).orElseThrow();
		jdbcTemplate.update(
				"UPDATE enrollment_credential SET expires_at = ? WHERE id = ?",
				Timestamp.from(Instant.now().minus(1, ChronoUnit.HOURS)),
				credential.getId());

		assertThatThrownBy(() -> tokenService.resolve(token))
				.isInstanceOf(ApiException.class)
				.satisfies(e -> assertThat(((ApiException) e).getReasonCode()).isEqualTo("ENROLLMENT_TOKEN_INVALID"));
	}

	@Test
	void resolve_rejectsUnknownToken() {
		assertThatThrownBy(() -> tokenService.resolve("cg_enroll_does-not-exist"))
				.isInstanceOf(ApiException.class)
				.satisfies(e -> assertThat(((ApiException) e).getReasonCode()).isEqualTo("ENROLLMENT_TOKEN_INVALID"));
	}
}
