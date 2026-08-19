package event

import (
	"testing"
	"time"
)

func TestNew_RequestAllowedIsInfoAndAllowed(t *testing.T) {
	evt := New(Params{Now: time.Now(), ReasonCode: ReasonRequestAllowed, TraceID: "t1"})
	if evt.Severity != SeverityInfo {
		t.Errorf("Severity = %s, want %s", evt.Severity, SeverityInfo)
	}
	if evt.Decision != DecisionAllowed {
		t.Errorf("Decision = %s, want %s", evt.Decision, DecisionAllowed)
	}
	if evt.ID == "" {
		t.Error("expected a generated event id")
	}
	if evt.Type != typeAccess {
		t.Errorf("Type = %s, want %s", evt.Type, typeAccess)
	}
}

// Revoked-certificate access is CRITICAL (docs/security-design.md §9: "폐기
// 인증서 접속").
func TestNew_CertificateRevokedIsCriticalAndDenied(t *testing.T) {
	evt := New(Params{Now: time.Now(), ReasonCode: ReasonCertificateRevoked, TraceID: "t2"})
	if evt.Severity != SeverityCritical {
		t.Errorf("Severity = %s, want %s", evt.Severity, SeverityCritical)
	}
	if evt.Decision != DecisionDenied {
		t.Errorf("Decision = %s, want %s", evt.Decision, DecisionDenied)
	}
}

func TestNew_InternalErrorIsWarningAndError(t *testing.T) {
	evt := New(Params{Now: time.Now(), ReasonCode: ReasonInternalError, TraceID: "t3"})
	if evt.Severity != SeverityWarning {
		t.Errorf("Severity = %s, want %s", evt.Severity, SeverityWarning)
	}
	if evt.Decision != DecisionError {
		t.Errorf("Decision = %s, want %s", evt.Decision, DecisionError)
	}
}

func TestNew_OtherDenialsAreWarningAndDenied(t *testing.T) {
	for _, reason := range []string{
		ReasonAccessDenied, ReasonDeviceDisabled, ReasonDeviceNotRegistered,
		ReasonCertificateExpired, ReasonInvalidCertificate,
	} {
		evt := New(Params{Now: time.Now(), ReasonCode: reason, TraceID: "t4"})
		if evt.Severity != SeverityWarning {
			t.Errorf("reason %s: Severity = %s, want %s", reason, evt.Severity, SeverityWarning)
		}
		if evt.Decision != DecisionDenied {
			t.Errorf("reason %s: Decision = %s, want %s", reason, evt.Decision, DecisionDenied)
		}
	}
}

func TestNew_IDsAreUnique(t *testing.T) {
	a := New(Params{Now: time.Now(), ReasonCode: ReasonRequestAllowed, TraceID: "t5"})
	b := New(Params{Now: time.Now(), ReasonCode: ReasonRequestAllowed, TraceID: "t5"})
	if a.ID == b.ID {
		t.Error("expected distinct event ids across calls")
	}
}

// docs/security-design.md §9: the Gateway is the Producer for both Outbox
// conditions and judges them CRITICAL at creation time.
func TestNewSystem_IsCriticalSystemEventWithoutRequestIdentity(t *testing.T) {
	for _, reason := range []string{ReasonEventOutboxBacklog, ReasonEventDeliveryDelayed} {
		evt := NewSystem(SystemParams{Now: time.Now(), ReasonCode: reason, TraceID: "t6"})
		if evt.Type != typeSystem {
			t.Errorf("reason %s: Type = %s, want %s", reason, evt.Type, typeSystem)
		}
		if evt.Severity != SeverityCritical {
			t.Errorf("reason %s: Severity = %s, want %s", reason, evt.Severity, SeverityCritical)
		}
		if evt.Decision != DecisionError {
			t.Errorf("reason %s: Decision = %s, want %s", reason, evt.Decision, DecisionError)
		}
		if evt.ReasonCode != reason {
			t.Errorf("ReasonCode = %s, want %s", evt.ReasonCode, reason)
		}
		if evt.DeviceID != "" || evt.CertificateSerial != "" || evt.ClientIP != "" ||
			evt.HTTPMethod != "" || evt.RequestPath != "" {
			t.Errorf("reason %s: %+v carries request identity, want none", reason, evt)
		}
	}
}

func TestNewSystem_IDsAreUnique(t *testing.T) {
	a := NewSystem(SystemParams{Now: time.Now(), ReasonCode: ReasonEventOutboxBacklog, TraceID: "t7"})
	b := NewSystem(SystemParams{Now: time.Now(), ReasonCode: ReasonEventOutboxBacklog, TraceID: "t7"})
	if a.ID == b.ID {
		t.Error("expected distinct event ids across calls")
	}
}
