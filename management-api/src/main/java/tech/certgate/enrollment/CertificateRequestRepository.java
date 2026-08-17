package tech.certgate.enrollment;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CertificateRequestRepository extends JpaRepository<CertificateRequest, UUID> {

	boolean existsByDeviceIdAndStatus(UUID deviceId, CertificateRequestStatus status);

	Optional<CertificateRequest> findByIdAndDeviceId(UUID id, UUID deviceId);
}
