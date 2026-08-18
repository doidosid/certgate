package outbox

import (
	"context"
	"fmt"
	"time"

	"tech.certgate/gateway/internal/event"
	"tech.certgate/gateway/internal/management"
)

// Publisher is the subset of management.Client that Sender depends on, so
// tests can supply a fake without a real HTTP server.
type Publisher interface {
	PostSecurityEvents(ctx context.Context, events []event.Event) (management.BatchResult, error)
}

// Sender periodically flushes due Outbox events to the Management API in
// batches (docs/repository-structure.md: outbox "Batch 재전송"). The
// Management API accepts or rejects a whole batch atomically
// (docs/api-spec.md §7), so on success every event in the batch is deleted;
// on failure every event in the batch is rescheduled with backoff.
type Sender struct {
	store              *Store
	publisher          Publisher
	batchSize          int
	maxIntervalSeconds int
}

// NewSender builds a Sender over store, delivering through publisher.
func NewSender(store *Store, publisher Publisher, batchSize, maxIntervalSeconds int) *Sender {
	return &Sender{
		store:              store,
		publisher:          publisher,
		batchSize:          batchSize,
		maxIntervalSeconds: maxIntervalSeconds,
	}
}

// Flush sends up to one batch of due events and reports how many were
// delivered.
func (s *Sender) Flush(ctx context.Context) (int, error) {
	due, err := s.store.Due(ctx, s.batchSize)
	if err != nil {
		return 0, err
	}
	if len(due) == 0 {
		return 0, nil
	}

	if _, err := s.publisher.PostSecurityEvents(ctx, due); err != nil {
		for _, evt := range due {
			if markErr := s.store.MarkFailed(ctx, evt.ID, s.maxIntervalSeconds); markErr != nil {
				return 0, markErr
			}
		}
		return 0, fmt.Errorf("outbox: send batch of %d event(s): %w", len(due), err)
	}

	for _, evt := range due {
		if err := s.store.Delete(ctx, evt.ID); err != nil {
			return 0, err
		}
	}
	return len(due), nil
}

// Run flushes on every tick until ctx is done, reporting flush errors to
// onError (which may be nil).
func (s *Sender) Run(ctx context.Context, interval time.Duration, onError func(error)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := s.Flush(ctx); err != nil && onError != nil {
				onError(err)
			}
		}
	}
}
