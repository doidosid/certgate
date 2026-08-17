package tech.certgate.enrollment;

import java.io.IOException;
import java.io.StringReader;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.interfaces.RSAPublicKey;
import org.bouncycastle.asn1.ASN1ObjectIdentifier;
import org.bouncycastle.asn1.DERIA5String;
import org.bouncycastle.asn1.pkcs.Attribute;
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers;
import org.bouncycastle.asn1.sec.SECObjectIdentifiers;
import org.bouncycastle.asn1.x509.AlgorithmIdentifier;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.Extensions;
import org.bouncycastle.asn1.x509.GeneralName;
import org.bouncycastle.asn1.x509.GeneralNames;
import org.bouncycastle.asn1.x9.X9ObjectIdentifiers;
import org.bouncycastle.operator.jcajce.JcaContentVerifierProviderBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.openssl.PEMParser;
import org.bouncycastle.operator.ContentVerifierProvider;
import org.bouncycastle.pkcs.PKCS10CertificationRequest;
import org.bouncycastle.pkcs.jcajce.JcaPKCS10CertificationRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import tech.certgate.common.ApiException;

/**
 * Validates a submitted CSR PEM against security-design.md §4 (self-signature,
 * allowed public key, single SAN URI matching the Token's Device Key). Order
 * mirrors docs/api-spec.md §4 validation order 2-4 (Token check happens
 * before this, in EnrollmentService).
 */
@Component
public class CsrValidator {

	private static final BouncyCastleProvider BC = new BouncyCastleProvider();
	private static final String SAN_URI_PREFIX = "urn:certgate:device:";
	private static final int MIN_RSA_KEY_BITS = 2048;

	public ParsedCsr validate(String csrPem, String expectedDeviceKey) {
		if (csrPem == null || csrPem.isBlank()) {
			throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CSR_SIGNATURE_INVALID", "CSR이 비어 있습니다.");
		}
		PKCS10CertificationRequest csr = parse(csrPem);
		PublicKey publicKey = extractAndVerifyPublicKey(csr);
		String publicKeyAlgorithm = checkPublicKeyPolicy(csr, publicKey);
		String sanUri = extractSingleSanUri(csr);

		String expectedSanUri = SAN_URI_PREFIX + expectedDeviceKey;
		if (!sanUri.equals(expectedSanUri)) {
			throw sanInvalid("SAN URI의 Device Key가 Token 대상과 일치하지 않습니다.");
		}

		return new ParsedCsr(csr, publicKey, csr.getSubject(), sanUri, publicKeyAlgorithm, fingerprint(csr));
	}

	private PKCS10CertificationRequest parse(String csrPem) {
		try (PEMParser parser = new PEMParser(new StringReader(csrPem))) {
			Object parsed = parser.readObject();
			if (!(parsed instanceof PKCS10CertificationRequest csr)) {
				throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CSR_SIGNATURE_INVALID", "CSR 형식이 올바르지 않습니다.");
			}
			return csr;
		} catch (IOException e) {
			throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CSR_SIGNATURE_INVALID", "CSR을 읽을 수 없습니다.");
		}
	}

	private PublicKey extractAndVerifyPublicKey(PKCS10CertificationRequest csr) {
		try {
			PublicKey publicKey = new JcaPKCS10CertificationRequest(csr).setProvider(BC).getPublicKey();
			ContentVerifierProvider verifierProvider =
					new JcaContentVerifierProviderBuilder().setProvider(BC).build(publicKey);
			if (!csr.isSignatureValid(verifierProvider)) {
				throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CSR_SIGNATURE_INVALID", "CSR 자체 서명이 유효하지 않습니다.");
			}
			return publicKey;
		} catch (ApiException e) {
			throw e;
		} catch (Exception e) {
			throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CSR_SIGNATURE_INVALID", "CSR 서명을 검증할 수 없습니다.");
		}
	}

	private String checkPublicKeyPolicy(PKCS10CertificationRequest csr, PublicKey publicKey) {
		AlgorithmIdentifier algorithm = csr.getSubjectPublicKeyInfo().getAlgorithm();
		ASN1ObjectIdentifier algorithmOid = algorithm.getAlgorithm();

		if (X9ObjectIdentifiers.id_ecPublicKey.equals(algorithmOid)) {
			ASN1ObjectIdentifier curveOid = ASN1ObjectIdentifier.getInstance(algorithm.getParameters());
			if (!SECObjectIdentifiers.secp256r1.equals(curveOid)) {
				throw publicKeyPolicyViolation("ECDSA Key는 P-256 곡선만 허용합니다.");
			}
			return "EC-P256";
		}
		if (PKCSObjectIdentifiers.rsaEncryption.equals(algorithmOid) && publicKey instanceof RSAPublicKey rsaKey) {
			int bitLength = rsaKey.getModulus().bitLength();
			if (bitLength < MIN_RSA_KEY_BITS) {
				throw publicKeyPolicyViolation("RSA Key는 2048비트 이상이어야 합니다.");
			}
			return "RSA-" + bitLength;
		}
		throw publicKeyPolicyViolation("ECDSA P-256 또는 RSA 2048 이상만 허용합니다.");
	}

	private String extractSingleSanUri(PKCS10CertificationRequest csr) {
		try {
			Attribute[] extensionAttributes = csr.getAttributes(PKCSObjectIdentifiers.pkcs_9_at_extensionRequest);
			if (extensionAttributes.length == 0) {
				throw sanInvalid("CSR에 SAN 확장이 없습니다.");
			}
			Extensions extensions = Extensions.getInstance(extensionAttributes[0].getAttrValues().getObjectAt(0));
			Object sanValue = extensions.getExtensionParsedValue(Extension.subjectAlternativeName);
			if (sanValue == null) {
				throw sanInvalid("CSR에 SAN 확장이 없습니다.");
			}
			GeneralNames sanNames = GeneralNames.getInstance(sanValue);
			GeneralName[] names = sanNames.getNames();

			// ADR-001: 허용되는 SAN은 urn:certgate:device: URI 단 하나뿐이다. DNS/IP 등
			// 다른 SAN 타입이 섞여 있어도 여기서 함께 거절해 CSR 단계에서 원천 차단한다
			// (서명 시점에는 이 URI 하나만 복사하므로 발급된 인증서 자체는 영향받지 않는다).
			if (names.length != 1 || names[0].getTagNo() != GeneralName.uniformResourceIdentifier) {
				throw sanInvalid("SAN은 urn:certgate:device: URI 하나만 허용합니다.");
			}
			String uri = DERIA5String.getInstance(names[0].getName()).getString();
			if (!uri.startsWith(SAN_URI_PREFIX) || uri.length() == SAN_URI_PREFIX.length()) {
				throw sanInvalid("SAN URI 형식이 올바르지 않습니다.");
			}
			return uri;
		} catch (ApiException e) {
			throw e;
		} catch (RuntimeException e) {
			throw sanInvalid("SAN 확장을 파싱할 수 없습니다.");
		}
	}

	private String fingerprint(PKCS10CertificationRequest csr) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			byte[] hash = digest.digest(csr.getSubjectPublicKeyInfo().getEncoded());
			StringBuilder hex = new StringBuilder(hash.length * 2);
			for (byte b : hash) {
				hex.append(String.format("%02x", b));
			}
			return hex.toString();
		} catch (NoSuchAlgorithmException | IOException e) {
			throw new IllegalStateException("failed to fingerprint CSR public key", e);
		}
	}

	private ApiException sanInvalid(String message) {
		return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "SAN_URI_INVALID", message);
	}

	private ApiException publicKeyPolicyViolation(String message) {
		return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "PUBLIC_KEY_POLICY_VIOLATION", message);
	}
}
