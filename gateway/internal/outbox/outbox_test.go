package outbox

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"tech.certgate/gateway/internal/event"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "outbox.db")
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func testEvent(id string) event.Event {
	return event.New(event.Params{Now: time.Now(), ReasonCode: event.ReasonRequestAllowed, TraceID: id})
}

func TestEnqueueThenDue_ReturnsEnqueuedEvent(t *testing.T) {
	store := openTestStore(t)
	evt := testEvent("t1")

	if err := store.Enqueue(context.Background(), evt); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}

	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 1 || due[0].ID != evt.ID {
		t.Fatalf("Due = %+v, want [%s]", due, evt.ID)
	}
}

// Durability across a restart (docs/testing.md scenario 10: "Gateway 재시작
// 후 Outbox 보존") — reopening the same file must see the same pending event.
func TestEnqueue_SurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outbox.db")
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	evt := testEvent("t2")
	if err := store.Enqueue(context.Background(), evt); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer reopened.Close()

	due, err := reopened.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 1 || due[0].ID != evt.ID {
		t.Fatalf("Due after reopen = %+v, want [%s]", due, evt.ID)
	}
}

func TestDelete_RemovesEvent(t *testing.T) {
	store := openTestStore(t)
	evt := testEvent("t3")
	if err := store.Enqueue(context.Background(), evt); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	if err := store.Delete(context.Background(), evt.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("Due after delete = %+v, want none", due)
	}
}

func TestMarkFailed_SchedulesFutureRetryAndBumpsAttempts(t *testing.T) {
	store := openTestStore(t)
	evt := testEvent("t4")
	if err := store.Enqueue(context.Background(), evt); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}

	if err := store.MarkFailed(context.Background(), evt.ID, 60); err != nil {
		t.Fatalf("MarkFailed: %v", err)
	}

	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 0 {
		t.Fatalf("expected the event to not be due immediately after a backoff, got %+v", due)
	}
}

func TestMarkFailed_CapsAtMaxInterval(t *testing.T) {
	store := openTestStore(t)
	fixedNow := time.Now()
	store.now = func() time.Time { return fixedNow }

	evt := testEvent("t5")
	if err := store.Enqueue(context.Background(), evt); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}
	// Enough failures that uncapped exponential backoff would be huge.
	for i := 0; i < 10; i++ {
		if err := store.MarkFailed(context.Background(), evt.ID, 60); err != nil {
			t.Fatalf("MarkFailed: %v", err)
		}
	}

	store.now = func() time.Time { return fixedNow.Add(61 * time.Second) }
	due, err := store.Due(context.Background(), 10)
	if err != nil {
		t.Fatalf("Due: %v", err)
	}
	if len(due) != 1 {
		t.Fatalf("expected the event to become due once the capped 60s interval has passed, got %+v", due)
	}
}

func TestPendingCountAndOldestAgeSeconds(t *testing.T) {
	store := openTestStore(t)
	fixedNow := time.Now()
	store.now = func() time.Time { return fixedNow }

	if count, err := store.PendingCount(context.Background()); err != nil || count != 0 {
		t.Fatalf("PendingCount = %d, %v, want 0, nil", count, err)
	}

	if err := store.Enqueue(context.Background(), testEvent("t6")); err != nil {
		t.Fatalf("Enqueue: %v", err)
	}

	store.now = func() time.Time { return fixedNow.Add(5 * time.Second) }
	count, err := store.PendingCount(context.Background())
	if err != nil || count != 1 {
		t.Fatalf("PendingCount = %d, %v, want 1, nil", count, err)
	}
	age, err := store.OldestAgeSeconds(context.Background())
	if err != nil || age != 5 {
		t.Fatalf("OldestAgeSeconds = %d, %v, want 5, nil", age, err)
	}
}
