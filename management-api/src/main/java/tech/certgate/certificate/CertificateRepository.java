package tech.certgate.certificate;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CertificateRepository extends JpaRepository<Certificate, UUID> {

	Optional<Certificate> findByRequestId(UUID requestId);

	Optional<Certificate> findBySerialNumber(String serialNumber);

	/**
	 * Filters by deviceId/status/expiresBefore when given (docs/api-spec.md §5).
	 * status is computed from revokedAt/notAfter (Certificate#status), not a
	 * stored column, so its bucket is expressed directly in JPQL:
	 * REVOKED = revokedAt set; EXPIRED = past notAfter; EXPIRING_SOON = within
	 * expiringSoonThreshold of notAfter; VALID = everything else.
	 */
	@Query("""
			SELECT c FROM Certificate c
			WHERE (:deviceId IS NULL OR c.deviceId = :deviceId)
			AND (:expiresBefore IS NULL OR c.notAfter < :expiresBefore)
			AND (
				:status IS NULL
				OR (:status = 'REVOKED' AND c.revokedAt IS NOT NULL)
				OR (:status = 'EXPIRED' AND c.revokedAt IS NULL AND c.notAfter < :now)
				OR (:status = 'EXPIRING_SOON' AND c.revokedAt IS NULL AND c.notAfter >= :now AND c.notAfter <= :expiringSoonThreshold)
				OR (:status = 'VALID' AND c.revokedAt IS NULL AND c.notAfter > :expiringSoonThreshold)
			)
			""")
	Page<Certificate> search(
			@Param("deviceId") UUID deviceId,
			@Param("status") String status,
			@Param("expiresBefore") Instant expiresBefore,
			@Param("now") Instant now,
			@Param("expiringSoonThreshold") Instant expiringSoonThreshold,
			Pageable pageable);
}
