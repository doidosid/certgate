package tech.certgate.device;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeviceRepository extends JpaRepository<Device, UUID> {

	boolean existsByDeviceKey(String deviceKey);

	Optional<Device> findByDeviceKey(String deviceKey);
}
