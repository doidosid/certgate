package tech.certgate.device;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.certificate.CertificateService;
import tech.certgate.certificate.CertificateService.DeviceCertificateSummary;
import tech.certgate.common.ApiException;
import tech.certgate.common.PageResponse;
import tech.certgate.enrollment.EnrollmentTokenService;
import tech.certgate.policy.PolicyService;
import tech.certgate.securityevent.SecurityEventService;

@Service
public class DeviceService {

	private static final String NO_ROLE_FILTER = "";
	private static final String NO_QUERY_FILTER = "";

	private final DeviceRepository devices;
	private final CertificateService certificateService;
	private final PolicyService policyService;
	private final SecurityEventService securityEventService;
	private final EnrollmentTokenService enrollmentTokenService;
	private final Clock clock;

	public DeviceService(
			DeviceRepository devices, CertificateService certificateService,
			PolicyService policyService, SecurityEventService securityEventService,
			EnrollmentTokenService enrollmentTokenService, Clock clock) {
		this.devices = devices;
		this.certificateService = certificateService;
		this.policyService = policyService;
		this.securityEventService = securityEventService;
		this.enrollmentTokenService = enrollmentTokenService;
		this.clock = clock;
	}

	@Transactional
	public DeviceResponse register(DeviceRegistrationRequest request) {
		if (request.deviceKey() == null || request.deviceKey().isBlank()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "DEVICE_KEY_REQUIRED", "deviceKey는 필수입니다.");
		}
		if (request.name() == null || request.name().isBlank()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "DEVICE_NAME_REQUIRED", "name은 필수입니다.");
		}
		if (request.roleName() == null || request.roleName().isBlank()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "ROLE_NAME_REQUIRED", "roleName은 필수입니다.");
		}
		if (devices.existsByDeviceKey(request.deviceKey())) {
			throw new ApiException(HttpStatus.CONFLICT, "DEVICE_KEY_DUPLICATE", "이미 등록된 Device Key입니다.");
		}
		if (!policyService.roleExists(request.roleName())) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "ROLE_NOT_FOUND", "존재하지 않는 Role입니다.");
		}

		Device device = new Device(
				UUID.randomUUID(), request.deviceKey(), request.name(), DeviceStatus.ACTIVE,
				request.roleName(), clock.instant());
		devices.save(device);

		EnrollmentTokenService.IssuedToken token = enrollmentTokenService.issueFor(device.getId());

		return new DeviceResponse(
				device.getId(), device.getDeviceKey(), device.getName(), device.getStatus(),
				device.getRoleName(), token.rawToken(), token.expiresAt(), device.getCreatedAt());
	}

	/** Minimal cross-domain lookup so other domains don't reach into DeviceRepository directly. */
	public record DeviceIdentity(UUID id, String deviceKey, DeviceStatus status, String roleName) {
	}

	/** Looks up a Device by id without enforcing ACTIVE status. */
	@Transactional(readOnly = true)
	public DeviceIdentity requireDevice(UUID deviceId) {
		Device device = devices.findById(deviceId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DEVICE_NOT_REGISTERED", "등록되지 않은 Device입니다."));
		return new DeviceIdentity(device.getId(), device.getDeviceKey(), device.getStatus(), device.getRoleName());
	}

	/** Non-throwing variant for best-effort lookups (e.g. CRITICAL Event broadcast) that must not fail their caller. */
	@Transactional(readOnly = true)
	public Optional<DeviceIdentity> findDevice(UUID deviceId) {
		return devices.findById(deviceId)
				.map(device -> new DeviceIdentity(device.getId(), device.getDeviceKey(), device.getStatus(), device.getRoleName()));
	}

	@Transactional(readOnly = true)
	public DeviceIdentity requireActiveDevice(UUID deviceId) {
		DeviceIdentity device = requireDevice(deviceId);
		assertActive(device);
		return device;
	}

	/** Throws DEVICE_DISABLED if device is not ACTIVE; a no-op otherwise. */
	public void assertActive(DeviceIdentity device) {
		if (device.status() != DeviceStatus.ACTIVE) {
			throw new ApiException(HttpStatus.FORBIDDEN, "DEVICE_DISABLED", "비활성화된 Device입니다.");
		}
	}

	@Transactional(readOnly = true)
	public PageResponse<DeviceListItemResponse> list(String query, DeviceStatus status, String roleName, Pageable pageable) {
		String normalizedQuery = query != null && !query.isBlank() ? "%" + query.toLowerCase() + "%" : NO_QUERY_FILTER;
		Page<Device> page = devices.search(
				query != null && !query.isBlank(), normalizedQuery,
				status != null, status != null ? status : DeviceStatus.ACTIVE,
				roleName != null && !roleName.isBlank(), roleName != null ? roleName : NO_ROLE_FILTER,
				pageable);

		List<UUID> deviceIds = page.getContent().stream().map(Device::getId).toList();
		Map<UUID, DeviceCertificateSummary> latestCertificateByDevice = certificateService.latestForDevices(deviceIds);

		return PageResponse.of(page.map(device -> {
			DeviceCertificateSummary certificate = latestCertificateByDevice.get(device.getId());
			return new DeviceListItemResponse(
					device.getId(), device.getDeviceKey(), device.getName(), device.getStatus(), device.getRoleName(),
					certificate != null ? certificate.status() : null,
					certificate != null ? certificate.expiresAt() : null,
					device.getLastSeenAt());
		}));
	}

	@Transactional(readOnly = true)
	public DeviceDetailResponse getDetail(UUID deviceId) {
		Device device = requireDeviceEntity(deviceId);

		DeviceDetailResponse.CertificateSummary certificateSummary = certificateService.latestForDevice(deviceId)
				.map(certificate -> new DeviceDetailResponse.CertificateSummary(
						certificate.id(), certificate.serialNumber(), certificate.status(), certificate.expiresAt()))
				.orElse(null);

		List<DeviceDetailResponse.PolicyRuleView> rules = policyService.rulesForRole(device.getRoleName()).stream()
				.map(rule -> new DeviceDetailResponse.PolicyRuleView(rule.httpMethod(), rule.pathPattern(), rule.effect(), rule.priority()))
				.toList();

		List<DeviceDetailResponse.SecurityEventView> recentEvents = securityEventService.recentForDevice(deviceId).stream()
				.map(event -> new DeviceDetailResponse.SecurityEventView(
						event.id(), event.occurredAt(), event.type(), event.severity(), event.decision(),
						event.reasonCode(), event.httpMethod(), event.requestPath()))
				.toList();

		return new DeviceDetailResponse(
				device.getId(), device.getDeviceKey(), device.getName(), device.getStatus(), device.getRoleName(),
				device.getCreatedAt(), device.getLastSeenAt(), certificateSummary, rules, recentEvents);
	}

	@Transactional
	public DeviceSummaryResponse updateStatus(UUID deviceId, DeviceStatus status) {
		if (status == null) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "DEVICE_STATUS_REQUIRED", "status는 필수입니다.");
		}
		Device device = requireDeviceEntity(deviceId);
		device.changeStatus(status, clock.instant());
		return DeviceSummaryResponse.from(device);
	}

	@Transactional
	public DeviceSummaryResponse updateRole(UUID deviceId, String roleName) {
		if (roleName == null || roleName.isBlank()) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "ROLE_NAME_REQUIRED", "roleName은 필수입니다.");
		}
		if (!policyService.roleExists(roleName)) {
			throw new ApiException(HttpStatus.BAD_REQUEST, "ROLE_NOT_FOUND", "존재하지 않는 Role입니다.");
		}
		Device device = requireDeviceEntity(deviceId);
		device.changeRole(roleName, clock.instant());
		return DeviceSummaryResponse.from(device);
	}

	@Transactional
	public EnrollmentTokenResponse reissueToken(UUID deviceId) {
		requireDeviceEntity(deviceId);
		EnrollmentTokenService.IssuedToken token = enrollmentTokenService.issueFor(deviceId);
		return new EnrollmentTokenResponse(token.rawToken(), token.expiresAt());
	}

	/** Dashboard counts (docs/api-spec.md §9). */
	@Transactional(readOnly = true)
	public DeviceCounts countByStatus() {
		return new DeviceCounts(devices.countByStatus(DeviceStatus.ACTIVE), devices.count());
	}

	public record DeviceCounts(long active, long total) {
	}

	/**
	 * Best-effort bookkeeping, not a security control (docs/data-model.md
	 * "마지막 허용 요청 시각") — a missing Device or a stale/out-of-order
	 * timestamp is silently ignored rather than failing the Security Event
	 * Batch that triggered it.
	 */
	@Transactional
	public void updateLastSeenIfNewer(UUID deviceId, Instant occurredAt) {
		devices.updateLastSeenIfNewer(deviceId, occurredAt);
	}

	private Device requireDeviceEntity(UUID deviceId) {
		return devices.findById(deviceId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DEVICE_NOT_REGISTERED", "등록되지 않은 Device입니다."));
	}
}
