package tech.certgate.device;

/** docs/api-spec.md §3: {@code PATCH /devices/{deviceId}/status}. */
public record DeviceStatusUpdateRequest(DeviceStatus status) {
}
