package tech.certgate.enrollment;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tech.certgate.certificate.Certificate;
import tech.certgate.certificate.CertificateRepository;
import tech.certgate.common.ApiException;
import tech.certgate.common.PageResponse;
import tech.certgate.device.DeviceService;
import tech.certgate.securityevent.SecurityEventRecorder;

/**
 * CSR submission, admin approval, and Certificate/Chain retrieval
 * (docs/api-spec.md §4). Validation order on submit matches
 * docs/security-design.md §4: Token, CSR signature, public key policy, SAN
 * URI, ACTIVE Device, then PENDING dedup.
 */
@Service
public class EnrollmentService {

	private static final Logger log = LoggerFactory.getLogger(EnrollmentService.class);
	private static final UUID NO_DEVICE_ID = new UUID(0L, 0L);

	private final EnrollmentTokenService tokenService;
	private final CsrValidator csrValidator;
	private final CertificateRequestRepository certificateRequests;
	private final CertificateRepository certificates;
	private final DeviceService deviceService;
	private final IntermediateCertificateAuthority certificateAuthority;
	private final SecurityEventRecorder securityEventRecorder;
	private final TransactionTemplate transactionTemplate;
	private final Clock clock;

	public EnrollmentService(
			EnrollmentTokenService tokenService,
			CsrValidator csrValidator,
			CertificateRequestRepository certificateRequests,
			CertificateRepository certificates,
			DeviceService deviceService,
			IntermediateCertificateAuthority certificateAuthority,
			SecurityEventRecorder securityEventRecorder,
			PlatformTransactionManager transactionManager,
			Clock clock) {
		this.tokenService = tokenService;
		this.csrValidator = csrValidator;
		this.certificateRequests = certificateRequests;
		this.certificates = certificates;
		this.deviceService = deviceService;
		this.certificateAuthority = certificateAuthority;
		this.securityEventRecorder = securityEventRecorder;
		this.transactionTemplate = new TransactionTemplate(transactionManager);
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
		// Defense in depth: a Certificate row should only ever exist for an
		// APPROVED request (approve/reject are mutually exclusive under the
		// PESSIMISTIC_WRITE lock below), but this guards against that
		// invariant ever slipping instead of trusting row presence alone.
		if (request.getStatus() != CertificateRequestStatus.APPROVED) {
			throw new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_NOT_FOUND", "아직 발급되지 않았습니다.");
		}
		Certificate certificate = certificates.findByRequestId(request.getId())
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_NOT_FOUND", "아직 발급되지 않았습니다."));

		return new CertificateDownloadResponse(
				certificate.getCertificatePem(), certificateAuthority.chainPem(),
				certificate.getSerialNumber(), certificate.getNotAfter());
	}

	/**
	 * Deliberately not {@code @Transactional} itself: the CA-failure recovery
	 * below must run only after {@link #approveWithinTransaction}'s own
	 * Transaction has fully committed or rolled back and released its JDBC
	 * Connection and {@code PESSIMISTIC_WRITE} Row Lock. Recording the
	 * CRITICAL Event from inside that still-open Transaction would make
	 * every CA-signing failure briefly hold two Connections at once (the
	 * outer one, suspended, plus {@link SecurityEventRecorder}'s
	 * {@code REQUIRES_NEW} one) — under a real CA outage, many approvals can
	 * fail together and exhaust the Connection Pool (Codex 리뷰 PR #29 Medium).
	 */
	public CertificateRequestResponse approve(UUID requestId, String decisionNote) {
		UUID[] deviceIdHolder = new UUID[1];
		try {
			return transactionTemplate.execute(status -> approveWithinTransaction(requestId, decisionNote, deviceIdHolder));
		} catch (ApiException e) {
			if ("CA_SIGNING_FAILED".equals(e.getReasonCode())) {
				try {
					securityEventRecorder.recordCritical("PKI", "CA_SIGNING_FAILED", deviceIdHolder[0], null);
				} catch (RuntimeException recordingFailure) {
					// The original CA failure is the Reason Code the caller must see —
					// losing it behind a secondary failure to record the audit trail
					// would hide why the approval actually failed (Codex 리뷰 PR #29
					// Medium). Log it and keep it as a suppressed cause instead.
					log.warn("Failed to record CRITICAL Security Event for CA_SIGNING_FAILED", recordingFailure);
					e.addSuppressed(recordingFailure);
				}
			}
			throw e;
		}
	}

	private CertificateRequestResponse approveWithinTransaction(UUID requestId, String decisionNote, UUID[] deviceIdHolder) {
		CertificateRequest request = requireRequestForUpdate(requestId);
		if (request.getStatus() != CertificateRequestStatus.PENDING) {
			throw new ApiException(HttpStatus.CONFLICT, "CERTIFICATE_REQUEST_NOT_PENDING", "PENDING 상태의 요청만 승인할 수 있습니다.");
		}
		deviceIdHolder[0] = request.getDeviceId();

		DeviceService.DeviceIdentity device = deviceService.requireActiveDevice(request.getDeviceId());
		ParsedCsr parsed = csrValidator.validate(request.getCsrPem(), device.deviceKey());
		IssuedCertificate issued = certificateAuthority.sign(parsed);

		Instant now = clock.instant();
		certificates.save(new Certificate(UUID.randomUUID(), request.getDeviceId(), request.getId(), issued, now));
		request.approve(now, decisionNote);

		return CertificateRequestResponse.from(request);
	}

	@Transactional(readOnly = true)
	public PageResponse<CertificateRequestResponse> list(CertificateRequestStatus status, UUID deviceId, Pageable pageable) {
		Page<CertificateRequest> page = certificateRequests.search(
				status != null, status != null ? status : CertificateRequestStatus.PENDING,
				deviceId != null, deviceId != null ? deviceId : NO_DEVICE_ID,
				pageable);
		return PageResponse.of(page.map(CertificateRequestResponse::from));
	}

	@Transactional(readOnly = true)
	public CertificateRequestDetailResponse getDetail(UUID requestId) {
		return CertificateRequestDetailResponse.from(requireRequest(requestId));
	}

	@Transactional
	public CertificateRequestResponse reject(UUID requestId, String decisionNote) {
		CertificateRequest request = requireRequestForUpdate(requestId);
		if (request.getStatus() != CertificateRequestStatus.PENDING) {
			throw new ApiException(HttpStatus.CONFLICT, "CERTIFICATE_REQUEST_NOT_PENDING", "PENDING 상태의 요청만 거절할 수 있습니다.");
		}

		request.reject(clock.instant(), decisionNote);
		return CertificateRequestResponse.from(request);
	}

	/** Dashboard count of CSRs awaiting an administrator decision (docs/api-spec.md §9). */
	@Transactional(readOnly = true)
	public long countPendingRequests() {
		return certificateRequests.countByStatus(CertificateRequestStatus.PENDING);
	}

	private CertificateRequest requireRequest(UUID requestId) {
		return certificateRequests.findById(requestId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_REQUEST_NOT_FOUND", "요청을 찾을 수 없습니다."));
	}

	/** Locked lookup for the approve/reject decision Transactions — see CertificateRequestRepository#findByIdForUpdate. */
	private CertificateRequest requireRequestForUpdate(UUID requestId) {
		return certificateRequests.findByIdForUpdate(requestId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_REQUEST_NOT_FOUND", "요청을 찾을 수 없습니다."));
	}

	private CertificateRequest findOwnedRequest(UUID requestId, UUID deviceId) {
		return certificateRequests.findByIdAndDeviceId(requestId, deviceId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_REQUEST_NOT_FOUND", "요청을 찾을 수 없습니다."));
	}
}
