package tech.certgate.device;

import java.time.Clock;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.common.ApiException;
import tech.certgate.enrollment.EnrollmentTokenService;
import tech.certgate.policy.RoleRepository;

@Service
public class DeviceService {

	private final DeviceRepository devices;
	private final RoleRepository roles;
	private final EnrollmentTokenService enrollmentTokenService;
	private final Clock clock;

	public DeviceService(DeviceRepository devices, RoleRepository roles,
			EnrollmentTokenService enrollmentTokenService, Clock clock) {
		this.devices = devices;
		this.roles = roles;
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
	public record DeviceIdentity(UUID id, String deviceKey, DeviceStatus status) {
	}

	/** Looks up a Device by id without enforcing ACTIVE status. */
	@Transactional(readOnly = true)
	public DeviceIdentity requireDevice(UUID deviceId) {
		Device device = devices.findById(deviceId)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DEVICE_NOT_REGISTERED", "등록되지 않은 Device입니다."));
		return new DeviceIdentity(device.getId(), device.getDeviceKey(), device.getStatus());
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
}
