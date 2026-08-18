package tech.certgate.securityevent;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SecurityEventRepository extends JpaRepository<SecurityEvent, UUID> {

	List<SecurityEvent> findAllByIdIn(List<UUID> ids);

	/** Most recent Events for a Device, used by the Device detail view (docs/api-spec.md §3). */
	List<SecurityEvent> findTop10ByDeviceIdOrderByOccurredAtDesc(UUID deviceId);
}
