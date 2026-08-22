package tech.certgate.enrollment;

import java.io.IOException;
import java.io.StringWriter;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x509.BasicConstraints;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.ExtendedKeyUsage;
import org.bouncycastle.asn1.x509.GeneralName;
import org.bouncycastle.asn1.x509.GeneralNames;
import org.bouncycastle.asn1.x509.KeyPurposeId;
import org.bouncycastle.asn1.x509.KeyUsage;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.X509v3CertificateBuilder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509ExtensionUtils;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.openssl.PEMKeyPair;
import org.bouncycastle.openssl.PEMParser;
import org.bouncycastle.openssl.jcajce.JcaPEMKeyConverter;
import org.bouncycastle.openssl.jcajce.JcaPEMWriter;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import org.bouncycastle.pkcs.PKCS10CertificationRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import tech.certgate.common.ApiException;

/**
 * Signs approved Device CSRs with the Intermediate CA (ADR-002, ADR-003). The
 * Root CA is only read here to build the download chain PEM; its key is
 * never loaded by this service.
 */
@Component
public class IntermediateCertificateAuthority {

	private static final BouncyCastleProvider BC = new BouncyCastleProvider();
	private static final String SIGNATURE_ALGORITHM = "SHA256withECDSA";

	private final String rootCertPath;
	private final String intermediateCertPath;
	private final String intermediateKeyPath;
	private final Clock clock;
	private final long certificateValidityDays;
	private final SecureRandom random = new SecureRandom();

	private volatile CaMaterial caMaterial;

	private record CaMaterial(X509Certificate rootCert, X509Certificate intermediateCert, PrivateKey intermediateKey) {
	}

	public IntermediateCertificateAuthority(
			@Value("${certgate.ca.root-cert-path}") String rootCertPath,
			@Value("${certgate.ca.intermediate-cert-path}") String intermediateCertPath,
			@Value("${certgate.ca.intermediate-key-path}") String intermediateKeyPath,
			@Value("${certgate.certificate.validity-days:30}") long certificateValidityDays,
			Clock clock) {
		this.rootCertPath = rootCertPath;
		this.intermediateCertPath = intermediateCertPath;
		this.intermediateKeyPath = intermediateKeyPath;
		this.certificateValidityDays = certificateValidityDays;
		this.clock = clock;
	}

	/** Loads and caches the CA cert/key files on first use, not at startup. */
	private synchronized CaMaterial loadCaMaterial() {
		if (caMaterial == null) {
			if (rootCertPath.isBlank() || intermediateCertPath.isBlank() || intermediateKeyPath.isBlank()) {
				throw new IllegalStateException("ROOT_CA_CERT_PATH/INTERMEDIATE_CA_CERT_PATH/INTERMEDIATE_CA_KEY_PATH not configured");
			}
			caMaterial = new CaMaterial(
					readCertificate(Path.of(rootCertPath)),
					readCertificate(Path.of(intermediateCertPath)),
					readPrivateKey(Path.of(intermediateKeyPath)));
		}
		return caMaterial;
	}

	public IssuedCertificate sign(ParsedCsr csr) {
		try {
			CaMaterial ca = loadCaMaterial();
			X509Certificate intermediateCert = ca.intermediateCert();
			X509Certificate rootCert = ca.rootCert();
			PrivateKey intermediateKey = ca.intermediateKey();

			Instant now = clock.instant();
			Instant intermediateNotAfter = intermediateCert.getNotAfter().toInstant();
			Instant requestedNotAfter = now.plus(Duration.ofDays(certificateValidityDays));
			Instant notAfter = requestedNotAfter.isAfter(intermediateNotAfter) ? intermediateNotAfter : requestedNotAfter;

			BigInteger serial = new BigInteger(64, random);
			X500Name issuer = new JcaX509CertificateHolder(intermediateCert).getSubject();

			X509v3CertificateBuilder certBuilder = new X509v3CertificateBuilder(
					issuer, serial, Date.from(now), Date.from(notAfter), csr.subject(), csr.request().getSubjectPublicKeyInfo());

			JcaX509ExtensionUtils extUtils = new JcaX509ExtensionUtils();
			certBuilder.addExtension(Extension.basicConstraints, true, new BasicConstraints(false));
			certBuilder.addExtension(Extension.keyUsage, true,
					new KeyUsage(KeyUsage.digitalSignature | KeyUsage.keyEncipherment));
			certBuilder.addExtension(Extension.extendedKeyUsage, false,
					new ExtendedKeyUsage(KeyPurposeId.id_kp_clientAuth));
			certBuilder.addExtension(Extension.subjectAlternativeName, true,
					new GeneralNames(new GeneralName(GeneralName.uniformResourceIdentifier, csr.sanUri())));
			certBuilder.addExtension(Extension.authorityKeyIdentifier, false,
					extUtils.createAuthorityKeyIdentifier(intermediateCert));
			certBuilder.addExtension(Extension.subjectKeyIdentifier, false,
					extUtils.createSubjectKeyIdentifier(csr.publicKey()));

			ContentSigner signer = new JcaContentSignerBuilder(SIGNATURE_ALGORITHM).setProvider(BC).build(intermediateKey);
			X509CertificateHolder certHolder = certBuilder.build(signer);
			X509Certificate certificate = new JcaX509CertificateConverter().setProvider(BC).getCertificate(certHolder);

			return new IssuedCertificate(
					toPem(certificate),
					toPem(intermediateCert) + toPem(rootCert),
					serial.toString(16).toUpperCase(),
					csr.subject().toString(),
					csr.sanUri(),
					issuer.toString(),
					fingerprint(certificate),
					certificate.getNotBefore().toInstant(),
					certificate.getNotAfter().toInstant());
		} catch (Exception e) {
			throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "CA_SIGNING_FAILED", "인증서 서명에 실패했습니다.");
		}
	}

	/** Intermediate + Root CA chain PEM, for handing to a Device alongside its certificate. */
	public String chainPem() {
		try {
			CaMaterial ca = loadCaMaterial();
			return toPem(ca.intermediateCert()) + toPem(ca.rootCert());
		} catch (Exception e) {
			throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "CA_SIGNING_FAILED", "CA Chain을 읽을 수 없습니다.");
		}
	}

	private static X509Certificate readCertificate(Path path) {
		try (PEMParser parser = new PEMParser(Files.newBufferedReader(path))) {
			Object parsed = parser.readObject();
			if (!(parsed instanceof X509CertificateHolder holder)) {
				throw new IllegalStateException("not a certificate: " + path);
			}
			return new JcaX509CertificateConverter().setProvider(BC).getCertificate(holder);
		} catch (IOException | CertificateException e) {
			throw new IllegalStateException("failed to load CA certificate: " + path, e);
		}
	}

	private static PrivateKey readPrivateKey(Path path) {
		try (PEMParser parser = new PEMParser(Files.newBufferedReader(path))) {
			Object parsed = parser.readObject();
			JcaPEMKeyConverter converter = new JcaPEMKeyConverter().setProvider(BC);
			if (parsed instanceof org.bouncycastle.asn1.pkcs.PrivateKeyInfo info) {
				return converter.getPrivateKey(info);
			}
			if (parsed instanceof PEMKeyPair pair) {
				return converter.getPrivateKey(pair.getPrivateKeyInfo());
			}
			throw new IllegalStateException("unsupported private key format: " + path);
		} catch (IOException e) {
			throw new IllegalStateException("failed to load CA private key: " + path, e);
		}
	}

	private static String toPem(X509Certificate certificate) throws IOException, CertificateException {
		StringWriter writer = new StringWriter();
		try (JcaPEMWriter pemWriter = new JcaPEMWriter(writer)) {
			pemWriter.writeObject(certificate);
		}
		return writer.toString();
	}

	private static String fingerprint(X509Certificate certificate) throws Exception {
		MessageDigest digest = MessageDigest.getInstance("SHA-256");
		byte[] hash = digest.digest(certificate.getEncoded());
		StringBuilder hex = new StringBuilder(hash.length * 2);
		for (byte b : hash) {
			hex.append(String.format("%02x", b));
		}
		return hex.toString();
	}
}
