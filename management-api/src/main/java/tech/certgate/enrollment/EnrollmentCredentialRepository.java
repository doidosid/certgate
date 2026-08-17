package tech.certgate.enrollment;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EnrollmentCredentialRepository extends JpaRepository<EnrollmentCredential, UUID> {

	Optional<EnrollmentCredential> findByTokenHash(String tokenHash);

	Optional<EnrollmentCredential> findByDeviceIdAndRevokedAtIsNull(UUID deviceId);
}
