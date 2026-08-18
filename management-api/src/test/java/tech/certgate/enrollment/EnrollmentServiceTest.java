package tech.certgate.enrollment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.bouncycastle.asn1.x500.X500Name;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import tech.certgate.certificate.CertificateRepository;
import tech.certgate.common.ApiException;
import tech.certgate.device.DeviceService;
import tech.certgate.device.DeviceStatus;
import tech.certgate.securityevent.SecurityEventRecorder;

/** docs/architecture.md "CA 서명 실패는 CertificateRequest를 APPROVED로 바꾸지 않고 CRITICAL Event 기록". */
class EnrollmentServiceTest {

	private static final Instant NOW = Instant.parse("2026-08-18T00:00:00Z");

	private ParsedCsr newParsedCsr() {
		return new ParsedCsr(null, null, new X500Name("CN=sensor-01"), "urn:certgate:device:sensor-01", "EC", "fp-1");
	}

	@Test
	void approve_caSigningFailure_recordsCriticalEventAndDoesNotApprove() {
		CertificateRequestRepository certificateRequests = mock(CertificateRequestRepository.class);
		CertificateRepository certificates = mock(CertificateRepository.class);
		DeviceService deviceService = mock(DeviceService.class);
		CsrValidator csrValidator = mock(CsrValidator.class);
		IntermediateCertificateAuthority certificateAuthority = mock(IntermediateCertificateAuthority.class);
		SecurityEventRecorder securityEventRecorder = mock(SecurityEventRecorder.class);
		EnrollmentTokenService tokenService = mock(EnrollmentTokenService.class);

		UUID requestId = UUID.randomUUID();
		UUID deviceId = UUID.randomUUID();
		CertificateRequest request = new CertificateRequest(requestId, deviceId, UUID.randomUUID(), newParsedCsr(), "csr-pem", NOW);
		when(certificateRequests.findByIdForUpdate(requestId)).thenReturn(Optional.of(request));

		DeviceService.DeviceIdentity device = new DeviceService.DeviceIdentity(deviceId, "sensor-01", DeviceStatus.ACTIVE, "SENSOR");
		when(deviceService.requireActiveDevice(deviceId)).thenReturn(device);
		when(csrValidator.validate(any(), any())).thenReturn(newParsedCsr());

		ApiException signingFailure = new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "CA_SIGNING_FAILED", "인증서 서명에 실패했습니다.");
		when(certificateAuthority.sign(any())).thenThrow(signingFailure);

		// approve() no longer carries @Transactional itself — it drives a
		// TransactionTemplate directly (Codex 리뷰 PR #29 Medium: the
		// CA-failure recovery below must run only after this Transaction has
		// fully released its Connection). A bare no-op transaction manager is
		// enough here since this test only exercises EnrollmentService's
		// control flow, not real transactional semantics.
		PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
		when(transactionManager.getTransaction(any())).thenReturn(mock(TransactionStatus.class));

		EnrollmentService service = new EnrollmentService(
				tokenService, csrValidator, certificateRequests, certificates, deviceService,
				certificateAuthority, securityEventRecorder, transactionManager, Clock.fixed(NOW, ZoneOffset.UTC));

		assertThatThrownBy(() -> service.approve(requestId, null))
				.isInstanceOf(ApiException.class)
				.satisfies(ex -> assertThat(((ApiException) ex).getReasonCode()).isEqualTo("CA_SIGNING_FAILED"));

		verify(securityEventRecorder).recordCritical("PKI", "CA_SIGNING_FAILED", deviceId, null);
		verify(certificates, never()).save(any());
		assertThat(request.getStatus()).isEqualTo(CertificateRequestStatus.PENDING);
	}

	/** Codex 리뷰 PR #29 Medium: recording the audit Event must not hide the original CA_SIGNING_FAILED. */
	@Test
	void approve_caSigningFailureAndRecordingFailure_stillThrowsOriginalReasonCode() {
		CertificateRequestRepository certificateRequests = mock(CertificateRequestRepository.class);
		CertificateRepository certificates = mock(CertificateRepository.class);
		DeviceService deviceService = mock(DeviceService.class);
		CsrValidator csrValidator = mock(CsrValidator.class);
		IntermediateCertificateAuthority certificateAuthority = mock(IntermediateCertificateAuthority.class);
		SecurityEventRecorder securityEventRecorder = mock(SecurityEventRecorder.class);
		EnrollmentTokenService tokenService = mock(EnrollmentTokenService.class);

		UUID requestId = UUID.randomUUID();
		UUID deviceId = UUID.randomUUID();
		CertificateRequest request = new CertificateRequest(requestId, deviceId, UUID.randomUUID(), newParsedCsr(), "csr-pem", NOW);
		when(certificateRequests.findByIdForUpdate(requestId)).thenReturn(Optional.of(request));

		DeviceService.DeviceIdentity device = new DeviceService.DeviceIdentity(deviceId, "sensor-01", DeviceStatus.ACTIVE, "SENSOR");
		when(deviceService.requireActiveDevice(deviceId)).thenReturn(device);
		when(csrValidator.validate(any(), any())).thenReturn(newParsedCsr());

		when(certificateAuthority.sign(any()))
				.thenThrow(new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "CA_SIGNING_FAILED", "인증서 서명에 실패했습니다."));
		doThrow(new RuntimeException("DB unavailable"))
				.when(securityEventRecorder).recordCritical("PKI", "CA_SIGNING_FAILED", deviceId, null);

		PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
		when(transactionManager.getTransaction(any())).thenReturn(mock(TransactionStatus.class));

		EnrollmentService service = new EnrollmentService(
				tokenService, csrValidator, certificateRequests, certificates, deviceService,
				certificateAuthority, securityEventRecorder, transactionManager, Clock.fixed(NOW, ZoneOffset.UTC));

		assertThatThrownBy(() -> service.approve(requestId, null))
				.isInstanceOf(ApiException.class)
				.satisfies(ex -> assertThat(((ApiException) ex).getReasonCode()).isEqualTo("CA_SIGNING_FAILED"));
	}
}
