package event

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
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

// HTTPMethod and RequestPath come from the Device request as-is, but the
// Management API stores them in VARCHAR(10) / VARCHAR(255) columns
// (V7__create_security_event.sql) and Postgres rejects NUL in text. One
// oversized or NUL-bearing event fails the whole batch it rides in
// (docs/api-spec.md §7), so New must fit them to the columns.
func TestNew_FitsMethodAndPathToStorageColumns(t *testing.T) {
	evt := New(Params{
		Now:         time.Now(),
		HTTPMethod:  "VERYLONGMETHODNAME",
		RequestPath: "/" + strings.Repeat("a", 400),
		ReasonCode:  ReasonAccessDenied,
		TraceID:     "t8",
	})
	if evt.HTTPMethod != "VERYLONGME" {
		t.Errorf("HTTPMethod = %q, want the first 10 characters", evt.HTTPMethod)
	}
	if got := utf8.RuneCountInString(evt.RequestPath); got != 255 {
		t.Errorf("RequestPath has %d characters, want 255", got)
	}
}

// Postgres VARCHAR(n) counts characters, not bytes, so the cut must fall on a
// character boundary and keep 255 characters of a multibyte path.
func TestSanitize_CountsCharactersNotBytes(t *testing.T) {
	evt := Sanitize(Event{RequestPath: strings.Repeat("가", 300)})
	if !utf8.ValidString(evt.RequestPath) {
		t.Fatalf("RequestPath %q is not valid UTF-8", evt.RequestPath)
	}
	if evt.RequestPath != strings.Repeat("가", 255) {
		t.Errorf("RequestPath has %d characters, want 255 of the original", utf8.RuneCountInString(evt.RequestPath))
	}
}

// r.URL.Path decodes %00 to NUL and %FF to a stray byte; both must become
// U+FFFD so the stored path still shows where they were.
func TestSanitize_ReplacesNulAndInvalidUTF8(t *testing.T) {
	evt := Sanitize(Event{HTTPMethod: "G\x00T", RequestPath: "/a\x00b\xffc"})
	if evt.HTTPMethod != "G\uFFFDT" {
		t.Errorf("HTTPMethod = %q, want %q", evt.HTTPMethod, "G\uFFFDT")
	}
	if evt.RequestPath != "/a\uFFFDb\uFFFDc" {
		t.Errorf("RequestPath = %q, want %q", evt.RequestPath, "/a\uFFFDb\uFFFDc")
	}
}

func TestSanitize_LeavesFittingValuesUnchanged(t *testing.T) {
	in := Event{HTTPMethod: "GET", RequestPath: "/telemetry/" + strings.Repeat("x", 244)}
	if out := Sanitize(in); out != in {
		t.Errorf("Sanitize changed a fitting event: %+v -> %+v", in, out)
	}
}
