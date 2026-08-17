package tech.certgate.certificate;

/** Computed from revokedAt/notAfter, never stored (docs/api-spec.md §5). */
public enum CertificateStatus {
	REVOKED,
	EXPIRED,
	EXPIRING_SOON,
	VALID
}
