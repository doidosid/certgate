package outbox

import (
	"context"
	"time"

	"github.com/google/uuid"

	"tech.certgate/gateway/internal/event"
)

// Thresholds for the two Outbox health conditions docs/security-design.md §9
// lists as CRITICAL: "Outbox 대기 100건 이상" and "가장 오래된 Outbox Event
// 지연 1분 이상". They are constants rather than environment variables because
// docs/operations.md "Event Outbox" makes only the batch size and the maximum
// backoff interval configurable.
const (
	DefaultBacklogThreshold      = 100
	DefaultDelayThresholdSeconds = 60
)

// Recorder is the subset of Store that Monitor depends on, so tests can make
// an individual read or write fail without a broken database file.
type Recorder interface {
	PendingCount(ctx context.Context) (int, error)
	OldestAgeSeconds(ctx context.Context) (int, error)
	Enqueue(ctx context.Context, evt event.Event) error
}

// Monitor watches the Gateway's own Outbox and produces the CRITICAL SYSTEM
// Security Events for backlog and delivery delay. The Gateway is the Producer
// for both conditions because its local SQLite Outbox is not visible to any
// other component (docs/security-design.md §9: "CRITICAL 여부는 각 Security
// Event를 생성하는 Producer가 발생 시점에 정한다").
//
// The Events it creates go through the same Outbox they describe, so while
// delivery is broken they wait there with everything else and reach the
// Console once delivery recovers. That is the intended trade-off: the Outbox
// is the durable record, and a CRITICAL Event must not be dropped just because
// it was born during the outage it reports.
//
// Detection is edge-triggered: an Event is produced only when a condition goes
// from clear to breached. Without that, a Management API outage would append a
// new Event on every tick — inflating the very backlog being reported and
// burying the Console in duplicates. A condition re-arms as soon as its value
// falls back below the threshold, so a later outage is reported again.
//
// A Monitor is not safe for concurrent use; Run drives it from one goroutine.
type Monitor struct {
	store                 Recorder
	backlogThreshold      int
	delayThresholdSeconds int
	now                   func() time.Time

	backlogFiring bool
	delayFiring   bool
}

// NewMonitor builds a Monitor over store using the given thresholds.
func NewMonitor(store Recorder, backlogThreshold, delayThresholdSeconds int) *Monitor {
	return &Monitor{
		store:                 store,
		backlogThreshold:      backlogThreshold,
		delayThresholdSeconds: delayThresholdSeconds,
		now:                   time.Now,
	}
}

// Check reads the Outbox once and enqueues a CRITICAL Event for each condition
// that has just become breached, returning the Events it enqueued. Both values
// are read before anything is written so the two conditions are judged against
// the same snapshot.
//
// A condition is marked as firing only after its Event is durably enqueued, so
// a failed write leaves the condition armed and the next Check retries it.
func (m *Monitor) Check(ctx context.Context) ([]event.Event, error) {
	pending, err := m.store.PendingCount(ctx)
	if err != nil {
		return nil, err
	}
	oldestAgeSeconds, err := m.store.OldestAgeSeconds(ctx)
	if err != nil {
		return nil, err
	}

	backlogBreached := pending >= m.backlogThreshold
	delayBreached := oldestAgeSeconds >= m.delayThresholdSeconds
	if !backlogBreached {
		m.backlogFiring = false
	}
	if !delayBreached {
		m.delayFiring = false
	}

	var produced []event.Event
	if backlogBreached && !m.backlogFiring {
		evt, err := m.record(ctx, event.ReasonEventOutboxBacklog)
		if err != nil {
			return produced, err
		}
		m.backlogFiring = true
		produced = append(produced, evt)
	}
	if delayBreached && !m.delayFiring {
		evt, err := m.record(ctx, event.ReasonEventDeliveryDelayed)
		if err != nil {
			return produced, err
		}
		m.delayFiring = true
		produced = append(produced, evt)
	}
	return produced, nil
}

func (m *Monitor) record(ctx context.Context, reasonCode string) (event.Event, error) {
	evt := event.NewSystem(event.SystemParams{
		Now:        m.now(),
		ReasonCode: reasonCode,
		TraceID:    uuid.NewString(),
	})
	if err := m.store.Enqueue(ctx, evt); err != nil {
		return event.Event{}, err
	}
	return evt, nil
}

// Run checks on every tick until ctx is done, reporting each produced Event to
// onEvent and each failure to onError (either may be nil).
func (m *Monitor) Run(ctx context.Context, interval time.Duration, onEvent func(event.Event), onError func(error)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			produced, err := m.Check(ctx)
			if onEvent != nil {
				for _, evt := range produced {
					onEvent(evt)
				}
			}
			if err != nil && onError != nil {
				onError(err)
			}
		}
	}
}
