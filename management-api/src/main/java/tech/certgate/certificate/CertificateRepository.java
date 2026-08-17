package tech.certgate.certificate;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CertificateRepository extends JpaRepository<Certificate, UUID> {

	Optional<Certificate> findByRequestId(UUID requestId);
}
