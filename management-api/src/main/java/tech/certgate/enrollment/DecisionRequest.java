package tech.certgate.enrollment;

/** Body for both admin decisions on a CSR (docs/api-spec.md §4: approve, reject). */
public record DecisionRequest(String decisionNote) {
}
