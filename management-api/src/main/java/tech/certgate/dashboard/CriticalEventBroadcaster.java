package tech.certgate.dashboard;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Fan-out of CRITICAL Security Events to every connected Console SSE client
 * (docs/api-spec.md §9). This is a live, in-memory push channel, not the
 * source of truth — {@code SecurityEvent} rows are (docs/api-spec.md §9:
 * "Security Event가 원본 데이터"). A client that misses events while
 * disconnected is expected to re-query {@code GET /security-events} for the
 * gap, not replay this channel, so no history is buffered here.
 */
@Component
public class CriticalEventBroadcaster {

	private static final Logger log = LoggerFactory.getLogger(CriticalEventBroadcaster.class);
	private static final String SSE_EVENT_NAME = "critical-security-event";

	/**
	 * A half-open connection (Wi-Fi drop, NAT expiry, killed Client) never
	 * triggers a write-time {@link IOException} on its own — the server only
	 * finds out on the next {@code send()}. An infinite Emitter timeout would
	 * let such a connection sit in {@link #emitters} indefinitely; a finite
	 * one reclaims it via {@code onTimeout}. A real browser {@code EventSource}
	 * auto-reconnects on any disconnect, so this is invisible to it (Codex
	 * 리뷰 PR #28 Medium).
	 */
	private static final long EMITTER_TIMEOUT_MILLIS = Duration.ofMinutes(5).toMillis();
	private static final long HEARTBEAT_INTERVAL_MILLIS = 20_000L;

	private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

	public SseEmitter subscribe() {
		SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MILLIS);
		emitters.add(emitter);
		emitter.onCompletion(() -> emitters.remove(emitter));
		emitter.onTimeout(() -> emitters.remove(emitter));
		emitter.onError(ex -> emitters.remove(emitter));
		// Flushes the response headers immediately instead of waiting for the
		// first real Event, so the Client's connection is confirmed right away.
		sendOrDrop(emitter, SseEmitter.event().comment("connected"));
		return emitter;
	}

	void broadcast(CriticalEventPayload payload) {
		for (SseEmitter emitter : emitters) {
			sendOrDrop(emitter, SseEmitter.event()
					.id(payload.eventId())
					.name(SSE_EVENT_NAME)
					.data(payload, MediaType.APPLICATION_JSON));
		}
	}

	/** Detects half-open connections between real Events; see {@link #EMITTER_TIMEOUT_MILLIS}. */
	@Scheduled(fixedRate = HEARTBEAT_INTERVAL_MILLIS)
	void sendHeartbeat() {
		for (SseEmitter emitter : emitters) {
			sendOrDrop(emitter, SseEmitter.event().comment("heartbeat"));
		}
	}

	private void sendOrDrop(SseEmitter emitter, SseEmitter.SseEventBuilder event) {
		try {
			emitter.send(event);
		} catch (IOException | IllegalStateException e) {
			// A dead connection here is normal (client closed the tab, network
			// drop) — log and drop it; it must not fail the Transaction that
			// triggered a broadcast, or the scheduled heartbeat.
			log.debug("Dropping disconnected Critical Event SSE client: {}", e.getMessage());
			emitters.remove(emitter);
		}
	}
}
