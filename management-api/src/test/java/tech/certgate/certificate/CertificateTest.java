package tech.certgate.certificate;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tech.certgate.enrollment.IssuedCertificate;

/** docs/api-spec.md §5: REVOKED > EXPIRED > EXPIRING_SOON (7 days) > VALID. */
class CertificateTest {

	private static final Instant NOW = Instant.parse("2026-08-17T00:00:00Z");

	private Certificate certificateExpiringAt(Instant notAfter) {
		IssuedCertificate issued = new IssuedCertificate(
				"cert-pem", "chain-pem", "SERIAL", "CN=test", "urn:certgate:device:test", "CN=CertGate Intermediate CA",
				"fingerprint", NOW.minus(Duration.ofDays(30)), notAfter);
		return new Certificate(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), issued, NOW.minus(Duration.ofDays(30)));
	}

	@Test
	void status_revokedTakesPriorityOverExpiry() throws Exception {
		Certificate certificate = certificateExpiringAt(NOW.plus(Duration.ofDays(30)));
		java.lang.reflect.Field revokedAt = Certificate.class.getDeclaredField("revokedAt");
		revokedAt.setAccessible(true);
		revokedAt.set(certificate, NOW.minus(Duration.ofDays(1)));

		assertThat(certificate.status(NOW)).isEqualTo(CertificateStatus.REVOKED);
	}

	@Test
	void status_afterNotAfter_isExpired() {
		Certificate certificate = certificateExpiringAt(NOW.minus(Duration.ofSeconds(1)));
		assertThat(certificate.status(NOW)).isEqualTo(CertificateStatus.EXPIRED);
	}

	@Test
	void status_exactlySevenDaysRemaining_isExpiringSoon() {
		Certificate certificate = certificateExpiringAt(NOW.plus(Duration.ofDays(7)));
		assertThat(certificate.status(NOW)).isEqualTo(CertificateStatus.EXPIRING_SOON);
	}

	@Test
	void status_justOverSevenDaysRemaining_isValidNotExpiringSoon() {
		// Regression for a bug where Duration.toDays() truncation classified
		// 7 days + 23h59m59s remaining as EXPIRING_SOON.
		Certificate certificate = certificateExpiringAt(NOW.plus(Duration.ofDays(7)).plus(Duration.ofHours(23)).plus(Duration.ofMinutes(59)));
		assertThat(certificate.status(NOW)).isEqualTo(CertificateStatus.VALID);
	}

	@Test
	void status_wellBeyondSevenDays_isValid() {
		Certificate certificate = certificateExpiringAt(NOW.plus(Duration.ofDays(30)));
		assertThat(certificate.status(NOW)).isEqualTo(CertificateStatus.VALID);
	}
}
