package tech.certgate.certificate;

import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Calls the Gateway's internal Cache invalidation API after a Certificate
 * revocation commits (docs/api-spec.md §8). A failure here is logged and
 * swallowed, never rethrown: the revocation itself must not roll back, and
 * the Gateway's 30s Access Context TTL guarantees eventual convergence
 * (docs/security-design.md §6). Connect/read Timeout is kept well under that
 * 30s TTL so an unresponsive Gateway cannot block the revoke request thread
 * for long (Codex 리뷰 PR #24).
 */
@Component
public class GatewayCacheClient {

	private static final Logger log = LoggerFactory.getLogger(GatewayCacheClient.class);
	private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(2);
	private static final Duration READ_TIMEOUT = Duration.ofSeconds(3);

	private final RestClient restClient;
	private final String baseUrl;
	private final String internalToken;

	public GatewayCacheClient(
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

	public void invalidateCertificate(String serialNumber) {
		if (baseUrl.isBlank() || internalToken.isBlank()) {
			log.warn("Gateway Cache invalidation skipped for serial {}: GATEWAY_INTERNAL_URL/TOKEN not configured", serialNumber);
			return;
		}
		try {
			restClient.post()
					.uri(baseUrl + "/internal/cache/invalidations")
					.header("Authorization", "Bearer " + internalToken)
					.body(new InvalidationRequest("CERTIFICATE", serialNumber))
					.retrieve()
					.toBodilessEntity();
		} catch (RestClientException e) {
			log.warn("Gateway Cache invalidation failed for serial {}: {}", serialNumber, e.getMessage());
		}
	}

	private record InvalidationRequest(String type, String key) {
	}
}
