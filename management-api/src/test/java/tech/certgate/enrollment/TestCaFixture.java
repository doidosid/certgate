package tech.certgate.enrollment;

import java.io.IOException;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import org.bouncycastle.asn1.pkcs.PKCSObjectIdentifiers;
import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.asn1.x509.BasicConstraints;
import org.bouncycastle.asn1.x509.Extension;
import org.bouncycastle.asn1.x509.ExtensionsGenerator;
import org.bouncycastle.asn1.x509.GeneralName;
import org.bouncycastle.asn1.x509.GeneralNames;
import org.bouncycastle.asn1.x509.KeyUsage;
import org.bouncycastle.cert.X509v3CertificateBuilder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509ExtensionUtils;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.openssl.jcajce.JcaPEMWriter;
import org.bouncycastle.operator.ContentSigner;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;
import org.bouncycastle.pkcs.PKCS10CertificationRequest;
import org.bouncycastle.pkcs.PKCS10CertificationRequestBuilder;
import org.bouncycastle.pkcs.jcajce.JcaPKCS10CertificationRequestBuilder;

/**
 * Generates a throwaway Root/Intermediate CA per test run, matching
 * pki/README.md's "Test는 매 실행마다 임시 PKI를 생성" convention, without
 * depending on the openssl CLI being present in the JVM test process.
 */
public final class TestCaFixture {

	private static final BouncyCastleProvider BC = new BouncyCastleProvider();
	private static final String SIGNATURE_ALGORITHM = "SHA256withECDSA";

	private TestCaFixture() {
	}

	public record CaPaths(Path rootCertPath, Path intermediateCertPath, Path intermediateKeyPath, X509Certificate rootCert) {
	}

	public static CaPaths generate(Path dir) throws Exception {
		return generate(dir, Duration.ofDays(1095));
	}

	/** For M-03: an Intermediate CA whose remaining validity is shorter than the requested Certificate lifetime. */
	public static CaPaths generate(Path dir, Duration intermediateValidity) throws Exception {
		KeyPair rootKeyPair = generateEcKeyPair();
		KeyPair intermediateKeyPair = generateEcKeyPair();

		Instant now = Instant.now();
		X509Certificate rootCert = selfSignedRoot(rootKeyPair, now, now.plus(Duration.ofDays(3650)));
		X509Certificate intermediateCert = signIntermediate(
				rootCert, rootKeyPair.getPrivate(), intermediateKeyPair.getPublic(), now, now.plus(intermediateValidity));

		Path rootCertPath = dir.resolve("root-ca.crt");
		Path intermediateCertPath = dir.resolve("intermediate-ca.crt");
		Path intermediateKeyPath = dir.resolve("intermediate-ca.key");
		writePem(rootCertPath, rootCert);
		writePem(intermediateCertPath, intermediateCert);
		writePem(intermediateKeyPath, intermediateKeyPair.getPrivate());

		return new CaPaths(rootCertPath, intermediateCertPath, intermediateKeyPath, rootCert);
	}

	public static String createDeviceCsrPem(String deviceKey, KeyPair deviceKeyPair) throws Exception {
		return buildCsrPem(deviceKey, deviceKeyPair.getPublic(), deviceKeyPair.getPrivate(),
				new GeneralName(GeneralName.uniformResourceIdentifier, "urn:certgate:device:" + deviceKey));
	}

	/** For M-02: a CSR whose SAN carries the valid URI plus an extra, unrelated DNS name. */
	public static String createDeviceCsrPemWithExtraDnsSan(String deviceKey, KeyPair deviceKeyPair, String dnsName) throws Exception {
		return buildCsrPem(deviceKey, deviceKeyPair.getPublic(), deviceKeyPair.getPrivate(),
				new GeneralName(GeneralName.uniformResourceIdentifier, "urn:certgate:device:" + deviceKey),
				new GeneralName(GeneralName.dNSName, dnsName));
	}

	/** For M-02: a CSR whose declared public key does not match the key that actually produced the signature. */
	public static String createCsrPemWithMismatchedSignature(String deviceKey, KeyPair declaredKeyPair, KeyPair signingKeyPair) throws Exception {
		return buildCsrPem(deviceKey, declaredKeyPair.getPublic(), signingKeyPair.getPrivate(),
				new GeneralName(GeneralName.uniformResourceIdentifier, "urn:certgate:device:" + deviceKey));
	}

	private static String buildCsrPem(String deviceKey, PublicKey subjectPublicKey, PrivateKey signingKey, GeneralName... sanEntries)
			throws Exception {
		X500Name subject = new X500Name("CN=" + deviceKey);
		PKCS10CertificationRequestBuilder builder = new JcaPKCS10CertificationRequestBuilder(subject, subjectPublicKey);

		GeneralNames sanNames = new GeneralNames(sanEntries);
		ExtensionsGenerator extensionsGenerator = new ExtensionsGenerator();
		extensionsGenerator.addExtension(Extension.subjectAlternativeName, true, sanNames);
		builder.addAttribute(PKCSObjectIdentifiers.pkcs_9_at_extensionRequest, extensionsGenerator.generate());

		ContentSigner signer = new JcaContentSignerBuilder(signatureAlgorithmFor(signingKey)).setProvider(BC).build(signingKey);
		PKCS10CertificationRequest csr = builder.build(signer);
		return toPem(csr);
	}

	private static String signatureAlgorithmFor(PrivateKey key) {
		return "RSA".equals(key.getAlgorithm()) ? "SHA256withRSA" : SIGNATURE_ALGORITHM;
	}

	public static KeyPair generateEcKeyPair() throws Exception {
		return generateEcKeyPair("secp256r1");
	}

	/** For M-02: a non-P-256 curve, which CsrValidator's public key policy must reject. */
	public static KeyPair generateEcKeyPair(String curveName) throws Exception {
		KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", BC);
		generator.initialize(new ECGenParameterSpec(curveName), new SecureRandom());
		return generator.generateKeyPair();
	}

	/** For M-02: RSA keys, to exercise the minimum-key-size branch of the public key policy. */
	public static KeyPair generateRsaKeyPair(int bits) throws Exception {
		KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA", BC);
		generator.initialize(bits, new SecureRandom());
		return generator.generateKeyPair();
	}

	private static X509Certificate selfSignedRoot(KeyPair keyPair, Instant notBefore, Instant notAfter) throws Exception {
		X500Name name = new X500Name("CN=Test Root CA");
		X509v3CertificateBuilder builder = new JcaX509v3CertificateBuilder(
				name, BigInteger.valueOf(1), Date.from(notBefore), Date.from(notAfter), name, keyPair.getPublic());

		JcaX509ExtensionUtils extUtils = new JcaX509ExtensionUtils();
		builder.addExtension(Extension.basicConstraints, true, new BasicConstraints(true));
		builder.addExtension(Extension.keyUsage, true, new KeyUsage(KeyUsage.keyCertSign | KeyUsage.cRLSign));
		builder.addExtension(Extension.subjectKeyIdentifier, false, extUtils.createSubjectKeyIdentifier(keyPair.getPublic()));

		ContentSigner signer = new JcaContentSignerBuilder(SIGNATURE_ALGORITHM).setProvider(BC).build(keyPair.getPrivate());
		return new JcaX509CertificateConverter().setProvider(BC).getCertificate(builder.build(signer));
	}

	private static X509Certificate signIntermediate(
			X509Certificate issuerCert, PrivateKey issuerKey, PublicKey subjectPublicKey, Instant notBefore, Instant notAfter)
			throws Exception {
		X500Name issuerName = new JcaX509CertificateHolder(issuerCert).getSubject();
		X500Name subjectName = new X500Name("CN=Test Intermediate CA");
		X509v3CertificateBuilder builder = new JcaX509v3CertificateBuilder(
				issuerName, BigInteger.valueOf(2), Date.from(notBefore), Date.from(notAfter), subjectName, subjectPublicKey);

		JcaX509ExtensionUtils extUtils = new JcaX509ExtensionUtils();
		builder.addExtension(Extension.basicConstraints, true, new BasicConstraints(0));
		builder.addExtension(Extension.keyUsage, true, new KeyUsage(KeyUsage.keyCertSign | KeyUsage.cRLSign));
		builder.addExtension(Extension.authorityKeyIdentifier, false, extUtils.createAuthorityKeyIdentifier(issuerCert));
		builder.addExtension(Extension.subjectKeyIdentifier, false, extUtils.createSubjectKeyIdentifier(subjectPublicKey));

		ContentSigner signer = new JcaContentSignerBuilder(SIGNATURE_ALGORITHM).setProvider(BC).build(issuerKey);
		return new JcaX509CertificateConverter().setProvider(BC).getCertificate(builder.build(signer));
	}

	private static void writePem(Path path, Object obj) throws IOException {
		try (JcaPEMWriter writer = new JcaPEMWriter(Files.newBufferedWriter(path))) {
			writer.writeObject(obj);
		}
	}

	private static String toPem(Object obj) throws IOException {
		java.io.StringWriter stringWriter = new java.io.StringWriter();
		try (JcaPEMWriter writer = new JcaPEMWriter(stringWriter)) {
			writer.writeObject(obj);
		}
		return stringWriter.toString();
	}
}
