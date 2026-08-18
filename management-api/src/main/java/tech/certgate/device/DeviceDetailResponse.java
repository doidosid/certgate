package tech.certgate.device;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import tech.certgate.certificate.CertificateStatus;

/** docs/api-spec.md §3 "인증서·정책·최근 Event를 포함한 상세". */
public record DeviceDetailResponse(
		UUID id,
		String deviceKey,
		String name,
		DeviceStatus status,
		String roleName,
		Instant createdAt,
		Instant lastSeenAt,
		CertificateSummary certificate,
		List<PolicyRuleView> policyRules,
		List<SecurityEventView> recentEvents) {

	/** Null when the Device has no issued Certificate yet. */
	public record CertificateSummary(UUID id, String serialNumber, CertificateStatus status, Instant expiresAt) {
	}

	public record PolicyRuleView(String httpMethod, String pathPattern, String effect, int priority) {
	}

	public record SecurityEventView(
			UUID id, Instant occurredAt, String type, String severity, String decision, String reasonCode,
			String httpMethod, String requestPath) {
	}
}
