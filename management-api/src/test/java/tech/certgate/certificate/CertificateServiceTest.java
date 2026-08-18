package tech.certgate.certificate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import tech.certgate.common.ApiException;
import tech.certgate.enrollment.IssuedCertificate;

/** docs/api-spec.md §5 "Certificate API". */
class CertificateServiceTest {

	private static final Instant NOW = Instant.parse("2026-08-18T00:00:00Z");

	private Certificate newCertificate(UUID id) {
		IssuedCertificate issued = new IssuedCertificate(
				"-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----", "-----BEGIN CERTIFICATE-----chain-----END CERTIFICATE-----",
				"SERIAL-1", "CN=sensor-01", "urn:certgate:device:sensor-01", "fp-1",
				NOW.minus(Duration.ofDays(1)), NOW.plus(Duration.ofDays(29)));
		return new Certificate(id, UUID.randomUUID(), UUID.randomUUID(), issued, NOW.minus(Duration.ofDays(1)));
	}

	@Test
	void revoke_setsRevocationFieldsAndPublishesEvent() {
		CertificateRepository certificates = mock(CertificateRepository.class);
		ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
		Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
		UUID certificateId = UUID.randomUUID();
		Certificate certificate = newCertificate(certificateId);
		when(certificates.findByIdForUpdate(certificateId)).thenReturn(Optional.of(certificate));

		CertificateService service = new CertificateService(certificates, events, clock);
		CertificateResponse response = service.revoke(certificateId, new CertificateRevokeRequest("KEY_COMPROMISE", "분실 신고"));

		assertThat(response.status()).isEqualTo(CertificateStatus.REVOKED);
		assertThat(response.revocationReason()).isEqualTo("KEY_COMPROMISE");
		assertThat(certificate.getRevokedAt()).isEqualTo(NOW);
		verify(events).publishEvent(new CertificateRevokedEvent("SERIAL-1"));
	}

	@Test
	void revoke_blankReason_isRejectedBeforeTouchingTheRepository() {
		CertificateRepository certificates = mock(CertificateRepository.class);
		ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
		CertificateService service = new CertificateService(certificates, events, Clock.fixed(NOW, ZoneOffset.UTC));

		assertThatThrownBy(() -> service.revoke(UUID.randomUUID(), new CertificateRevokeRequest(" ", null)))
				.isInstanceOf(ApiException.class)
				.satisfies(ex -> assertThat(((ApiException) ex).getReasonCode()).isEqualTo("REVOCATION_REASON_REQUIRED"));
		verify(certificates, never()).findByIdForUpdate(any());
	}

	@Test
	void revoke_alreadyRevoked_isConflict() {
		CertificateRepository certificates = mock(CertificateRepository.class);
		ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
		Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
		UUID certificateId = UUID.randomUUID();
		Certificate certificate = newCertificate(certificateId);
		certificate.revoke("KEY_COMPROMISE", null, NOW.minus(Duration.ofHours(1)));
		when(certificates.findByIdForUpdate(certificateId)).thenReturn(Optional.of(certificate));

		CertificateService service = new CertificateService(certificates, events, clock);

		assertThatThrownBy(() -> service.revoke(certificateId, new CertificateRevokeRequest("KEY_COMPROMISE", null)))
				.isInstanceOf(ApiException.class)
				.satisfies(ex -> assertThat(((ApiException) ex).getReasonCode()).isEqualTo("CONFLICT"));
		verify(events, never()).publishEvent(any());
	}

	@Test
	void revoke_unknownCertificateId_isNotFound() {
		CertificateRepository certificates = mock(CertificateRepository.class);
		ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
		UUID certificateId = UUID.randomUUID();
		when(certificates.findByIdForUpdate(certificateId)).thenReturn(Optional.empty());

		CertificateService service = new CertificateService(certificates, events, Clock.fixed(NOW, ZoneOffset.UTC));

		assertThatThrownBy(() -> service.revoke(certificateId, new CertificateRevokeRequest("KEY_COMPROMISE", null)))
				.isInstanceOf(ApiException.class)
				.satisfies(ex -> assertThat(((ApiException) ex).getReasonCode()).isEqualTo("CERTIFICATE_NOT_FOUND"));
	}

	@Test
	void get_returnsComputedStatus() {
		CertificateRepository certificates = mock(CertificateRepository.class);
		ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
		Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
		UUID certificateId = UUID.randomUUID();
		when(certificates.findById(certificateId)).thenReturn(Optional.of(newCertificate(certificateId)));

		CertificateService service = new CertificateService(certificates, events, clock);
		CertificateResponse response = service.get(certificateId);

		assertThat(response.status()).isEqualTo(CertificateStatus.VALID);
	}

	@Test
	void downloadPem_returnsRawPem() {
		CertificateRepository certificates = mock(CertificateRepository.class);
		ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
		UUID certificateId = UUID.randomUUID();
		when(certificates.findById(certificateId)).thenReturn(Optional.of(newCertificate(certificateId)));

		CertificateService service = new CertificateService(certificates, events, Clock.fixed(NOW, ZoneOffset.UTC));

		assertThat(service.downloadPem(certificateId)).contains("BEGIN CERTIFICATE");
	}
}
