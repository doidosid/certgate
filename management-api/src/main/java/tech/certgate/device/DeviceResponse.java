package tech.certgate.device;

import java.time.Instant;
import java.util.UUID;

public record DeviceResponse(
		UUID id,
		String deviceKey,
		String name,
		DeviceStatus status,
		String roleName,
		String enrollmentToken,
		Instant enrollmentExpiresAt,
		Instant createdAt) {
}
