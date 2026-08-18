package tech.certgate.certificate;

/** docs/api-spec.md §5 "폐기 요청". */
public record CertificateRevokeRequest(String reason, String note) {
}
