package tech.certgate.device;

/** docs/api-spec.md §3: {@code PUT /devices/{deviceId}/role}. */
public record DeviceRoleUpdateRequest(String roleName) {
}
