package tech.certgate.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tech.certgate.enrollment.TestCaFixture;

/**
 * Regression for the 2026-10-02 review (docs/deployment-roadmap.md Phase 0
 * High): <code>/%69nternal/...</code> and <code>/internal;x=1/...</code> reached
 * <code>/internal/**</code> Handlers without a Service Token.
 *
 * <p>Runs against the real embedded Tomcat with a raw socket, because the bypass
 * depends on how Tomcat and Spring MVC each normalize the request path —
 * MockMvc and HTTP client libraries would re-encode or normalize the path
 * before it ever reaches the server.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class GatewayServiceTokenFilterIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) throws Exception {
		Path dir = Files.createTempDirectory("certgate-service-token-filter-test-ca");
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir);
		registry.add("certgate.ca.root-cert-path", () -> ca.rootCertPath().toString());
		registry.add("certgate.ca.intermediate-cert-path", () -> ca.intermediateCertPath().toString());
		registry.add("certgate.ca.intermediate-key-path", () -> ca.intermediateKeyPath().toString());
		registry.add("certgate.gateway.service-token", () -> "test-gateway-service-token");
	}

	@LocalServerPort
	private int port;

	@ParameterizedTest
	@ValueSource(strings = {
			"/internal/access-context?serialNumber=01",
			"/%69nternal/access-context?serialNumber=01",
			"/%69%6E%74%65%72%6E%61%6C/access-context?serialNumber=01",
			"/internal;x=1/access-context?serialNumber=01",
			"/internal/access-context;x=1?serialNumber=01",
			"/internal/%61ccess-context?serialNumber=01",
			"/internal/access-context/?serialNumber=01",
			"/internal",
			"//internal/access-context?serialNumber=01",
			"/;x/internal/access-context?serialNumber=01",
			"/./internal/access-context?serialNumber=01",
			"/%2e/internal/access-context?serialNumber=01",
			"/x/../internal/access-context?serialNumber=01",
			"/x/%2e%2e/internal/access-context?serialNumber=01",
			"http://localhost/%69nternal/access-context?serialNumber=01",
	})
	void internalPathVariantsRequireServiceToken(String target) throws IOException {
		assertServiceTokenRejected(target, send("GET", target));
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"/internal/security-events/batch",
			"/%69nternal/security-events/batch",
			"/internal;x=1/security-events/batch",
	})
	void eventBatchPathVariantsRequireServiceToken(String target) throws IOException {
		assertServiceTokenRejected(target, send("POST", target));
	}

	/**
	 * Tomcat rejects these outright (400) or Spring MVC maps them to no Handler
	 * (404 RESOURCE_NOT_FOUND), so the filter not guarding some of them is fine —
	 * what must never happen is the access-context Handler running.
	 */
	@ParameterizedTest
	@ValueSource(strings = {
			"/internal%2Faccess-context?serialNumber=01",
			"/internal%5Caccess-context?serialNumber=01",
			"/internal\\access-context?serialNumber=01",
			"/%2569nternal/access-context?serialNumber=01",
			"/internal%3Bx/access-context?serialNumber=01",
			"/internal/access-context%00?serialNumber=01",
			"/%C0%AEinternal/access-context?serialNumber=01",
			"/INTERNAL/access-context?serialNumber=01",
	})
	void rejectedOrUnmappedVariantsNeverReachHandler(String target) throws IOException {
		RawResponse response = send("GET", target);

		assertThat(response.status()).as("%s -> %s", target, response.raw()).isIn(400, 401, 404);
		assertThat(response.raw()).as("%s -> %s", target, response.raw()).doesNotContain("CERTIFICATE_NOT_FOUND");
	}

	@ParameterizedTest
	@ValueSource(strings = {"/api/v1/devices", "/actuator/health", "/internalx"})
	void nonInternalPathsDoNotRequireServiceToken(String target) throws IOException {
		RawResponse response = send("GET", target);

		assertThat(response.status()).as("%s -> %s", target, response.raw()).isNotEqualTo(401);
		assertThat(response.raw()).doesNotContain("SERVICE_TOKEN_INVALID");
	}

	/** 401 from this filter specifically — not a Handler response, not a Tomcat rejection. */
	private static void assertServiceTokenRejected(String target, RawResponse response) {
		assertThat(response.status()).as("%s -> %s", target, response.raw()).isEqualTo(401);
		assertThat(response.raw())
				.contains("\"code\":\"SERVICE_TOKEN_INVALID\"")
				.contains("Gateway Service Token이 유효하지 않습니다.")
				.containsPattern("\"traceId\":\"[^\"]+\"");
	}

	private RawResponse send(String method, String target) throws IOException {
		try (Socket socket = new Socket("127.0.0.1", port)) {
			socket.setSoTimeout(10_000);
			OutputStream out = socket.getOutputStream();
			String body = "POST".equals(method) ? "{\"events\":[]}" : "";
			String headers = "POST".equals(method)
					? "Content-Type: application/json\r\nContent-Length: " + body.length() + "\r\n"
					: "";
			out.write((method + " " + target + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n" + headers + "\r\n" + body)
					.getBytes(StandardCharsets.US_ASCII));
			out.flush();
			InputStream in = socket.getInputStream();
			ByteArrayOutputStream buffer = new ByteArrayOutputStream();
			in.transferTo(buffer);
			String raw = buffer.toString(StandardCharsets.UTF_8);
			int status = Integer.parseInt(raw.substring(9, 12));
			return new RawResponse(status, raw);
		}
	}

	private record RawResponse(int status, String raw) {
	}
}
