package tech.certgate.certificate;

import java.time.Instant;
import java.util.UUID;

/** docs/api-spec.md §5 "Certificate API". Excludes the raw PEM — that is served only by the download endpoint. */
public record CertificateResponse(
		UUID id,
		UUID deviceId,
		String serialNumber,
		CertificateStatus status,
		Instant notBefore,
		Instant notAfter,
		Instant issuedAt,
		Instant revokedAt,
		String revocationReason,
		String revocationNote) {

	public static CertificateResponse from(Certificate certificate, Instant now) {
		return new CertificateResponse(
				certificate.getId(), certificate.getDeviceId(), certificate.getSerialNumber(), certificate.status(now),
				certificate.getNotBefore(), certificate.getNotAfter(), certificate.getIssuedAt(),
				certificate.getRevokedAt(), certificate.getRevocationReason(), certificate.getRevocationNote());
	}
}
