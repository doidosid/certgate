package tech.certgate.device;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.certificate.Certificate;
import tech.certgate.certificate.CertificateRepository;
import tech.certgate.common.ApiException;
import tech.certgate.common.PageResponse;
import tech.certgate.enrollment.EnrollmentTokenService;
import tech.certgate.policy.PolicyRuleRepository;
import tech.certgate.policy.RoleRepository;
import tech.certgate.securityevent.SecurityEventRepository;

@Service
public class DeviceService {

	private static final String NO_ROLE_FILTER = "";
	private static final String NO_QUERY_FILTER = "";

	private final DeviceRepository devices;
	private final RoleRepository roles;
	private final CertificateRepository certificates;
	private final PolicyRuleRepository policyRules;
	private final SecurityEventRepository securityEvents;
	private final EnrollmentTokenService enrollmentTokenService;
	private final Clock clock;

	public DeviceService(
			DeviceRepository devices, RoleRepository roles, CertificateRepository certificates,
			PolicyRuleRepository policyRules, SecurityEventRepository securityEvents,
			EnrollmentTokenService enrollmentTokenService, Clock clock) {
		this.devices = devices;
		this.roles = roles;
		this.certificates = certificates;
		this.policyRules = policyRules;
		this.securityEvents = securityEvents;
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
		if (!roles.existsById(request.roleName())) {
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
		Map<UUID, Certificate> latestCertificateByDevice = latestCertificatesFor(deviceIds);
		Instant now = clock.instant();

		return PageResponse.of(page.map(device -> {
			Certificate certificate = latestCertificateByDevice.get(device.getId());
			return new DeviceListItemResponse(
					device.getId(), device.getDeviceKey(), device.getName(), device.getStatus(), device.getRoleName(),
					certificate != null ? certificate.status(now) : null,
					certificate != null ? certificate.getNotAfter() : null,
					device.getLastSeenAt());
		}));
	}

	@Transactional(readOnly = true)
	public DeviceDetailResponse getDetail(UUID deviceId) {
		Device device = requireDeviceEntity(deviceId);
		Instant now = clock.instant();

		DeviceDetailResponse.CertificateSummary certificateSummary = certificates.findFirstByDeviceIdOrderByIssuedAtDesc(deviceId)
				.map(certificate -> new DeviceDetailResponse.CertificateSummary(
						certificate.getId(), certificate.getSerialNumber(), certificate.status(now), certificate.getNotAfter()))
				.orElse(null);

		List<DeviceDetailResponse.PolicyRuleView> rules = policyRules.findByRoleNameOrderByPriorityAsc(device.getRoleName()).stream()
				.map(rule -> new DeviceDetailResponse.PolicyRuleView(
						rule.getHttpMethod(), rule.getPathPattern(), rule.getEffect(), rule.getPriority()))
				.toList();

		List<DeviceDetailResponse.SecurityEventView> recentEvents = securityEvents
				.findTop10ByDeviceIdOrderByOccurredAtDesc(deviceId).stream()
				.map(event -> new DeviceDetailResponse.SecurityEventView(
						event.getId(), event.getOccurredAt(), event.getType(), event.getSeverity(), event.getDecision(),
						event.getReasonCode(), event.getHttpMethod(), event.getRequestPath()))
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
		if (!roles.existsById(roleName)) {
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

	private Device requireDeviceEntity(UUID deviceId) {
		return devices.findById(deviceId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DEVICE_NOT_REGISTERED", "등록되지 않은 Device입니다."));
	}

	/** One Certificate per deviceId (most recently issued), for Devices that have any. */
	private Map<UUID, Certificate> latestCertificatesFor(List<UUID> deviceIds) {
		if (deviceIds.isEmpty()) {
			return Map.of();
		}
		Map<UUID, Certificate> latestByDevice = new LinkedHashMap<>();
		for (Certificate certificate : certificates.findByDeviceIdInOrderByIssuedAtDesc(deviceIds)) {
			latestByDevice.putIfAbsent(certificate.getDeviceId(), certificate);
		}
		return latestByDevice;
	}
}
