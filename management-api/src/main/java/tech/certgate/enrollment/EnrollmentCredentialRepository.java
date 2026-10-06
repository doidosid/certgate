package tech.certgate.enrollment;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface EnrollmentCredentialRepository extends JpaRepository<EnrollmentCredential, UUID> {

	/**
	 * Locks the credential for the Transaction that uses the Token, so a
	 * concurrent reissue (which revokes this row) and a CSR submission under
	 * it are serialized: whichever comes second sees the other's commit
	 * (Postgres READ COMMITTED re-reads the locked row). See
	 * EnrollmentTokenService#issueFor.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("SELECT c FROM EnrollmentCredential c WHERE c.tokenHash = :tokenHash")
	Optional<EnrollmentCredential> findByTokenHashForUpdate(@Param("tokenHash") String tokenHash);

	Optional<EnrollmentCredential> findByDeviceIdAndRevokedAtIsNull(UUID deviceId);
}
