package tech.certgate.enrollment;

import java.time.Instant;
import java.util.UUID;

public record CertificateRequestResponse(
		UUID id, UUID deviceId, CertificateRequestStatus status, String sanUri, String publicKeyAlgorithm, Instant requestedAt) {

	public static CertificateRequestResponse from(CertificateRequest request) {
		return new CertificateRequestResponse(
				request.getId(), request.getDeviceId(), request.getStatus(), request.getSanUri(),
				request.getPublicKeyAlgorithm(), request.getRequestedAt());
	}
}
