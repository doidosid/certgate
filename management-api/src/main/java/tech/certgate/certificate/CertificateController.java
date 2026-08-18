package tech.certgate.certificate;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tech.certgate.common.PageResponse;

/** docs/api-spec.md §5 "Certificate API". */
@RestController
@RequestMapping("/api/v1/certificates")
public class CertificateController {

	private static final int DEFAULT_PAGE_SIZE = 20;
	private static final int MAX_PAGE_SIZE = 100;
	private static final MediaType PEM_MEDIA_TYPE = MediaType.parseMediaType("application/x-pem-file");

	private final CertificateService certificateService;

	public CertificateController(CertificateService certificateService) {
		this.certificateService = certificateService;
	}

	@GetMapping
	public PageResponse<CertificateResponse> list(
			@RequestParam(required = false) String status,
			@RequestParam(required = false) UUID deviceId,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant expiresBefore,
			@RequestParam(defaultValue = "0") int page,
			@RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size) {
		Pageable pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE));
		return certificateService.list(deviceId, status, expiresBefore, pageable);
	}

	@GetMapping("/{certificateId}")
	public CertificateResponse get(@PathVariable UUID certificateId) {
		return certificateService.get(certificateId);
	}

	@GetMapping("/{certificateId}/download")
	public ResponseEntity<String> download(@PathVariable UUID certificateId) {
		String pem = certificateService.downloadPem(certificateId);
		return ResponseEntity.ok().contentType(PEM_MEDIA_TYPE).body(pem);
	}

	@PostMapping("/{certificateId}/revoke")
	public CertificateResponse revoke(@PathVariable UUID certificateId, @RequestBody CertificateRevokeRequest request) {
		return certificateService.revoke(certificateId, request);
	}
}
