package tech.certgate.enrollment;

import java.time.Instant;
import java.util.UUID;

public record CertificateRequestResponse(UUID id, UUID deviceId, CertificateRequestStatus status, Instant requestedAt) {

	public static CertificateRequestResponse from(CertificateRequest request) {
		return new CertificateRequestResponse(request.getId(), request.getDeviceId(), request.getStatus(), request.getRequestedAt());
	}
}
