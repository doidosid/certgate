package tech.certgate.certificate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.common.ApiException;
import tech.certgate.common.PageResponse;

/** docs/api-spec.md §5 "Certificate API". */
@Service
public class CertificateService {

	private static final Duration EXPIRING_SOON_WINDOW = Duration.ofDays(7);
	private static final UUID NO_DEVICE_ID = new UUID(0L, 0L);

	private final CertificateRepository certificates;
	private final ApplicationEventPublisher events;
	private final Clock clock;

	public CertificateService(CertificateRepository certificates, ApplicationEventPublisher events, Clock clock) {
		this.certificates = certificates;
		this.events = events;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public PageResponse<CertificateResponse> list(UUID deviceId, String status, Instant expiresBefore, Pageable pageable) {
		Instant now = clock.instant();
		Page<Certificate> page = certificates.search(
				deviceId != null, deviceId != null ? deviceId : NO_DEVICE_ID,
				status != null, status != null ? status : "",
				expiresBefore != null, expiresBefore != null ? expiresBefore : Instant.EPOCH,
				now, now.plus(EXPIRING_SOON_WINDOW), pageable);
		return PageResponse.of(page.map(certificate -> CertificateResponse.from(certificate, now)));
	}

	@Transactional(readOnly = true)
	public CertificateResponse get(UUID certificateId) {
		return CertificateResponse.from(require(certificateId), clock.instant());
	}

	@Transactional(readOnly = true)
	public String downloadPem(UUID certificateId) {
		return require(certificateId).getCertificatePem();
	}

	@Transactional
	public CertificateResponse revoke(UUID certificateId, CertificateRevokeRequest request) {
		if (request == null || request.reason() == null || request.reason().isBlank()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "REVOCATION_REASON_REQUIRED", "폐기 사유(reason)는 필수입니다.");
		}

		Certificate certificate = require(certificateId);
		if (certificate.getRevokedAt() != null) {
			throw new ApiException(HttpStatus.CONFLICT, "CONFLICT", "이미 폐기된 인증서입니다.");
		}

		certificate.revoke(request.reason(), request.note(), clock.instant());
		certificates.save(certificate);
		events.publishEvent(new CertificateRevokedEvent(certificate.getSerialNumber()));

		return CertificateResponse.from(certificate, clock.instant());
	}

	private Certificate require(UUID certificateId) {
		return certificates.findById(certificateId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_NOT_FOUND", "등록되지 않은 Certificate입니다."));
	}
}
