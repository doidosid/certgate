// Package policy evaluates a Device Role's rules against an incoming
// request's HTTP method and path (docs/api-spec.md §6, docs/security-design.md §7).
package policy

import "strings"

// Rule is one Role policy rule (docs/api-spec.md §6). Field tags let
// management.AccessContext decode the Access Context response directly into
// this type.
type Rule struct {
	HTTPMethod  string `json:"httpMethod"`
	PathPattern string `json:"pathPattern"`
	Effect      string `json:"effect"`
	Priority    int    `json:"priority"`
}

const effectAllow = "ALLOW"

// Evaluate reports whether method+path is allowed by rules. No matching
// ALLOW rule means DENY (docs/security-design.md §7: "일치하는 ALLOW 규칙이
// 없으면 DENY"). Paths are normalized (trailing slash removed) before
// matching so "/telemetry" and "/telemetry/" are treated the same.
func Evaluate(rules []Rule, method, path string) bool {
	normalized := normalizePath(path)
	for _, rule := range rules {
		if rule.Effect != effectAllow {
			continue
		}
		if !strings.EqualFold(rule.HTTPMethod, method) {
			continue
		}
		if normalizePath(rule.PathPattern) == normalized {
			return true
		}
	}
	return false
}

func normalizePath(path string) string {
	if len(path) > 1 && strings.HasSuffix(path, "/") {
		return strings.TrimRight(path, "/")
	}
	return path
}
