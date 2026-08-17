package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;

/**
 * Verifies ADR-003's upper bound: an issued Certificate's validity must not
 * exceed the Intermediate CA's own remaining validity, even when the Device
 * requests (via the configured default) a longer lifetime.
 */
class IntermediateCertificateAuthorityTest {

	@Test
	void sign_clampsNotAfterToIntermediateCasRemainingValidity() throws Exception {
		Path dir = Files.createTempDirectory("certgate-clamp-test");
		// X.509 time encoding has 1-second resolution, so truncate to match round-tripped values.
		Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
		// Intermediate CA expires in 5 days, sooner than the requested 30-day Certificate lifetime.
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir, Duration.ofDays(5));

		IntermediateCertificateAuthority authority = new IntermediateCertificateAuthority(
				ca.rootCertPath().toString(), ca.intermediateCertPath().toString(), ca.intermediateKeyPath().toString(),
				30, Clock.fixed(now, ZoneOffset.UTC));

		KeyPair deviceKeyPair = TestCaFixture.generateEcKeyPair();
		String csrPem = TestCaFixture.createDeviceCsrPem("sensor-clamp-test", deviceKeyPair);
		ParsedCsr parsed = new CsrValidator().validate(csrPem, "sensor-clamp-test");

		IssuedCertificate issued = authority.sign(parsed);

		Instant intermediateNotAfter = readCertificate(ca.intermediateCertPath()).getNotAfter().toInstant();

		assertThat(issued.notAfter()).isEqualTo(intermediateNotAfter);
		assertThat(issued.notAfter()).isBefore(now.plus(Duration.ofDays(30)));
	}

	@Test
	void sign_usesRequestedValidityWhenIntermediateCaOutlivesIt() throws Exception {
		Path dir = Files.createTempDirectory("certgate-no-clamp-test");
		// X.509 time encoding has 1-second resolution, so truncate to match round-tripped values.
		Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
		TestCaFixture.CaPaths ca = TestCaFixture.generate(dir, Duration.ofDays(1095));

		IntermediateCertificateAuthority authority = new IntermediateCertificateAuthority(
				ca.rootCertPath().toString(), ca.intermediateCertPath().toString(), ca.intermediateKeyPath().toString(),
				30, Clock.fixed(now, ZoneOffset.UTC));

		KeyPair deviceKeyPair = TestCaFixture.generateEcKeyPair();
		String csrPem = TestCaFixture.createDeviceCsrPem("sensor-no-clamp-test", deviceKeyPair);
		ParsedCsr parsed = new CsrValidator().validate(csrPem, "sensor-no-clamp-test");

		IssuedCertificate issued = authority.sign(parsed);

		assertThat(issued.notAfter()).isEqualTo(now.plus(Duration.ofDays(30)));
	}

	private static X509Certificate readCertificate(Path path) throws Exception {
		CertificateFactory factory = CertificateFactory.getInstance("X.509");
		try (InputStream in = Files.newInputStream(path)) {
			return (X509Certificate) factory.generateCertificate(in);
		}
	}
}
