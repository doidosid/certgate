package tech.certgate.enrollment;

import java.security.PublicKey;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.pkcs.PKCS10CertificationRequest;

/** Result of validating a submitted CSR against ADR-001 and security-design.md's CSR rules. */
public record ParsedCsr(
		PKCS10CertificationRequest request,
		PublicKey publicKey,
		X500Name subject,
		String sanUri,
		String publicKeyAlgorithm,
		String fingerprintSha256) {
}
