package tech.certgate.policy;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AccessContextController {

	private final AccessContextService accessContextService;

	public AccessContextController(AccessContextService accessContextService) {
		this.accessContextService = accessContextService;
	}

	@GetMapping("/internal/access-context")
	public AccessContextResponse get(@RequestParam String serialNumber) {
		return accessContextService.get(serialNumber);
	}
}
