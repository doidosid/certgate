package tech.certgate.dashboard;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Measures a single PostgreSQL round trip for the Dashboard's service Health
 * list (docs/api-spec.md §9).
 *
 * <p>Borrows its own Connection instead of running inside a caller's
 * Transaction: the Dashboard deliberately holds no Transaction while it
 * assembles, and a probe that failed inside one would poison that Transaction
 * rather than report DOWN.
 */
@Component
public class PostgresHealthProbe {

	private static final Logger log = LoggerFactory.getLogger(PostgresHealthProbe.class);
	private static final int VALIDATION_TIMEOUT_SECONDS = 2;

	private final DataSource dataSource;

	public PostgresHealthProbe(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	/** Latency of one round trip, or empty when the database could not be reached. */
	public java.util.Optional<Integer> latencyMs() {
		long startedAt = System.nanoTime();
		try (Connection connection = dataSource.getConnection()) {
			if (!connection.isValid(VALIDATION_TIMEOUT_SECONDS)) {
				log.warn("Dashboard의 PostgreSQL Health 확인 실패: Connection이 유효하지 않습니다");
				return java.util.Optional.empty();
			}
			return java.util.Optional.of((int) Duration.ofNanos(System.nanoTime() - startedAt).toMillis());
		} catch (SQLException | RuntimeException e) {
			log.warn("Dashboard의 PostgreSQL Health 확인에 실패했습니다: {}", e.getMessage());
			return java.util.Optional.empty();
		}
	}
}
