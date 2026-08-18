package tech.certgate.certificate;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Invalidates the Gateway's Access Context Cache only after the revocation
 * Transaction that published the event has committed
 * (docs/security-design.md §6: "Commit 후 Gateway Cache 무효화 API를 호출한다").
 */
@Component
public class GatewayCacheInvalidationListener {

	private final GatewayCacheClient gatewayCacheClient;

	public GatewayCacheInvalidationListener(GatewayCacheClient gatewayCacheClient) {
		this.gatewayCacheClient = gatewayCacheClient;
	}

	@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
	public void onCertificateRevoked(CertificateRevokedEvent event) {
		gatewayCacheClient.invalidateCertificate(event.serialNumber());
	}
}
