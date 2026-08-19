package tech.certgate.dashboard;

import java.time.Duration;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Reads the Gateway's Outbox depth for the Dashboard. The Gateway's SQLite
 * Outbox lives inside the Gateway process, so Management API cannot query it
 * directly and asks over the internal API instead (docs/api-spec.md §8).
 *
 * <p>A failure is logged and turned into an empty result, never rethrown: a
 * dead Gateway must not make the whole Dashboard unavailable, which is exactly
 * when an operator needs to see it. Timeouts are short for the same reason —
 * the Dashboard request thread cannot wait on an unresponsive Gateway. Same
 * construction as {@code certificate/GatewayCacheClient}.
 */
@Component
public class GatewayOutboxClient {

	private static final Logger log = LoggerFactory.getLogger(GatewayOutboxClient.class);
	private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
	private static final Duration READ_TIMEOUT = Duration.ofSeconds(3);

	private final RestClient restClient;
	private final String baseUrl;
	private final String internalToken;

	public GatewayOutboxClient(
			RestClient.Builder builder,
			@Value("${certgate.gateway.internal-url:}") String baseUrl,
			@Value("${certgate.gateway.internal-token:}") String internalToken) {
		SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
		requestFactory.setConnectTimeout(CONNECT_TIMEOUT);
		requestFactory.setReadTimeout(READ_TIMEOUT);
		this.restClient = builder.requestFactory(requestFactory).build();
		this.baseUrl = baseUrl;
		this.internalToken = internalToken;
	}

	public Optional<DashboardSummaryResponse.OutboxStats> fetchStats() {
		if (baseUrl.isBlank() || internalToken.isBlank()) {
			log.debug("Gateway Outbox 상태 조회 생략: GATEWAY_INTERNAL_URL/TOKEN이 설정되지 않았습니다");
			return Optional.empty();
		}
		try {
			return Optional.ofNullable(restClient.get()
					.uri(baseUrl + "/internal/outbox/stats")
					.header("Authorization", "Bearer " + internalToken)
					.retrieve()
					.body(DashboardSummaryResponse.OutboxStats.class));
		} catch (RestClientException e) {
			log.warn("Gateway Outbox 상태를 조회하지 못했습니다: {}", e.getMessage());
			return Optional.empty();
		}
	}
}
