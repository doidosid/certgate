package tech.certgate.device;

import java.time.Instant;

/**
 * docs/api-spec.md §3: {@code POST /devices/{deviceId}/enrollment-token}. The
 * plaintext Token is returned only here, once, same as at registration
 * (docs/security-design.md Enrollment).
 */
public record EnrollmentTokenResponse(String enrollmentToken, Instant enrollmentExpiresAt) {
}
