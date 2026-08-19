package tech.certgate.policy;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * docs/api-spec.md §6 "Policy API". Read-only on purpose: "MVP의 정책 수정 API는
 * 제공하지 않고 Seed Data로 관리한다". The Admin Console uses this to populate the
 * Role filter and the Role-change selector instead of hard-coding role names.
 */
@RestController
@RequestMapping("/api/v1/roles")
public class RoleController {

	private final PolicyService policyService;

	public RoleController(PolicyService policyService) {
		this.policyService = policyService;
	}

	@GetMapping
	public List<RoleResponse> list() {
		return policyService.findAllRoles();
	}

	@GetMapping("/{roleName}")
	public RoleResponse get(@PathVariable String roleName) {
		return policyService.findRole(roleName);
	}
}
