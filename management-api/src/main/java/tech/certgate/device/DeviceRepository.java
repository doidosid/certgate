package tech.certgate.device;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DeviceRepository extends JpaRepository<Device, UUID> {

	boolean existsByDeviceKey(String deviceKey);

	long countByStatus(DeviceStatus status);

	Optional<Device> findByDeviceKey(String deviceKey);

	/**
	 * Atomic conditional UPDATE — a read-then-compare-then-write via
	 * {@code Device#updateLastSeenIfNewer} only compares against each
	 * Transaction's own snapshot, so two overlapping Security Event Batches
	 * for the same Device can lost-update the older timestamp back over the
	 * newer one. The WHERE clause re-checks the condition in the DB at UPDATE
	 * time, so under READ COMMITTED the later-committing Transaction always
	 * evaluates against the just-committed value (Codex 리뷰 PR #26 round 2
	 * Medium).
	 */
	@Modifying
	@Query("""
			UPDATE Device d
			SET d.lastSeenAt = :occurredAt
			WHERE d.id = :deviceId
			AND (d.lastSeenAt IS NULL OR d.lastSeenAt < :occurredAt)
			""")
	int updateLastSeenIfNewer(@Param("deviceId") UUID deviceId, @Param("occurredAt") Instant occurredAt);

	/**
	 * has-flag + dummy-value pattern (never a bare {@code :param IS NULL}) so
	 * every bind parameter is typed by a real comparison — see
	 * CertificateRepository#search for why (Postgres SQLState 42P18).
	 * {@code query} matches deviceKey or name, case-insensitive, substring.
	 */
	@Query("""
			SELECT d FROM Device d
			WHERE (:hasQuery = false OR lower(d.deviceKey) LIKE :query OR lower(d.name) LIKE :query)
			AND (:hasStatus = false OR d.status = :status)
			AND (:hasRoleName = false OR d.roleName = :roleName)
			""")
	Page<Device> search(
			@Param("hasQuery") boolean hasQuery,
			@Param("query") String query,
			@Param("hasStatus") boolean hasStatus,
			@Param("status") DeviceStatus status,
			@Param("hasRoleName") boolean hasRoleName,
			@Param("roleName") String roleName,
			Pageable pageable);
}
