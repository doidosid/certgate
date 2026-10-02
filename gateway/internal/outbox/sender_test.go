package outbox

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"tech.certgate/gateway/internal/event"
	"tech.certgate/gateway/internal/management"
)

type fakePublisher struct {
	calls int
	batch []event.Event
	err   error
}

func (f *fakePublisher) PostSecurityEvents(ctx context.Context, events []event.Event) (management.BatchResult, error) {
	f.calls++
	f.batch = events
	if f.err != nil {
		return management.BatchResult{}, f.err
	}
	return management.BatchResult{AcceptedCount: len(events)}, nil
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "outbox.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestFlush_SuccessDeletesDeliveredEvents(t *testing.T) {
	store := newTestStore(t)
	evt := testEvent("t1")
	if err := store.Enqueue(context.Background(), evt); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	publisher := &fakePublisher{}
	sender := NewSender(store, publisher, 50, 60)

	sent, err := sender.Flush(context.Background())
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if sent != 1 {
		t.Fatalf("sent = %d, want 1", sent)
	}

	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("expected outbox to be empty after a successful flush, got %+v", due)
	}
}

// Batch delivery is all-or-nothing (docs/api-spec.md §7): a failed batch
// must reschedule every event in it, not delete any.
func TestFlush_FailureReschedulesAllEvents(t *testing.T) {
	store := newTestStore(t)
	if err := store.Enqueue(context.Background(), testEvent("t2")); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	if err := store.Enqueue(context.Background(), testEvent("t3")); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	publisher := &fakePublisher{err: errors.New("management api down")}
	sender := NewSender(store, publisher, 50, 60)

	if _, err := sender.Flush(context.Background()); err == nil {
		t.Fatal("expected Flush to report the publisher error")
	}

	count, _, err := store.Stats(context.Background())
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if count != 2 {
		t.Fatalf("pendingCount = %d, want 2 (failed batch must not lose events)", count)
	}

	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("expected both events to be rescheduled into the future, got %d due", len(due))
	}
}

func TestFlush_NoDueEventsIsNoop(t *testing.T) {
	store := newTestStore(t)
	publisher := &fakePublisher{}
	sender := NewSender(store, publisher, 50, 60)

	sent, err := sender.Flush(context.Background())
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if sent != 0 {
		t.Fatalf("sent = %d, want 0", sent)
	}
	if publisher.calls != 0 {
		t.Fatalf("expected no publisher call when nothing is due")
	}
}

func TestRun_FlushesOnEveryTickUntilCancelled(t *testing.T) {
	store := newTestStore(t)
	if err := store.Enqueue(context.Background(), testEvent("t4")); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	publisher := &fakePublisher{}
	sender := NewSender(store, publisher, 50, 60)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	sender.Run(ctx, 5*time.Millisecond, nil)

	count, _, err := store.Stats(context.Background())
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected Run to have flushed the pending event, pendingCount = %d", count)
	}
}

// Events enqueued by a Gateway built before event.New fitted method and path
// to the storage columns are still in existing Outbox files. Flush must fit
// them too, or that one event keeps failing every batch it is in.
func TestFlush_FitsOversizedEventsAlreadyInOutbox(t *testing.T) {
	store := newTestStore(t)
	legacy := testEvent("t-legacy")
	legacy.HTTPMethod = "VERYLONGMETHODNAME"
	legacy.RequestPath = "/a\x00" + strings.Repeat("b", 400)
	if err := store.Enqueue(context.Background(), legacy); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	publisher := &fakePublisher{}
	sender := NewSender(store, publisher, 50, 60)

	if _, err := sender.Flush(context.Background()); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if len(publisher.batch) != 1 {
		t.Fatalf("published %d event(s), want 1", len(publisher.batch))
	}
	got := publisher.batch[0]
	if got.HTTPMethod != "VERYLONGME" {
		t.Errorf("HTTPMethod = %q, want the first 10 characters", got.HTTPMethod)
	}
	if strings.ContainsRune(got.RequestPath, 0) || utf8.RuneCountInString(got.RequestPath) != 255 {
		t.Errorf("RequestPath = %q, want 255 characters without NUL", got.RequestPath)
	}
	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 0 {
		t.Errorf("legacy event still in the Outbox after delivery: %+v", due)
	}
}
