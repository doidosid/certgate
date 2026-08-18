package tech.certgate.dashboard;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** docs/api-spec.md §9: {@code GET /security-events/stream}. */
@RestController
public class CriticalEventStreamController {

	private final CriticalEventBroadcaster broadcaster;

	public CriticalEventStreamController(CriticalEventBroadcaster broadcaster) {
		this.broadcaster = broadcaster;
	}

	@GetMapping("/api/v1/security-events/stream")
	public SseEmitter stream() {
		return broadcaster.subscribe();
	}
}
