package tech.certgate.policy;

import java.util.List;

/**
 * docs/api-spec.md §6 "Policy API". Rules travel with the Role so the Admin
 * Console can show what a Role allows without a round trip per Role.
 *
 * <p>The nested {@code RuleView} mirrors {@link AccessContextResponse.RuleView}
 * deliberately: each response owns its own DTO rather than sharing one across
 * API contracts, so changing one endpoint's shape cannot silently change
 * another's.
 */
public record RoleResponse(String name, List<RuleView> rules) {

	public record RuleView(String httpMethod, String pathPattern, String effect, int priority) {
	}
}
