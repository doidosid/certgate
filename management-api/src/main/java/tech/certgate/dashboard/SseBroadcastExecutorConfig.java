package tech.certgate.dashboard;

import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * A small, bounded pool for {@link CriticalEventListener} so a batch of slow
 * or stale SSE Clients can't add their wait time to the Gateway's Security
 * Event Batch response — {@code @TransactionalEventListener(AFTER_COMMIT)}
 * runs synchronously on the ingest request thread by default (Codex 리뷰
 * PR #28 Medium). Deliberately not the JDK's unbounded
 * {@code SimpleAsyncTaskExecutor} default: CRITICAL Events are rare today,
 * but an unbounded pool would let a burst spawn unbounded threads.
 */
@Configuration
public class SseBroadcastExecutorConfig {

	public static final String BEAN_NAME = "sseBroadcastExecutor";

	@Bean(BEAN_NAME)
	public Executor sseBroadcastExecutor() {
		ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
		executor.setCorePoolSize(2);
		executor.setMaxPoolSize(4);
		executor.setQueueCapacity(100);
		executor.setThreadNamePrefix("sse-broadcast-");
		executor.initialize();
		return executor;
	}
}
