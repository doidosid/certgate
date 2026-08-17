package tech.certgate.enrollment;

import java.time.Instant;

public record CertificateDownloadResponse(String certificatePem, String caChainPem, String serialNumber, Instant notAfter) {
}
