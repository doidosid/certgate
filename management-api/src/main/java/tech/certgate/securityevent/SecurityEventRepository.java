package tech.certgate.securityevent;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SecurityEventRepository extends JpaRepository<SecurityEvent, UUID> {

	List<SecurityEvent> findAllByIdIn(List<UUID> ids);
}
