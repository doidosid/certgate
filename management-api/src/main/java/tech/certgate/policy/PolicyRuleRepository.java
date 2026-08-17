package tech.certgate.policy;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PolicyRuleRepository extends JpaRepository<PolicyRule, UUID> {

	List<PolicyRule> findByRoleNameOrderByPriorityAsc(String roleName);
}
