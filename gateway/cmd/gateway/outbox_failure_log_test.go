package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"testing"
	"time"

	"tech.certgate/gateway/internal/event"
)

// captureAccessLog redirects the structured log stream for one test.
func captureAccessLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	original := accessLogger
	accessLogger = log.New(&buf, "", 0)
	t.Cleanup(func() { accessLogger = original })
	return &buf
}

// docs/architecture.md "장애 원칙": "SQLite Outbox 로컬 Transaction 자체가
// 실패하면 구조화 로그로 기록하고 Event가 보존되었다고 간주하지 않음". Until the
// write is retried this line is the only trace of the Event, so it has to be
// machine-readable and say that nothing was persisted.
func TestLogOutboxFailure_WritesStructuredLineMarkingEventNotPersisted(t *testing.T) {
	buf := captureAccessLog(t)
	now := time.Date(2026, 8, 19, 5, 50, 0, 0, time.UTC)

	logOutboxFailure(now, "trace-1", event.ReasonEventOutboxBacklog, errors.New("database is locked"))

	line := strings.TrimSpace(buf.String())
	var got outboxFailureLogLine
	if err := json.Unmarshal([]byte(line), &got); err != nil {
		t.Fatalf("log line is not valid JSON (%q): %v", line, err)
	}

	if got.Timestamp != "2026-08-19T05:50:00Z" {
		t.Errorf("timestamp = %q, want 2026-08-19T05:50:00Z", got.Timestamp)
	}
	if got.Level != "ERROR" {
		t.Errorf("level = %q, want ERROR", got.Level)
	}
	if got.Service != "gateway" {
		t.Errorf("service = %q, want gateway", got.Service)
	}
	if got.TraceID != "trace-1" {
		t.Errorf("traceId = %q, want trace-1", got.TraceID)
	}
	if got.ReasonCode != event.ReasonEventOutboxBacklog {
		t.Errorf("reasonCode = %q, want %q", got.ReasonCode, event.ReasonEventOutboxBacklog)
	}
	if got.OutboxPersisted {
		t.Error("outboxPersisted = true, want false — the Event was not preserved")
	}
	if !strings.Contains(got.Error, "database is locked") {
		t.Errorf("error = %q, want the underlying cause", got.Error)
	}
}

// The failure line carries a Reason Code and an error string only. Event
// content must not leak into it (docs/security-design.md §10 "기록 금지").
func TestLogOutboxFailure_DoesNotLogEventContent(t *testing.T) {
	buf := captureAccessLog(t)

	logOutboxFailure(time.Now(), "trace-2", event.ReasonCertificateRevoked, errors.New("disk I/O error"))

	line := buf.String()
	for _, forbidden := range []string{"BEGIN CERTIFICATE", "PRIVATE KEY", "cg_enroll_"} {
		if strings.Contains(line, forbidden) {
			t.Errorf("log line %q contains %q", line, forbidden)
		}
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	allowed := map[string]bool{
		"timestamp": true, "level": true, "service": true,
		"traceId": true, "reasonCode": true, "outboxPersisted": true, "error": true,
	}
	for key := range got {
		if !allowed[key] {
			t.Errorf("unexpected field %q in the Outbox failure log", key)
		}
	}
}

// A CRITICAL Event the Monitor could not store must reach the same structured
// line, so an operator sees the condition even though the Event never made it
// to the Management API.
func TestLogSystemEvent_WritesStructuredLine(t *testing.T) {
	buf := captureAccessLog(t)
	evt := event.NewSystem(event.SystemParams{
		Now:        time.Date(2026, 8, 19, 6, 0, 0, 0, time.UTC),
		ReasonCode: event.ReasonEventDeliveryDelayed,
		TraceID:    "trace-3",
	})

	logSystemEvent(evt)

	var got systemLogLine
	if err := json.Unmarshal([]byte(strings.TrimSpace(buf.String())), &got); err != nil {
		t.Fatalf("log line is not valid JSON (%q): %v", buf.String(), err)
	}
	if got.Severity != event.SeverityCritical {
		t.Errorf("severity = %q, want %q", got.Severity, event.SeverityCritical)
	}
	if got.ReasonCode != event.ReasonEventDeliveryDelayed {
		t.Errorf("reasonCode = %q, want %q", got.ReasonCode, event.ReasonEventDeliveryDelayed)
	}
	if got.Level != "ERROR" {
		t.Errorf("level = %q, want ERROR", got.Level)
	}
	if got.TraceID != "trace-3" {
		t.Errorf("traceId = %q, want trace-3", got.TraceID)
	}
}
