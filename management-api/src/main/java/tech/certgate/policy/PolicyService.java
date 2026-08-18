package tech.certgate.policy;

import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Cross-domain read view of a Role's PolicyRules (docs/repository-structure.md
 * Service 경계, Codex 리뷰 PR #26 Medium). {@link AccessContextService} still
 * reads {@code PolicyRuleRepository} directly — a pre-existing exception this
 * PR does not extend, not a pattern to keep copying into new domains.
 */
@Service
public class PolicyService {

	private final PolicyRuleRepository policyRules;
	private final RoleRepository roles;

	public PolicyService(PolicyRuleRepository policyRules, RoleRepository roles) {
		this.policyRules = policyRules;
		this.roles = roles;
	}

	public record RuleView(String httpMethod, String pathPattern, String effect, int priority) {
	}

	@Transactional(readOnly = true)
	public List<RuleView> rulesForRole(String roleName) {
		return policyRules.findByRoleNameOrderByPriorityAsc(roleName).stream()
				.map(rule -> new RuleView(rule.getHttpMethod(), rule.getPathPattern(), rule.getEffect(), rule.getPriority()))
				.toList();
	}

	/** Cross-domain check for other domains (e.g. Device register/Role change) that must validate a roleName exists. */
	@Transactional(readOnly = true)
	public boolean roleExists(String roleName) {
		return roles.existsById(roleName);
	}
}
