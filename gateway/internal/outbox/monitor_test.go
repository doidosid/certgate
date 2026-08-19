package outbox

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"tech.certgate/gateway/internal/event"
)

// fakeRecorder reports fixed Outbox state and can be told to fail one call, so
// the edge-trigger and retry paths are exercised without a real backlog of 100
// events or a 60-second wait.
type fakeRecorder struct {
	pending          int
	oldestAgeSeconds int
	enqueued         []event.Event
	enqueueErr       error
	statsErr         error
}

func (f *fakeRecorder) Stats(context.Context) (int, int, error) {
	if f.statsErr != nil {
		return 0, 0, f.statsErr
	}
	return f.pending, f.oldestAgeSeconds, nil
}

func (f *fakeRecorder) Enqueue(_ context.Context, evt event.Event) error {
	if f.enqueueErr != nil {
		return f.enqueueErr
	}
	f.enqueued = append(f.enqueued, evt)
	return nil
}

func reasonCodes(events []event.Event) []string {
	codes := make([]string, 0, len(events))
	for _, evt := range events {
		codes = append(codes, evt.ReasonCode)
	}
	return codes
}

func TestCheck_BelowThresholds_ProducesNothing(t *testing.T) {
	recorder := &fakeRecorder{pending: 99, oldestAgeSeconds: 59}
	monitor := NewMonitor(recorder, 100, 60)

	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if len(produced) != 0 {
		t.Errorf("produced = %v, want none just below both thresholds", reasonCodes(produced))
	}
	if len(recorder.enqueued) != 0 {
		t.Errorf("enqueued = %v, want none", reasonCodes(recorder.enqueued))
	}
}

// docs/security-design.md §9: "Outbox 대기 100건 이상" is a CRITICAL condition.
func TestCheck_BacklogAtThreshold_ProducesCriticalSystemEvent(t *testing.T) {
	recorder := &fakeRecorder{pending: 100}
	monitor := NewMonitor(recorder, 100, 60)

	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if len(produced) != 1 || produced[0].ReasonCode != event.ReasonEventOutboxBacklog {
		t.Fatalf("produced = %v, want [%s]", reasonCodes(produced), event.ReasonEventOutboxBacklog)
	}

	evt := produced[0]
	if evt.Severity != event.SeverityCritical {
		t.Errorf("severity = %q, want %q", evt.Severity, event.SeverityCritical)
	}
	if evt.Type != "SYSTEM" {
		t.Errorf("type = %q, want SYSTEM", evt.Type)
	}
	if evt.Decision != event.DecisionError {
		t.Errorf("decision = %q, want %q", evt.Decision, event.DecisionError)
	}
	if evt.ID == "" || evt.TraceID == "" {
		t.Errorf("id = %q, traceId = %q, want both set", evt.ID, evt.TraceID)
	}
	if evt.DeviceID != "" || evt.CertificateSerial != "" || evt.ClientIP != "" {
		t.Errorf("event carries request identity %+v, want none on a SYSTEM event", evt)
	}

	// The Event must reach the Outbox, not just the caller: it is the durable
	// record the Management API eventually receives.
	if len(recorder.enqueued) != 1 || recorder.enqueued[0].ID != evt.ID {
		t.Errorf("enqueued = %v, want the produced event", reasonCodes(recorder.enqueued))
	}
}

// docs/security-design.md §9: "가장 오래된 Outbox Event 지연 1분 이상".
func TestCheck_DelayAtThreshold_ProducesCriticalSystemEvent(t *testing.T) {
	recorder := &fakeRecorder{pending: 1, oldestAgeSeconds: 60}
	monitor := NewMonitor(recorder, 100, 60)

	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if len(produced) != 1 || produced[0].ReasonCode != event.ReasonEventDeliveryDelayed {
		t.Fatalf("produced = %v, want [%s]", reasonCodes(produced), event.ReasonEventDeliveryDelayed)
	}
	if produced[0].Severity != event.SeverityCritical {
		t.Errorf("severity = %q, want %q", produced[0].Severity, event.SeverityCritical)
	}
}

func TestCheck_BothConditionsBreached_ProducesBothEvents(t *testing.T) {
	recorder := &fakeRecorder{pending: 250, oldestAgeSeconds: 300}
	monitor := NewMonitor(recorder, 100, 60)

	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	want := []string{event.ReasonEventOutboxBacklog, event.ReasonEventDeliveryDelayed}
	got := reasonCodes(produced)
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("produced = %v, want %v", got, want)
	}
}

// A Management API outage keeps both conditions breached on every tick. Without
// edge triggering the Gateway would append a new CRITICAL Event each time,
// growing the very backlog it reports.
func TestCheck_SustainedBreach_ProducesOneEventPerCondition(t *testing.T) {
	recorder := &fakeRecorder{pending: 250, oldestAgeSeconds: 300}
	monitor := NewMonitor(recorder, 100, 60)

	if _, err := monitor.Check(context.Background()); err != nil {
		t.Fatalf("first Check: %v", err)
	}
	for i := 0; i < 5; i++ {
		recorder.pending += 10
		recorder.oldestAgeSeconds += 10
		produced, err := monitor.Check(context.Background())
		if err != nil {
			t.Fatalf("Check %d: %v", i+2, err)
		}
		if len(produced) != 0 {
			t.Fatalf("Check %d produced %v, want none while the same breach continues", i+2, reasonCodes(produced))
		}
	}
	if len(recorder.enqueued) != 2 {
		t.Errorf("enqueued = %v, want exactly one event per condition", reasonCodes(recorder.enqueued))
	}
}

// After delivery recovers and the Outbox drains, a later outage is a new
// incident and must be reported again.
func TestCheck_RecoveryThenSecondBreach_ProducesEventAgain(t *testing.T) {
	recorder := &fakeRecorder{pending: 120}
	monitor := NewMonitor(recorder, 100, 60)

	if _, err := monitor.Check(context.Background()); err != nil {
		t.Fatalf("first Check: %v", err)
	}

	recorder.pending = 0
	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("recovery Check: %v", err)
	}
	if len(produced) != 0 {
		t.Fatalf("recovery produced %v, want none", reasonCodes(produced))
	}

	recorder.pending = 150
	produced, err = monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("second breach Check: %v", err)
	}
	if len(produced) != 1 || produced[0].ReasonCode != event.ReasonEventOutboxBacklog {
		t.Errorf("produced = %v, want [%s] for the second breach", reasonCodes(produced), event.ReasonEventOutboxBacklog)
	}
}

// If the Event cannot be durably stored, the condition must stay armed so the
// next tick retries — otherwise a single failed write silently loses the only
// notification of a CRITICAL condition.
func TestCheck_EnqueueFailure_RetriesOnNextCheck(t *testing.T) {
	recorder := &fakeRecorder{pending: 120, enqueueErr: errors.New("disk full")}
	monitor := NewMonitor(recorder, 100, 60)

	produced, err := monitor.Check(context.Background())
	if err == nil {
		t.Fatal("Check: want error when the Event cannot be enqueued")
	}
	if len(produced) != 0 {
		t.Errorf("produced = %v, want none when the write failed", reasonCodes(produced))
	}

	recorder.enqueueErr = nil
	produced, err = monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("retry Check: %v", err)
	}
	if len(produced) != 1 || produced[0].ReasonCode != event.ReasonEventOutboxBacklog {
		t.Errorf("produced = %v, want [%s] on retry", reasonCodes(produced), event.ReasonEventOutboxBacklog)
	}
}

// The breach happened, so its CRITICAL Event must be recorded even if the
// Outbox drains before the write succeeds. Retrying only while the threshold is
// still exceeded would drop the notification entirely — one transient SQLite
// failure followed by recovery and the incident leaves no trace anywhere
// (Codex 리뷰 PR #31 High).
func TestCheck_EnqueueFailureThenRecovery_StillRecordsTheBreach(t *testing.T) {
	recorder := &fakeRecorder{pending: 120, enqueueErr: errors.New("disk full")}
	monitor := NewMonitor(recorder, 100, 60)

	if _, err := monitor.Check(context.Background()); err == nil {
		t.Fatal("Check: want error when the Event cannot be enqueued")
	}

	// The Sender drains the Outbox before the next tick, clearing the breach.
	recorder.pending = 0
	recorder.enqueueErr = nil

	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("recovery Check: %v", err)
	}
	if len(produced) != 1 || produced[0].ReasonCode != event.ReasonEventOutboxBacklog {
		t.Fatalf("produced = %v, want [%s] — the breach still has no durable record",
			reasonCodes(produced), event.ReasonEventOutboxBacklog)
	}

	// ...and it is recorded once, not again on the next quiet tick.
	produced, err = monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("quiet Check: %v", err)
	}
	if len(produced) != 0 {
		t.Errorf("produced = %v, want none once the breach is recorded", reasonCodes(produced))
	}
}

// The same guarantee for the delay condition.
func TestCheck_DelayEnqueueFailureThenRecovery_StillRecordsTheBreach(t *testing.T) {
	recorder := &fakeRecorder{oldestAgeSeconds: 90, enqueueErr: errors.New("disk full")}
	monitor := NewMonitor(recorder, 100, 60)

	if _, err := monitor.Check(context.Background()); err == nil {
		t.Fatal("Check: want error when the Event cannot be enqueued")
	}

	recorder.oldestAgeSeconds = 0
	recorder.enqueueErr = nil

	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("recovery Check: %v", err)
	}
	if len(produced) != 1 || produced[0].ReasonCode != event.ReasonEventDeliveryDelayed {
		t.Errorf("produced = %v, want [%s]", reasonCodes(produced), event.ReasonEventDeliveryDelayed)
	}
}

// The enqueue error must name the condition: until the write succeeds the
// operational log is the only trace of this CRITICAL condition, and
// Store.Enqueue's own error names only the event id.
func TestCheck_EnqueueFailure_ErrorNamesTheReasonCode(t *testing.T) {
	recorder := &fakeRecorder{pending: 120, enqueueErr: errors.New("disk full")}
	monitor := NewMonitor(recorder, 100, 60)

	_, err := monitor.Check(context.Background())
	if err == nil {
		t.Fatal("Check: want error")
	}
	if !strings.Contains(err.Error(), event.ReasonEventOutboxBacklog) {
		t.Errorf("error = %q, want it to name %s", err, event.ReasonEventOutboxBacklog)
	}
	if !strings.Contains(err.Error(), "disk full") {
		t.Errorf("error = %q, want the underlying cause wrapped", err)
	}
}

func TestCheck_ReadFailure_ReturnsErrorWithoutEnqueueing(t *testing.T) {
	recorder := &fakeRecorder{pending: 120, statsErr: errors.New("read failed")}
	monitor := NewMonitor(recorder, 100, 60)

	if _, err := monitor.Check(context.Background()); err == nil {
		t.Fatal("Check: want error when the Outbox cannot be read")
	}
	if len(recorder.enqueued) != 0 {
		t.Errorf("enqueued = %v, want none when the snapshot is incomplete", reasonCodes(recorder.enqueued))
	}
}

// The Monitor's own Events must survive in the Outbox they describe, so they
// are delivered once the Management API recovers.
func TestCheck_AgainstRealStore_PersistsProducedEvent(t *testing.T) {
	store := openTestStore(t)
	monitor := NewMonitor(store, 1, 60)

	if err := store.Enqueue(context.Background(), testEvent("t1")); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}

	produced, err := monitor.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if len(produced) != 1 {
		t.Fatalf("produced = %v, want one backlog event", reasonCodes(produced))
	}

	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	var found bool
	for _, evt := range due {
		if evt.ID == produced[0].ID {
			found = true
			if evt.Severity != event.SeverityCritical || evt.ReasonCode != event.ReasonEventOutboxBacklog {
				t.Errorf("stored event = %+v, want CRITICAL %s", evt, event.ReasonEventOutboxBacklog)
			}
		}
	}
	if !found {
		t.Errorf("produced event %s is not pending delivery", produced[0].ID)
	}
}

func TestRun_ChecksOnTickAndStopsOnContextCancel(t *testing.T) {
	recorder := &fakeRecorder{pending: 120}
	monitor := NewMonitor(recorder, 100, 60)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events := make(chan event.Event, 4)
	done := make(chan struct{})
	go func() {
		monitor.Run(ctx, time.Millisecond, func(evt event.Event) { events <- evt }, nil)
		close(done)
	}()

	select {
	case evt := <-events:
		if evt.ReasonCode != event.ReasonEventOutboxBacklog {
			t.Errorf("reasonCode = %q, want %q", evt.ReasonCode, event.ReasonEventOutboxBacklog)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not report the breached condition")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop after the context was cancelled")
	}
}
