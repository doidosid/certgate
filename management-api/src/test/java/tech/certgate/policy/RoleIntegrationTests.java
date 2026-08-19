package tech.certgate.policy;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Exercises GET /api/v1/roles (docs/api-spec.md §6 "Policy API"). The Admin
 * Console needs this to populate the Role filter and the Role-change selector;
 * MVP provides read access only and manages the rules as Seed Data.
 */
@Testcontainers
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class RoleIntegrationTests {

	@Container
	@ServiceConnection
	static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16.15-alpine");

	@Autowired
	private TestRestTemplate restTemplate;

	private static final ParameterizedTypeReference<List<RoleResponse>> ROLE_LIST =
			new ParameterizedTypeReference<>() {
			};

	/** V1__create_role.sql seeds SENSOR and OPERATOR. */
	@Test
	void list_returnsSeededRolesOrderedByName() {
		ResponseEntity<List<RoleResponse>> response =
				restTemplate.exchange("/api/v1/roles", HttpMethod.GET, null, ROLE_LIST);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody()).extracting(RoleResponse::name).containsExactly("OPERATOR", "SENSOR");
	}

	/**
	 * The rules travel with the Role so the Console can show what a Role allows
	 * without a second round trip per Role.
	 */
	@Test
	void list_includesEachRolesRules() {
		List<RoleResponse> roles =
				restTemplate.exchange("/api/v1/roles", HttpMethod.GET, null, ROLE_LIST).getBody();

		RoleResponse sensor = roles.stream().filter(role -> role.name().equals("SENSOR")).findFirst().orElseThrow();
		assertThat(sensor.rules())
				.extracting(RoleResponse.RuleView::httpMethod, RoleResponse.RuleView::pathPattern)
				.containsExactly(tuple2("POST", "/telemetry"), tuple2("POST", "/heartbeat"));
	}

	/** docs/api-spec.md §6: rules are ordered by priority. */
	@Test
	void get_returnsRulesOrderedByPriority() {
		ResponseEntity<RoleResponse> response = restTemplate.getForEntity("/api/v1/roles/OPERATOR", RoleResponse.class);

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(response.getBody().name()).isEqualTo("OPERATOR");
		assertThat(response.getBody().rules()).extracting(RoleResponse.RuleView::priority).containsExactly(10, 20, 30);
		assertThat(response.getBody().rules()).allSatisfy(rule -> assertThat(rule.effect()).isEqualTo("ALLOW"));
	}

	@Test
	void get_unknownRole_returns404WithReasonCode() {
		ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
				"/api/v1/roles/NO_SUCH_ROLE", HttpMethod.GET, null, new ParameterizedTypeReference<>() {
				});

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(response.getBody()).containsEntry("code", "ROLE_NOT_FOUND");
		assertThat(response.getBody().get("traceId")).isNotNull();
	}

	/**
	 * MVP provides no write API for policy (docs/api-spec.md §6: "정책 수정 API는
	 * 제공하지 않고 Seed Data로 관리한다"). A POST must not silently succeed.
	 */
	@Test
	void post_isNotAllowed() {
		ResponseEntity<Map<String, Object>> response = restTemplate.exchange(
				"/api/v1/roles", HttpMethod.POST, null, new ParameterizedTypeReference<>() {
				});

		assertThat(response.getStatusCode()).isEqualTo(HttpStatus.METHOD_NOT_ALLOWED);
	}

	private static org.assertj.core.groups.Tuple tuple2(String first, String second) {
		return org.assertj.core.groups.Tuple.tuple(first, second);
	}
}
