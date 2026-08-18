package tech.certgate.enrollment;

import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tech.certgate.common.PageResponse;

/**
 * Administrator CSR decisions and lookups (docs/api-spec.md §4 "관리자 CSR
 * 관리"). Protected only by deployment restriction in the MVP - no
 * application-level admin auth yet.
 */
@RestController
@RequestMapping("/api/v1/certificate-requests")
public class CertificateRequestAdminController {

	private static final int DEFAULT_PAGE_SIZE = 20;
	private static final int MAX_PAGE_SIZE = 100;

	private final EnrollmentService enrollmentService;

	public CertificateRequestAdminController(EnrollmentService enrollmentService) {
		this.enrollmentService = enrollmentService;
	}

	@GetMapping
	public PageResponse<CertificateRequestResponse> list(
			@RequestParam(required = false) CertificateRequestStatus status,
			@RequestParam(required = false) UUID deviceId,
			@RequestParam(defaultValue = "0") int page,
			@RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
		Pageable pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE));
		return enrollmentService.list(status, deviceId, pageable);
	}

	@GetMapping("/{requestId}")
	public CertificateRequestDetailResponse get(@PathVariable UUID requestId) {
		return enrollmentService.getDetail(requestId);
	}

	@PostMapping("/{requestId}/approve")
	public CertificateRequestResponse approve(@PathVariable UUID requestId, @RequestBody(required = false) DecisionRequest request) {
		return enrollmentService.approve(requestId, decisionNote(request));
	}

	@PostMapping("/{requestId}/reject")
	public CertificateRequestResponse reject(@PathVariable UUID requestId, @RequestBody(required = false) DecisionRequest request) {
		return enrollmentService.reject(requestId, decisionNote(request));
	}

	private static String decisionNote(DecisionRequest request) {
		return request != null ? request.decisionNote() : null;
	}
}
