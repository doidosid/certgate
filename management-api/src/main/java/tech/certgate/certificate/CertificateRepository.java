package tech.certgate.certificate;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CertificateRepository extends JpaRepository<Certificate, UUID> {

	Optional<Certificate> findByRequestId(UUID requestId);

	Optional<Certificate> findBySerialNumber(String serialNumber);

	/** Most recently issued Certificate for a Device, used by the Device detail view. */
	Optional<Certificate> findFirstByDeviceIdOrderByIssuedAtDesc(UUID deviceId);

	/**
	 * Batch lookup for the Device list view; a Device can have more than one
	 * Certificate row over its lifetime (reissued after revoke), so callers
	 * must reduce this to one-per-deviceId (most recent first) themselves.
	 */
	List<Certificate> findByDeviceIdInOrderByIssuedAtDesc(List<UUID> deviceIds);

	/**
	 * Locks the row for the duration of the revoking Transaction so two
	 * concurrent revoke requests cannot both observe {@code revokedAt == null}
	 * and both succeed (Codex 리뷰 PR #24: 동시 폐기 요청에서 감사 사유가
	 * 덮어써질 수 있는 문제).
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("SELECT c FROM Certificate c WHERE c.id = :id")
	Optional<Certificate> findByIdForUpdate(@Param("id") UUID id);

	/**
	 * Filters by deviceId/status/expiresBefore when given (docs/api-spec.md §5).
	 * Absent filters are passed as {@code has*=false} with an unused dummy value
	 * rather than a bare {@code null} bind — Postgres cannot infer a parameter's
	 * type from a lone {@code :param IS NULL} comparison (SQLState 42P18), so
	 * every parameter here is always non-null and typed by a real comparison.
	 * status is computed from revokedAt/notAfter (Certificate#status), not a
	 * stored column, so its bucket is expressed directly in JPQL:
	 * REVOKED = revokedAt set; EXPIRED = past notAfter; EXPIRING_SOON = within
	 * expiringSoonThreshold of notAfter; VALID = everything else.
	 */
	@Query("""
			SELECT c FROM Certificate c
			WHERE (:hasDeviceId = false OR c.deviceId = :deviceId)
			AND (:hasExpiresBefore = false OR c.notAfter < :expiresBefore)
			AND (
				:hasStatus = false
				OR (:status = 'REVOKED' AND c.revokedAt IS NOT NULL)
				OR (:status = 'EXPIRED' AND c.revokedAt IS NULL AND c.notAfter < :now)
				OR (:status = 'EXPIRING_SOON' AND c.revokedAt IS NULL AND c.notAfter >= :now AND c.notAfter <= :expiringSoonThreshold)
				OR (:status = 'VALID' AND c.revokedAt IS NULL AND c.notAfter > :expiringSoonThreshold)
			)
			""")
	Page<Certificate> search(
			@Param("hasDeviceId") boolean hasDeviceId,
			@Param("deviceId") UUID deviceId,
			@Param("hasStatus") boolean hasStatus,
			@Param("status") String status,
			@Param("hasExpiresBefore") boolean hasExpiresBefore,
			@Param("expiresBefore") Instant expiresBefore,
			@Param("now") Instant now,
			@Param("expiringSoonThreshold") Instant expiringSoonThreshold,
			Pageable pageable);
}
