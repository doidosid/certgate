package tech.certgate.policy;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

/** MVP uses ALLOW-list rules and a default DENY (docs/data-model.md). */
@Entity
@Table(name = "policy_rule")
public class PolicyRule {

	@Id
	private UUID id;

	@Column(name = "role_name", nullable = false)
	private String roleName;

	@Column(name = "http_method", nullable = false)
	private String httpMethod;

	@Column(name = "path_pattern", nullable = false)
	private String pathPattern;

	@Column(nullable = false)
	private String effect;

	@Column(nullable = false)
	private int priority;

	protected PolicyRule() {
	}

	public String getRoleName() {
		return roleName;
	}

	public String getHttpMethod() {
		return httpMethod;
	}

	public String getPathPattern() {
		return pathPattern;
	}

	public String getEffect() {
		return effect;
	}

	public int getPriority() {
		return priority;
	}
}
