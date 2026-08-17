package tech.certgate.enrollment;

import java.util.UUID;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Administrator CSR decisions. Protected only by deployment restriction in
 * the MVP (docs/api-spec.md §2) - no application-level admin auth yet.
 */
@RestController
@RequestMapping("/api/v1/certificate-requests")
public class CertificateRequestAdminController {

	private final EnrollmentService enrollmentService;

	public CertificateRequestAdminController(EnrollmentService enrollmentService) {
		this.enrollmentService = enrollmentService;
	}

	@PostMapping("/{requestId}/approve")
	public CertificateRequestResponse approve(@PathVariable UUID requestId, @RequestBody(required = false) ApprovalRequest request) {
		String decisionNote = request != null ? request.decisionNote() : null;
		return enrollmentService.approve(requestId, decisionNote);
	}
}
