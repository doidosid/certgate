package policy

import "testing"

func sensorRules() []Rule {
	return []Rule{
		{HTTPMethod: "POST", PathPattern: "/telemetry", Effect: "ALLOW", Priority: 10},
		{HTTPMethod: "POST", PathPattern: "/heartbeat", Effect: "ALLOW", Priority: 20},
	}
}

func operatorRules() []Rule {
	rules := sensorRules()
	return append(rules, Rule{HTTPMethod: "GET", PathPattern: "/commands", Effect: "ALLOW", Priority: 30})
}

// Device Profile A (docs/testing.md): normal SENSOR Heartbeat/Telemetry allowed.
func TestEvaluate_SensorAllowedPaths(t *testing.T) {
	rules := sensorRules()
	if !Evaluate(rules, "POST", "/telemetry") {
		t.Error("expected POST /telemetry to be allowed for SENSOR")
	}
	if !Evaluate(rules, "POST", "/heartbeat") {
		t.Error("expected POST /heartbeat to be allowed for SENSOR")
	}
}

// Device Profile E (docs/testing.md): SENSOR hitting /commands is denied.
func TestEvaluate_SensorCommandsDenied(t *testing.T) {
	rules := sensorRules()
	if Evaluate(rules, "GET", "/commands") {
		t.Error("expected GET /commands to be denied for SENSOR")
	}
}

// Device Profile F (docs/testing.md): OPERATOR is allowed /commands too.
func TestEvaluate_OperatorCommandsAllowed(t *testing.T) {
	rules := operatorRules()
	if !Evaluate(rules, "GET", "/commands") {
		t.Error("expected GET /commands to be allowed for OPERATOR")
	}
}

func TestEvaluate_NoMatchingRuleDenies(t *testing.T) {
	rules := sensorRules()
	if Evaluate(rules, "DELETE", "/telemetry") {
		t.Error("expected DELETE /telemetry to be denied: wrong method")
	}
	if Evaluate(rules, "POST", "/unknown") {
		t.Error("expected POST /unknown to be denied: no matching path")
	}
}

func TestEvaluate_DenyEffectRuleNeverMatches(t *testing.T) {
	rules := []Rule{{HTTPMethod: "POST", PathPattern: "/telemetry", Effect: "DENY", Priority: 10}}
	if Evaluate(rules, "POST", "/telemetry") {
		t.Error("a DENY-effect rule must never grant access")
	}
}

func TestEvaluate_MethodIsCaseInsensitive(t *testing.T) {
	rules := sensorRules()
	if !Evaluate(rules, "post", "/telemetry") {
		t.Error("expected method matching to be case-insensitive")
	}
}

func TestEvaluate_TrailingSlashNormalized(t *testing.T) {
	rules := sensorRules()
	if !Evaluate(rules, "POST", "/telemetry/") {
		t.Error("expected trailing slash to be normalized before matching")
	}
}

func TestEvaluate_EmptyRulesDenies(t *testing.T) {
	if Evaluate(nil, "POST", "/telemetry") {
		t.Error("expected no rules to deny by default")
	}
}
