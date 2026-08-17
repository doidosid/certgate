package tech.certgate.policy;

import java.util.List;
import java.util.UUID;
import tech.certgate.certificate.CertificateStatus;
import tech.certgate.device.DeviceStatus;

/** docs/api-spec.md §7 "Access Context". */
public record AccessContextResponse(
		UUID certificateId,
		String serialNumber,
		CertificateStatus certificateStatus,
		UUID deviceId,
		String deviceKey,
		DeviceStatus deviceStatus,
		String roleName,
		List<RuleView> rules) {

	public record RuleView(String httpMethod, String pathPattern, String effect, int priority) {
	}
}
