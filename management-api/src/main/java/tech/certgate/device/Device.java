package tech.certgate.device;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * deviceKey is the immutable certificate-identity key (docs/adr/001), distinct
 * from the resource id used elsewhere in the API.
 */
@Entity
@Table(name = "device")
public class Device {

	@Id
	private UUID id;

	@Column(name = "device_key", updatable = false, unique = true, nullable = false)
	private String deviceKey;

	@Column(nullable = false)
	private String name;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private DeviceStatus status;

	@Column(name = "role_name", nullable = false)
	private String roleName;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@Column(name = "last_seen_at")
	private Instant lastSeenAt;

	protected Device() {
	}

	public Device(UUID id, String deviceKey, String name, DeviceStatus status, String roleName, Instant createdAt) {
		this.id = id;
		this.deviceKey = deviceKey;
		this.name = name;
		this.status = status;
		this.roleName = roleName;
		this.createdAt = createdAt;
		this.updatedAt = createdAt;
	}

	public UUID getId() {
		return id;
	}

	public String getDeviceKey() {
		return deviceKey;
	}

	public String getName() {
		return name;
	}

	public DeviceStatus getStatus() {
		return status;
	}

	public String getRoleName() {
		return roleName;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getLastSeenAt() {
		return lastSeenAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}

	public void changeStatus(DeviceStatus status, Instant now) {
		this.status = status;
		this.updatedAt = now;
	}

	public void changeRole(String roleName, Instant now) {
		this.roleName = roleName;
		this.updatedAt = now;
	}

	/** docs/data-model.md "마지막 허용 요청 시각" — never moves backward (out-of-order/duplicate Event resend). */
	public void updateLastSeenIfNewer(Instant occurredAt) {
		if (lastSeenAt == null || occurredAt.isAfter(lastSeenAt)) {
			this.lastSeenAt = occurredAt;
		}
	}
}
