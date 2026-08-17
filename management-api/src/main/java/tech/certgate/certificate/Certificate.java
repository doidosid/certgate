package tech.certgate.certificate;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import tech.certgate.enrollment.IssuedCertificate;

@Entity
@Table(name = "certificate")
public class Certificate {

	@Id
	private UUID id;

	@Column(name = "device_id", nullable = false)
	private UUID deviceId;

	@Column(name = "request_id", nullable = false, unique = true)
	private UUID requestId;

	@Column(name = "serial_number", nullable = false, unique = true)
	private String serialNumber;

	@Column(name = "certificate_pem", nullable = false)
	private String certificatePem;

	@Column(name = "subject_dn")
	private String subjectDn;

	@Column(name = "san_uri")
	private String sanUri;

	@Column(name = "fingerprint_sha256", nullable = false, unique = true)
	private String fingerprintSha256;

	@Column(name = "not_before", nullable = false)
	private Instant notBefore;

	@Column(name = "not_after", nullable = false)
	private Instant notAfter;

	@Column(name = "issued_at", nullable = false)
	private Instant issuedAt;

	@Column(name = "revoked_at")
	private Instant revokedAt;

	@Column(name = "revocation_reason")
	private String revocationReason;

	@Column(name = "revocation_note")
	private String revocationNote;

	protected Certificate() {
	}

	public Certificate(UUID id, UUID deviceId, UUID requestId, IssuedCertificate issued, Instant issuedAt) {
		this.id = id;
		this.deviceId = deviceId;
		this.requestId = requestId;
		this.serialNumber = issued.serialNumber();
		this.certificatePem = issued.certificatePem();
		this.subjectDn = issued.subjectDn();
		this.sanUri = issued.sanUri();
		this.fingerprintSha256 = issued.fingerprintSha256();
		this.notBefore = issued.notBefore();
		this.notAfter = issued.notAfter();
		this.issuedAt = issuedAt;
	}

	public UUID getId() {
		return id;
	}

	public UUID getDeviceId() {
		return deviceId;
	}

	public UUID getRequestId() {
		return requestId;
	}

	public String getSerialNumber() {
		return serialNumber;
	}

	public String getCertificatePem() {
		return certificatePem;
	}

	public Instant getNotAfter() {
		return notAfter;
	}

	public Instant getRevokedAt() {
		return revokedAt;
	}

	public String getSubjectDn() {
		return subjectDn;
	}

	public String getSanUri() {
		return sanUri;
	}

	/** docs/api-spec.md §5: REVOKED > EXPIRED > EXPIRING_SOON (7 days) > VALID. */
	public CertificateStatus status(Instant now) {
		if (revokedAt != null) {
			return CertificateStatus.REVOKED;
		}
		if (now.isAfter(notAfter)) {
			return CertificateStatus.EXPIRED;
		}
		if (Duration.between(now, notAfter).toDays() <= 7) {
			return CertificateStatus.EXPIRING_SOON;
		}
		return CertificateStatus.VALID;
	}
}
