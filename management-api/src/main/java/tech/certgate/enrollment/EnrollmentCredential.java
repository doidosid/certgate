package tech.certgate.enrollment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Only the SHA-256 hash of the Enrollment Token is ever persisted (ADR-005). */
@Entity
@Table(name = "enrollment_credential")
public class EnrollmentCredential {

	@Id
	private UUID id;

	@Column(name = "device_id", nullable = false)
	private UUID deviceId;

	@Column(name = "token_hash", nullable = false, unique = true)
	private String tokenHash;

	@Column(name = "expires_at", nullable = false)
	private Instant expiresAt;

	@Column(name = "revoked_at")
	private Instant revokedAt;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	@Column(name = "last_used_at")
	private Instant lastUsedAt;

	protected EnrollmentCredential() {
	}

	public EnrollmentCredential(UUID id, UUID deviceId, String tokenHash, Instant expiresAt, Instant createdAt) {
		this.id = id;
		this.deviceId = deviceId;
		this.tokenHash = tokenHash;
		this.expiresAt = expiresAt;
		this.createdAt = createdAt;
	}

	public UUID getId() {
		return id;
	}

	public UUID getDeviceId() {
		return deviceId;
	}

	public String getTokenHash() {
		return tokenHash;
	}

	public Instant getExpiresAt() {
		return expiresAt;
	}

	public Instant getRevokedAt() {
		return revokedAt;
	}

	public Instant getLastUsedAt() {
		return lastUsedAt;
	}

	public void revoke(Instant now) {
		this.revokedAt = now;
	}

	public void markUsed(Instant now) {
		this.lastUsedAt = now;
	}

	public boolean isActive(Instant now) {
		return revokedAt == null && now.isBefore(expiresAt);
	}
}
