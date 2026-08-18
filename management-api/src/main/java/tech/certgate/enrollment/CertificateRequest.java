package tech.certgate.enrollment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "certificate_request")
public class CertificateRequest {

	@Id
	private UUID id;

	@Column(name = "device_id", nullable = false)
	private UUID deviceId;

	@Column(name = "enrollment_credential_id", nullable = false)
	private UUID enrollmentCredentialId;

	@Column(name = "csr_pem", nullable = false)
	private String csrPem;

	@Column(name = "subject_dn")
	private String subjectDn;

	@Column(name = "san_uri")
	private String sanUri;

	@Column(name = "public_key_algorithm")
	private String publicKeyAlgorithm;

	@Column(name = "fingerprint_sha256")
	private String fingerprintSha256;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private CertificateRequestStatus status;

	@Column(name = "requested_at", nullable = false)
	private Instant requestedAt;

	@Column(name = "decided_at")
	private Instant decidedAt;

	@Column(name = "decision_note")
	private String decisionNote;

	protected CertificateRequest() {
	}

	public CertificateRequest(UUID id, UUID deviceId, UUID enrollmentCredentialId, ParsedCsr parsedCsr,
			String csrPem, Instant requestedAt) {
		this.id = id;
		this.deviceId = deviceId;
		this.enrollmentCredentialId = enrollmentCredentialId;
		this.csrPem = csrPem;
		this.subjectDn = parsedCsr.subject().toString();
		this.sanUri = parsedCsr.sanUri();
		this.publicKeyAlgorithm = parsedCsr.publicKeyAlgorithm();
		this.fingerprintSha256 = parsedCsr.fingerprintSha256();
		this.status = CertificateRequestStatus.PENDING;
		this.requestedAt = requestedAt;
	}

	public void approve(Instant decidedAt, String decisionNote) {
		this.status = CertificateRequestStatus.APPROVED;
		this.decidedAt = decidedAt;
		this.decisionNote = decisionNote;
	}

	public void reject(Instant decidedAt, String decisionNote) {
		this.status = CertificateRequestStatus.REJECTED;
		this.decidedAt = decidedAt;
		this.decisionNote = decisionNote;
	}

	public UUID getId() {
		return id;
	}

	public UUID getDeviceId() {
		return deviceId;
	}

	public String getCsrPem() {
		return csrPem;
	}

	public String getSubjectDn() {
		return subjectDn;
	}

	public String getSanUri() {
		return sanUri;
	}

	public String getPublicKeyAlgorithm() {
		return publicKeyAlgorithm;
	}

	public String getFingerprintSha256() {
		return fingerprintSha256;
	}

	public CertificateRequestStatus getStatus() {
		return status;
	}

	public Instant getRequestedAt() {
		return requestedAt;
	}

	public Instant getDecidedAt() {
		return decidedAt;
	}

	public String getDecisionNote() {
		return decisionNote;
	}
}
