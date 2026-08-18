package main

import (
	"testing"

	"tech.certgate/gateway/internal/event"
	"tech.certgate/gateway/internal/management"
	"tech.certgate/gateway/internal/policy"
)

func validAccessContext() management.AccessContext {
	return management.AccessContext{
		SerialNumber: "64", DeviceID: "device-1", DeviceKey: "sensor-floor-01",
		DeviceStatus: "ACTIVE", CertificateStatus: "VALID", RoleName: "SENSOR",
		Rules: []policy.Rule{{HTTPMethod: "POST", PathPattern: "/telemetry", Effect: "ALLOW", Priority: 10}},
	}
}

func TestDecide_Allowed(t *testing.T) {
	got := decide(validAccessContext(), "sensor-floor-01", "64", "POST", "/telemetry")
	if got != event.ReasonRequestAllowed {
		t.Errorf("decide = %s, want %s", got, event.ReasonRequestAllowed)
	}
}

// Codex review of PR #22, High #1: the Access Context's own Device Key and
// Serial Number must match what authenticated this connection, or a
// Management API bug/cache corruption could apply the wrong Role to the
// right identity.
func TestDecide_DeviceKeyMismatchFailsClosed(t *testing.T) {
	ctx := validAccessContext()
	got := decide(ctx, "sensor-floor-99", "64", "POST", "/telemetry")
	if got != event.ReasonInternalError {
		t.Errorf("decide = %s, want %s (Device Key mismatch)", got, event.ReasonInternalError)
	}
}

func TestDecide_SerialNumberMismatchFailsClosed(t *testing.T) {
	ctx := validAccessContext()
	got := decide(ctx, "sensor-floor-01", "99", "POST", "/telemetry")
	if got != event.ReasonInternalError {
		t.Errorf("decide = %s, want %s (serial number mismatch)", got, event.ReasonInternalError)
	}
}

func TestDecide_EmptyAccessContextFailsClosed(t *testing.T) {
	got := decide(management.AccessContext{}, "sensor-floor-01", "64", "POST", "/telemetry")
	if got != event.ReasonInternalError {
		t.Errorf("decide = %s, want %s (empty Access Context)", got, event.ReasonInternalError)
	}
}

// Codex review of PR #22, High #2: only the two Certificate states the
// Management API defines as usable (VALID, EXPIRING_SOON) may proceed to
// policy evaluation — everything else, including states the contract
// doesn't define, must Fail Closed.
func TestDecide_UnknownCertificateStatusFailsClosed(t *testing.T) {
	cases := []string{"", "PENDING", "SUSPENDED", "unexpected"}
	for _, status := range cases {
		t.Run(status, func(t *testing.T) {
			ctx := validAccessContext()
			ctx.CertificateStatus = status
			got := decide(ctx, "sensor-floor-01", "64", "POST", "/telemetry")
			if got != event.ReasonInternalError {
				t.Errorf("decide with certificateStatus=%q = %s, want %s", status, got, event.ReasonInternalError)
			}
		})
	}
}

func TestDecide_ExpiringSoonStillEvaluatesPolicy(t *testing.T) {
	ctx := validAccessContext()
	ctx.CertificateStatus = "EXPIRING_SOON"
	got := decide(ctx, "sensor-floor-01", "64", "POST", "/telemetry")
	if got != event.ReasonRequestAllowed {
		t.Errorf("decide = %s, want %s (EXPIRING_SOON must still be usable)", got, event.ReasonRequestAllowed)
	}
}

func TestDecide_RevokedBlocked(t *testing.T) {
	ctx := validAccessContext()
	ctx.CertificateStatus = "REVOKED"
	got := decide(ctx, "sensor-floor-01", "64", "POST", "/telemetry")
	if got != event.ReasonCertificateRevoked {
		t.Errorf("decide = %s, want %s", got, event.ReasonCertificateRevoked)
	}
}

func TestDecide_ExpiredBlocked(t *testing.T) {
	ctx := validAccessContext()
	ctx.CertificateStatus = "EXPIRED"
	got := decide(ctx, "sensor-floor-01", "64", "POST", "/telemetry")
	if got != event.ReasonCertificateExpired {
		t.Errorf("decide = %s, want %s", got, event.ReasonCertificateExpired)
	}
}

func TestDecide_DisabledDeviceBlocked(t *testing.T) {
	ctx := validAccessContext()
	ctx.DeviceStatus = "DISABLED"
	got := decide(ctx, "sensor-floor-01", "64", "POST", "/telemetry")
	if got != event.ReasonDeviceDisabled {
		t.Errorf("decide = %s, want %s", got, event.ReasonDeviceDisabled)
	}
}

func TestDecide_NoMatchingPolicyDenied(t *testing.T) {
	ctx := validAccessContext()
	got := decide(ctx, "sensor-floor-01", "64", "GET", "/commands")
	if got != event.ReasonAccessDenied {
		t.Errorf("decide = %s, want %s", got, event.ReasonAccessDenied)
	}
}
