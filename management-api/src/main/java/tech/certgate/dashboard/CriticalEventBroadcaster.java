package tech.certgate.dashboard;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
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

	private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

	public SseEmitter subscribe() {
		SseEmitter emitter = new SseEmitter(0L);
		emitters.add(emitter);
		emitter.onCompletion(() -> emitters.remove(emitter));
		emitter.onTimeout(() -> emitters.remove(emitter));
		emitter.onError(ex -> emitters.remove(emitter));
		return emitter;
	}

	void broadcast(CriticalEventPayload payload) {
		for (SseEmitter emitter : emitters) {
			try {
				emitter.send(SseEmitter.event()
						.id(payload.eventId())
						.name(SSE_EVENT_NAME)
						.data(payload, MediaType.APPLICATION_JSON));
			} catch (IOException | IllegalStateException e) {
				// A dead connection here is normal (client closed the tab, network
				// drop) — log and drop it; it must not fail the Transaction that
				// triggered this broadcast.
				log.debug("Dropping disconnected Critical Event SSE client: {}", e.getMessage());
				emitters.remove(emitter);
			}
		}
	}
}
