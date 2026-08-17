package tech.certgate.policy;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Role name and description only. PolicyRule evaluation belongs to the
 * Gateway access-control work (Issue #2/#3), not this slice.
 */
@Entity
@Table(name = "role")
public class Role {

	@Id
	private String name;

	private String description;

	protected Role() {
	}

	public Role(String name, String description) {
		this.name = name;
		this.description = description;
	}

	public String getName() {
		return name;
	}

	public String getDescription() {
		return description;
	}
}
