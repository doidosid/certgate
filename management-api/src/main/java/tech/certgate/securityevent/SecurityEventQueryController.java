package tech.certgate.securityevent;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tech.certgate.common.PageResponse;

/**
 * docs/api-spec.md §9 "Console 조회 API" 검색·상세. Protected only by
 * deployment restriction in the MVP - no application-level admin auth yet
 * (same as DeviceController).
 */
@RestController
@RequestMapping("/api/v1/security-events")
public class SecurityEventQueryController {

	private static final int DEFAULT_PAGE_SIZE = 20;
	private static final int MAX_PAGE_SIZE = 100;

	private final SecurityEventService securityEventService;

	public SecurityEventQueryController(SecurityEventService securityEventService) {
		this.securityEventService = securityEventService;
	}

	@GetMapping
	public PageResponse<SecurityEventResponse> list(
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
			@RequestParam(required = false) UUID deviceId,
			@RequestParam(required = false) String decision,
			@RequestParam(required = false) String reasonCode,
			@RequestParam(required = false) String severity,
			@RequestParam(defaultValue = "0") int page,
			@RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
		Pageable pageable = PageRequest.of(
				Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE), Sort.by(Sort.Direction.DESC, "occurredAt"));
		return securityEventService.search(from, to, deviceId, decision, reasonCode, severity, pageable);
	}

	@GetMapping("/{eventId}")
	public SecurityEventResponse get(@PathVariable UUID eventId) {
		return securityEventService.get(eventId);
	}
}
