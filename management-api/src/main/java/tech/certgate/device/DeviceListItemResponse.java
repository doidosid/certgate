package tech.certgate.device;

import java.time.Instant;
import java.util.UUID;
import tech.certgate.certificate.CertificateStatus;

/**
 * docs/api-spec.md §3 "목록·상세·상태·Role" 목록 항목. {@code certificateStatus}/
 * {@code certificateExpiresAt}는 아직 Certificate가 발급되지 않은 Device에는
 * null이다 — 문서에 명시된 계약은 아니고 Certificate API의 상태 계산과
 * 일관되게 맞춘 판단이다.
 */
public record DeviceListItemResponse(
		UUID id,
		String deviceKey,
		String name,
		DeviceStatus status,
		String roleName,
		CertificateStatus certificateStatus,
		Instant certificateExpiresAt,
		Instant lastSeenAt) {
}
