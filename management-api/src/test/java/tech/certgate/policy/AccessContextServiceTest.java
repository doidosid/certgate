package tech.certgate.policy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tech.certgate.certificate.Certificate;
import tech.certgate.certificate.CertificateRepository;
import tech.certgate.certificate.CertificateStatus;
import tech.certgate.device.DeviceService;
import tech.certgate.device.DeviceStatus;

/**
 * Access Context must report a DISABLED Device's real status, not throw — the
 * Gateway, not Management API, decides ALLOW/DENY from this data
 * (docs/security-design.md §5). A DISABLED Device can't be produced through
 * the HTTP API yet (no PATCH status endpoint — Issue #3 remainder), so this
 * is a plain unit test with mocked collaborators instead of an integration test.
 */
class AccessContextServiceTest {

	@Test
	void get_reportsDisabledDeviceWithoutThrowing() {
		CertificateRepository certificates = mock(CertificateRepository.class);
		DeviceService deviceService = mock(DeviceService.class);
		PolicyRuleRepository policyRules = mock(PolicyRuleRepository.class);
		Clock clock = Clock.fixed(Instant.parse("2026-08-17T00:00:00Z"), ZoneOffset.UTC);

		UUID certificateId = UUID.randomUUID();
		UUID deviceId = UUID.randomUUID();
		Certificate certificate = mock(Certificate.class);
		when(certificate.getId()).thenReturn(certificateId);
		when(certificate.getSerialNumber()).thenReturn("SERIAL-1");
		when(certificate.getDeviceId()).thenReturn(deviceId);
		when(certificate.status(clock.instant())).thenReturn(CertificateStatus.VALID);

		when(certificates.findBySerialNumber("SERIAL-1")).thenReturn(Optional.of(certificate));
		when(deviceService.requireDevice(deviceId))
				.thenReturn(new DeviceService.DeviceIdentity(deviceId, "sensor-disabled-01", DeviceStatus.DISABLED, "SENSOR"));
		when(policyRules.findByRoleNameOrderByPriorityAsc("SENSOR")).thenReturn(List.of());

		AccessContextService service = new AccessContextService(certificates, deviceService, policyRules, clock);

		AccessContextResponse response = service.get("SERIAL-1");

		assertThat(response.deviceStatus()).isEqualTo(DeviceStatus.DISABLED);
		assertThat(response.deviceKey()).isEqualTo("sensor-disabled-01");
	}
}
