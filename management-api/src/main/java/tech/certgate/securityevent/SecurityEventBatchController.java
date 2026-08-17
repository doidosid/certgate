package tech.certgate.securityevent;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SecurityEventBatchController {

	private final SecurityEventBatchService batchService;

	public SecurityEventBatchController(SecurityEventBatchService batchService) {
		this.batchService = batchService;
	}

	@PostMapping("/internal/security-events/batch")
	public SecurityEventBatchResponse accept(@RequestBody SecurityEventBatchRequest request) {
		return batchService.accept(request);
	}
}
