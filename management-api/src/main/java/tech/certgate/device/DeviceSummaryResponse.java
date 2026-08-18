package tech.certgate.device;

import java.time.Instant;
import java.util.UUID;

/** Returned by the status/Role admin updates (docs/api-spec.md §3) — no Enrollment Token fields. */
public record DeviceSummaryResponse(
		UUID id, String deviceKey, String name, DeviceStatus status, String roleName, Instant createdAt, Instant lastSeenAt) {

	public static DeviceSummaryResponse from(Device device) {
		return new DeviceSummaryResponse(
				device.getId(), device.getDeviceKey(), device.getName(), device.getStatus(), device.getRoleName(),
				device.getCreatedAt(), device.getLastSeenAt());
	}
}
