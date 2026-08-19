package tech.certgate.enrollment;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CertificateRequestRepository extends JpaRepository<CertificateRequest, UUID> {

	boolean existsByDeviceIdAndStatus(UUID deviceId, CertificateRequestStatus status);

	long countByStatus(CertificateRequestStatus status);

	Optional<CertificateRequest> findByIdAndDeviceId(UUID id, UUID deviceId);

	/**
	 * Locks the row for the duration of the approve/reject Transaction so a
	 * concurrent approve and reject on the same PENDING request cannot both
	 * observe PENDING and both succeed — one would otherwise be able to
	 * commit REJECTED after the other already signed and stored a Certificate
	 * (Codex 리뷰 PR #26 Critical). Same pattern as
	 * CertificateRepository#findByIdForUpdate.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("SELECT r FROM CertificateRequest r WHERE r.id = :id")
	Optional<CertificateRequest> findByIdForUpdate(@Param("id") UUID id);

	/**
	 * has-flag + dummy-value pattern (never a bare {@code :param IS NULL}) so
	 * every bind parameter is typed by a real comparison — see
	 * CertificateRepository#search for why (Postgres SQLState 42P18).
	 */
	@Query("""
			SELECT r FROM CertificateRequest r
			WHERE (:hasStatus = false OR r.status = :status)
			AND (:hasDeviceId = false OR r.deviceId = :deviceId)
			""")
	Page<CertificateRequest> search(
			@Param("hasStatus") boolean hasStatus,
			@Param("status") CertificateRequestStatus status,
			@Param("hasDeviceId") boolean hasDeviceId,
			@Param("deviceId") UUID deviceId,
			Pageable pageable);
}
