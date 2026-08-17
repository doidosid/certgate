package tech.certgate.enrollment;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.common.ApiException;

/**
 * Issues and validates short-lived Enrollment Tokens (ADR-005). The plaintext
 * token exists only for the duration of issuance and validation; only its
 * SHA-256 hash is ever persisted.
 */
@Service
public class EnrollmentTokenService {

	private static final String TOKEN_PREFIX = "cg_enroll_";

	private final EnrollmentCredentialRepository credentials;
	private final Clock clock;
	private final SecureRandom random = new SecureRandom();
	private final long tokenTtlHours;

	public EnrollmentTokenService(
			EnrollmentCredentialRepository credentials,
			Clock clock,
			@org.springframework.beans.factory.annotation.Value("${certgate.enrollment.token-ttl-hours:24}") long tokenTtlHours) {
		this.credentials = credentials;
		this.clock = clock;
		this.tokenTtlHours = tokenTtlHours;
	}

	public record IssuedToken(String rawToken, Instant expiresAt) {
	}

	/** Revokes any existing active credential for deviceId, then issues a new token. */
	@Transactional
	public IssuedToken issueFor(UUID deviceId) {
		Instant now = clock.instant();
		credentials.findByDeviceIdAndRevokedAtIsNull(deviceId).ifPresent(existing -> existing.revoke(now));

		byte[] tokenBytes = new byte[24];
		random.nextBytes(tokenBytes);
		String rawToken = TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);

		Instant expiresAt = now.plus(Duration.ofHours(tokenTtlHours));
		EnrollmentCredential credential = new EnrollmentCredential(
				UUID.randomUUID(), deviceId, hash(rawToken), expiresAt, now);
		credentials.save(credential);

		return new IssuedToken(rawToken, expiresAt);
	}

	/**
	 * Validates a raw Bearer token and returns the owning, still-active
	 * credential. Rejects unknown, expired, or revoked tokens.
	 */
	@Transactional
	public EnrollmentCredential resolve(String rawToken) {
		if (rawToken == null || rawToken.isBlank()) {
			throw invalidToken();
		}
		EnrollmentCredential credential = credentials.findByTokenHash(hash(rawToken)).orElseThrow(this::invalidToken);
		Instant now = clock.instant();
		if (!credential.isActive(now)) {
			throw invalidToken();
		}
		credential.markUsed(now);
		return credential;
	}

	private ApiException invalidToken() {
		return new ApiException(HttpStatus.UNAUTHORIZED, "ENROLLMENT_TOKEN_INVALID", "Enrollment Token이 유효하지 않습니다.");
	}

	private static String hash(String value) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			byte[] hashed = digest.digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
			StringBuilder hex = new StringBuilder(hashed.length * 2);
			for (byte b : hashed) {
				hex.append(String.format("%02x", b));
			}
			return hex.toString();
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException("SHA-256 unavailable", e);
		}
	}
}
