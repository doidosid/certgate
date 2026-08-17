package tech.certgate.policy;

import java.time.Clock;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tech.certgate.certificate.Certificate;
import tech.certgate.certificate.CertificateRepository;
import tech.certgate.common.ApiException;
import tech.certgate.device.DeviceService;

/**
 * Serves the Gateway's per-request Access Context (docs/api-spec.md §7):
 * Certificate status, Device status, and the Device's Role rules. Reports
 * status as-is rather than enforcing it — the Gateway decides ALLOW/DENY
 * from this data (docs/security-design.md §5).
 */
@Service
public class AccessContextService {

	private final CertificateRepository certificates;
	private final DeviceService deviceService;
	private final PolicyRuleRepository policyRules;
	private final Clock clock;

	public AccessContextService(
			CertificateRepository certificates, DeviceService deviceService, PolicyRuleRepository policyRules, Clock clock) {
		this.certificates = certificates;
		this.deviceService = deviceService;
		this.policyRules = policyRules;
		this.clock = clock;
	}

	@Transactional(readOnly = true)
	public AccessContextResponse get(String serialNumber) {
		Certificate certificate = certificates.findBySerialNumber(serialNumber)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CERTIFICATE_NOT_FOUND", "등록되지 않은 Certificate Serial입니다."));

		DeviceService.DeviceIdentity device = deviceService.requireDevice(certificate.getDeviceId());

		List<AccessContextResponse.RuleView> rules = policyRules.findByRoleNameOrderByPriorityAsc(device.roleName()).stream()
				.map(rule -> new AccessContextResponse.RuleView(rule.getHttpMethod(), rule.getPathPattern(), rule.getEffect(), rule.getPriority()))
				.toList();

		return new AccessContextResponse(
				certificate.getId(), certificate.getSerialNumber(), certificate.status(clock.instant()),
				device.id(), device.deviceKey(), device.status(), device.roleName(), rules);
	}
}
