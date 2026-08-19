package tech.certgate.certificate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
	/** Must match V5__create_certificate.sql's revocation_reason/revocation_note column limits. */
	private static final int MAX_REASON_LENGTH = 64;
	private static final int MAX_NOTE_LENGTH = 500;

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

	/** Dashboard counts (docs/api-spec.md §9), using the same 7-day window as {@link #list}. */
	@Transactional(readOnly = true)
	public ValidCounts countValidAndExpiringSoon() {
		Instant now = clock.instant();
		// An aggregate without GROUP BY always yields exactly one row.
		Object[] row = certificates.countValidAndExpiringSoon(now, now.plus(EXPIRING_SOON_WINDOW)).get(0);
		return new ValidCounts(((Number) row[0]).longValue(), ((Number) row[1]).longValue());
	}

	public record ValidCounts(long valid, long expiringSoon) {
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
		if (request.reason().length() > MAX_REASON_LENGTH) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "REVOCATION_REASON_TOO_LONG", "폐기 사유(reason)는 최대 " + MAX_REASON_LENGTH + "자입니다.");
		}
		if (request.note() != null && request.note().length() > MAX_NOTE_LENGTH) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "REVOCATION_NOTE_TOO_LONG", "폐기 비고(note)는 최대 " + MAX_NOTE_LENGTH + "자입니다.");
		}

		Certificate certificate = certificates.findByIdForUpdate(certificateId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_NOT_FOUND", "등록되지 않은 Certificate입니다."));
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

	/**
	 * Cross-domain read view for other domains (e.g. Device detail) that need
	 * a Device's current Certificate status without depending on
	 * {@link CertificateRepository} or the {@link Certificate} Entity directly
	 * (docs/repository-structure.md: Service 경계, Codex 리뷰 PR #26 Medium).
	 */
	public record DeviceCertificateSummary(UUID id, String serialNumber, CertificateStatus status, Instant expiresAt) {
	}

	@Transactional(readOnly = true)
	public Optional<DeviceCertificateSummary> latestForDevice(UUID deviceId) {
		Instant now = clock.instant();
		return certificates.findFirstByDeviceIdOrderByIssuedAtDesc(deviceId).map(certificate -> toSummary(certificate, now));
	}

	/** Batch form of {@link #latestForDevice} to avoid N+1 lookups when rendering a Device list page. */
	@Transactional(readOnly = true)
	public Map<UUID, DeviceCertificateSummary> latestForDevices(List<UUID> deviceIds) {
		if (deviceIds.isEmpty()) {
			return Map.of();
		}
		Instant now = clock.instant();
		Map<UUID, DeviceCertificateSummary> latestByDevice = new LinkedHashMap<>();
		for (Certificate certificate : certificates.findByDeviceIdInOrderByIssuedAtDesc(deviceIds)) {
			latestByDevice.putIfAbsent(certificate.getDeviceId(), toSummary(certificate, now));
		}
		return latestByDevice;
	}

	private static DeviceCertificateSummary toSummary(Certificate certificate, Instant now) {
		return new DeviceCertificateSummary(certificate.getId(), certificate.getSerialNumber(), certificate.status(now), certificate.getNotAfter());
	}
}
