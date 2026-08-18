package tech.certgate.device;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DeviceRepository extends JpaRepository<Device, UUID> {

	boolean existsByDeviceKey(String deviceKey);

	Optional<Device> findByDeviceKey(String deviceKey);

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
