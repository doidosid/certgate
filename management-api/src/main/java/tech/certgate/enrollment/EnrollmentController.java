package tech.certgate.enrollment;

import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tech.certgate.common.ApiException;

/** Device-facing Enrollment endpoints, authenticated by short-lived Bearer Token (ADR-005). */
@RestController
@RequestMapping("/api/v1/enrollments/certificate-requests")
public class EnrollmentController {

	private final EnrollmentService enrollmentService;

	public EnrollmentController(EnrollmentService enrollmentService) {
		this.enrollmentService = enrollmentService;
	}

	@PostMapping
	public ResponseEntity<CertificateRequestResponse> submit(
			@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
			@RequestBody CsrSubmissionRequest request) {
		CertificateRequestResponse response = enrollmentService.submit(bearerToken(authorization), request.csrPem());
		return ResponseEntity.status(HttpStatus.ACCEPTED).body(response);
	}

	@GetMapping("/{requestId}")
	public CertificateRequestResponse status(
			@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
			@PathVariable UUID requestId) {
		return enrollmentService.status(bearerToken(authorization), requestId);
	}

	@GetMapping("/{requestId}/certificate")
	public CertificateDownloadResponse certificate(
			@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
			@PathVariable UUID requestId) {
		return enrollmentService.download(bearerToken(authorization), requestId);
	}

	private static String bearerToken(String authorizationHeader) {
		if (authorizationHeader == null || !authorizationHeader.startsWith("Bearer ")) {
			throw new ApiException(HttpStatus.UNAUTHORIZED, "ENROLLMENT_TOKEN_INVALID", "Enrollment Token이 필요합니다.");
		}
		return authorizationHeader.substring("Bearer ".length());
	}
}
