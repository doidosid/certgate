package tech.certgate.enrollment;

import java.time.Instant;

public record IssuedCertificate(
		String certificatePem,
		String caChainPem,
		String serialNumber,
		String subjectDn,
		String sanUri,
		String fingerprintSha256,
		Instant notBefore,
		Instant notAfter) {
}
