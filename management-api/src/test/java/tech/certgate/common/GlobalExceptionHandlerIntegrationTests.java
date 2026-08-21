package tech.certgate.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpStatus;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Regression for Issue #39. A path with no Controller mapping used to fall
 * through to the generic {@code Exception} handler and report {@code 500
 * INTERNAL_ERROR}, making a typo'd URL indistinguishable from a real server
 * fault (docs/api-spec.md §1 "404: Resource 없음").
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class GlobalExceptionHandlerIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@Autowired
	private TestRestTemplate restTemplate;

	@Test
	void unmappedPath_returns404NotResourceNotFound() {
		var response = restTemplate.getForEntity("/api/v1/definitely-not-a-real-path", Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("code", "RESOURCE_NOT_FOUND");
	}

	@Test
	void unmappedNestedPath_returns404NotResourceNotFound() {
		// api-spec.md §6 GET /roles/{roleName} is mapped, but an extra path
		// segment past it has no Controller mapping at all — this must not be
		// confused with the 404 ROLE_NOT_FOUND that endpoint itself returns.
		var response = restTemplate.getForEntity("/api/v1/roles/SENSOR/extra", Map.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("code", "RESOURCE_NOT_FOUND");
	}
}
