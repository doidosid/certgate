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
 * Runs against the real embedded Tomcat with a raw socket, because the bypass
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
			"//internal/access-context?serialNumber=01",
			"/./internal/access-context?serialNumber=01",
			"/x/../internal/access-context?serialNumber=01",
	})
	void internalPathVariantsNeverReachHandlerWithoutServiceToken(String rawPath) throws IOException {
		RawResponse response = get(rawPath);

		// 401 from the filter, or 400 if Tomcat rejects the path outright. Anything
		// else — 200 or the handler's own 404 CERTIFICATE_NOT_FOUND — means the
		// request reached an /internal handler without a Service Token.
		assertThat(response.status())
				.as("%s -> %s", rawPath, response.raw())
				.isIn(400, 401);
		assertThat(response.raw()).doesNotContain("CERTIFICATE_NOT_FOUND");
	}

	@ParameterizedTest
	@ValueSource(strings = {"/api/v1/devices", "/actuator/health", "/internalx"})
	void nonInternalPathsDoNotRequireServiceToken(String rawPath) throws IOException {
		RawResponse response = get(rawPath);

		assertThat(response.raw()).as("%s -> %s", rawPath, response.raw()).doesNotContain("SERVICE_TOKEN_INVALID");
	}

	private RawResponse get(String rawPath) throws IOException {
		try (Socket socket = new Socket("127.0.0.1", port)) {
			socket.setSoTimeout(10_000);
			OutputStream out = socket.getOutputStream();
			out.write(("GET " + rawPath + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
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
