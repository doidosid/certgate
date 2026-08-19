package tech.certgate.dashboard;

import java.util.Map;

/**
 * User-facing Korean text for a CRITICAL Security Event's Reason Code,
 * separate from the internal Reason Code itself (development-guide.md
 * "사용자에게 보여줄 Message와 내부 Reason Code를 분리한다").
 *
 * <p>All four entries are emitted today: {@code CERTIFICATE_REVOKED} by the
 * Gateway's access decisions, {@code CA_SIGNING_FAILED} by this service's
 * EnrollmentService, and the two Outbox codes by the Gateway's Outbox Monitor
 * (gateway/internal/outbox/monitor.go). The remaining CRITICAL condition of
 * docs/security-design.md §9 — repeated Invalid Certificate from one IP — has
 * no producer yet. The fallback keeps this mapper from silently going stale if
 * a new Reason Code starts being emitted before this map is updated.
 */
final class CriticalEventMessages {

	private static final Map<String, String> MESSAGES_BY_REASON_CODE = Map.of(
			"CERTIFICATE_REVOKED", "폐기된 인증서의 접근이 차단되었습니다.",
			"CA_SIGNING_FAILED", "Certificate 서명에 실패했습니다.",
			"EVENT_OUTBOX_BACKLOG", "Gateway Security Event Outbox가 적체되었습니다.",
			"EVENT_DELIVERY_DELAYED", "Gateway Security Event 전달이 지연되고 있습니다.");

	private static final String DEFAULT_MESSAGE = "심각도 높은 보안 이벤트가 발생했습니다.";

	private CriticalEventMessages() {
	}

	static String forReasonCode(String reasonCode) {
		return MESSAGES_BY_REASON_CODE.getOrDefault(reasonCode, DEFAULT_MESSAGE);
	}
}
