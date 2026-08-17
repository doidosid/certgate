package tech.certgate.enrollment;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.certificate.Certificate;
import tech.certgate.certificate.CertificateRepository;
import tech.certgate.common.ApiException;
import tech.certgate.device.DeviceService;

/**
 * CSR submission, admin approval, and Certificate/Chain retrieval
 * (docs/api-spec.md §4). Validation order on submit matches
 * docs/security-design.md §4: Token, CSR signature, public key policy, SAN
 * URI, ACTIVE Device, then PENDING dedup.
 */
@Service
public class EnrollmentService {

	private final EnrollmentTokenService tokenService;
	private final CsrValidator csrValidator;
	private final CertificateRequestRepository certificateRequests;
	private final CertificateRepository certificates;
	private final DeviceService deviceService;
	private final IntermediateCertificateAuthority certificateAuthority;
	private final Clock clock;

	public EnrollmentService(
			EnrollmentTokenService tokenService,
			CsrValidator csrValidator,
			CertificateRequestRepository certificateRequests,
			CertificateRepository certificates,
			DeviceService deviceService,
			IntermediateCertificateAuthority certificateAuthority,
			Clock clock) {
		this.tokenService = tokenService;
		this.csrValidator = csrValidator;
		this.certificateRequests = certificateRequests;
		this.certificates = certificates;
		this.deviceService = deviceService;
		this.certificateAuthority = certificateAuthority;
		this.clock = clock;
	}

	@Transactional
	public CertificateRequestResponse submit(String bearerToken, String csrPem) {
		EnrollmentCredential credential = tokenService.resolve(bearerToken);
		DeviceService.DeviceIdentity device = deviceService.requireDevice(credential.getDeviceId());

		ParsedCsr parsed = csrValidator.validate(csrPem, device.deviceKey());
		deviceService.assertActive(device);

		if (certificateRequests.existsByDeviceIdAndStatus(device.id(), CertificateRequestStatus.PENDING)) {
			throw new ApiException(HttpStatus.CONFLICT, "CERTIFICATE_REQUEST_DUPLICATE", "이미 대기 중인 CSR 요청이 있습니다.");
		}

		CertificateRequest request = new CertificateRequest(
				UUID.randomUUID(), device.id(), credential.getId(), parsed, csrPem, clock.instant());
		certificateRequests.save(request);

		return CertificateRequestResponse.from(request);
	}

	// Not readOnly: tokenService.resolve() records last_used_at as a side
	// effect, which a readOnly transaction would silently skip flushing.
	@Transactional
	public CertificateRequestResponse status(String bearerToken, UUID requestId) {
		EnrollmentCredential credential = tokenService.resolve(bearerToken);
		CertificateRequest request = findOwnedRequest(requestId, credential.getDeviceId());
		return CertificateRequestResponse.from(request);
	}

	@Transactional
	public CertificateDownloadResponse download(String bearerToken, UUID requestId) {
		EnrollmentCredential credential = tokenService.resolve(bearerToken);
		CertificateRequest request = findOwnedRequest(requestId, credential.getDeviceId());
		Certificate certificate = certificates.findByRequestId(request.getId())
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_NOT_FOUND", "아직 발급되지 않았습니다."));

		return new CertificateDownloadResponse(
				certificate.getCertificatePem(), certificateAuthority.chainPem(),
				certificate.getSerialNumber(), certificate.getNotAfter());
	}

	@Transactional
	public CertificateRequestResponse approve(UUID requestId, String decisionNote) {
		CertificateRequest request = certificateRequests.findById(requestId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_REQUEST_NOT_FOUND", "요청을 찾을 수 없습니다."));
		if (request.getStatus() != CertificateRequestStatus.PENDING) {
			throw new ApiException(HttpStatus.CONFLICT, "CERTIFICATE_REQUEST_NOT_PENDING", "PENDING 상태의 요청만 승인할 수 있습니다.");
		}

		DeviceService.DeviceIdentity device = deviceService.requireActiveDevice(request.getDeviceId());
		ParsedCsr parsed = csrValidator.validate(request.getCsrPem(), device.deviceKey());
		IssuedCertificate issued = certificateAuthority.sign(parsed);

		Instant now = clock.instant();
		certificates.save(new Certificate(UUID.randomUUID(), request.getDeviceId(), request.getId(), issued, now));
		request.approve(now, decisionNote);

		return CertificateRequestResponse.from(request);
	}

	private CertificateRequest findOwnedRequest(UUID requestId, UUID deviceId) {
		return certificateRequests.findByIdAndDeviceId(requestId, deviceId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_REQUEST_NOT_FOUND", "요청을 찾을 수 없습니다."));
	}
}
