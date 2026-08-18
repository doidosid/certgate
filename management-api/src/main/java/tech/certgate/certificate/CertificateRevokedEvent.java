package tech.certgate.certificate;

/**
 * Published after a Certificate revocation Transaction commits, so the
 * Gateway Cache invalidation call happens strictly after commit
 * (docs/security-design.md §6, docs/api-spec.md §5).
 */
public record CertificateRevokedEvent(String serialNumber) {
}
