package tech.certgate.policy;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, String> {

	/** Stable order for the Console's Role selector (docs/api-spec.md §6). */
	List<Role> findAllByOrderByNameAsc();
}
