package tech.certgate.securityevent;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SecurityEventRepository extends JpaRepository<SecurityEvent, UUID> {

	List<SecurityEvent> findAllByIdIn(List<UUID> ids);

	/** Most recent Events for a Device, used by the Device detail view (docs/api-spec.md §3). */
	List<SecurityEvent> findTop10ByDeviceIdOrderByOccurredAtDesc(UUID deviceId);

	/**
	 * docs/api-spec.md §9 Console 검색. has-flag + dummy-value pattern (never a
	 * bare {@code :param IS NULL}) so every bind parameter is typed by a real
	 * comparison — see CertificateRepository#search for why (Postgres
	 * SQLState 42P18).
	 */
	@Query("""
			SELECT e FROM SecurityEvent e
			WHERE (:hasFrom = false OR e.occurredAt >= :from)
			AND (:hasTo = false OR e.occurredAt <= :to)
			AND (:hasDeviceId = false OR e.deviceId = :deviceId)
			AND (:hasDecision = false OR e.decision = :decision)
			AND (:hasReasonCode = false OR e.reasonCode = :reasonCode)
			AND (:hasSeverity = false OR e.severity = :severity)
			""")
	Page<SecurityEvent> search(
			@Param("hasFrom") boolean hasFrom,
			@Param("from") Instant from,
			@Param("hasTo") boolean hasTo,
			@Param("to") Instant to,
			@Param("hasDeviceId") boolean hasDeviceId,
			@Param("deviceId") UUID deviceId,
			@Param("hasDecision") boolean hasDecision,
			@Param("decision") String decision,
			@Param("hasReasonCode") boolean hasReasonCode,
			@Param("reasonCode") String reasonCode,
			@Param("hasSeverity") boolean hasSeverity,
			@Param("severity") String severity,
			Pageable pageable);
}
