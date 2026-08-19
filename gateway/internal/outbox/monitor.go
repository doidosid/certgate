package outbox

import (
	"context"
	"fmt"
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
	Stats(ctx context.Context) (pendingCount, oldestAgeSeconds int, err error)
	Enqueue(ctx context.Context, evt event.Event) error
}

// RecordError reports a CRITICAL condition whose Security Event could not be
// written to the Outbox. It carries the Reason Code and Trace ID so the caller
// can log the failure in structured form: docs/architecture.md "장애 원칙"
// requires a failed Outbox write to be logged and the Event not to be treated
// as preserved, and until the retry succeeds that log line is the only trace
// of the condition.
type RecordError struct {
	ReasonCode string
	TraceID    string
	Err        error
}

func (e *RecordError) Error() string {
	return fmt.Sprintf("outbox: record %s security event: %v", e.ReasonCode, e.Err)
}

func (e *RecordError) Unwrap() error { return e.Err }

// condition tracks one Outbox threshold across checks.
//
// firing means a breach has been reported and has not recovered yet; it is
// what makes detection edge-triggered. unsent means a detected breach still
// has no durable record, and is deliberately independent of the current
// reading: once a breach has happened its CRITICAL Event must be stored even
// if the Outbox drains before the write finally succeeds. Tying the retry to
// "is it still breached?" instead loses the notification entirely when a
// transient SQLite failure is followed by recovery (Codex 리뷰 PR #31 High).
type condition struct {
	reasonCode string
	firing     bool
	unsent     bool
}

// observe folds one reading into the condition's state.
func (c *condition) observe(breached bool) {
	switch {
	case breached && !c.firing:
		c.firing = true
		c.unsent = true
	case !breached:
		c.firing = false
	}
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
// The edge state lives in memory, so a Gateway restart during an ongoing
// breach reports that breach once more. That is accepted: the duplicate is
// bounded by the restart count, and persisting the state would mean a second
// durable store beyond the Outbox that docs/operations.md defines.
//
// A Monitor is not safe for concurrent use; Run drives it from one goroutine.
type Monitor struct {
	store                 Recorder
	backlogThreshold      int
	delayThresholdSeconds int
	now                   func() time.Time

	backlog condition
	delay   condition
}

// NewMonitor builds a Monitor over store using the given thresholds.
func NewMonitor(store Recorder, backlogThreshold, delayThresholdSeconds int) *Monitor {
	return &Monitor{
		store:                 store,
		backlogThreshold:      backlogThreshold,
		delayThresholdSeconds: delayThresholdSeconds,
		now:                   time.Now,
		backlog:               condition{reasonCode: event.ReasonEventOutboxBacklog},
		delay:                 condition{reasonCode: event.ReasonEventDeliveryDelayed},
	}
}

// Check reads the Outbox once, folds the reading into both conditions, and
// enqueues a CRITICAL Event for every breach that does not have a durable
// record yet. It returns the Events it enqueued.
//
// A condition is cleared only after its Event is durably enqueued, so a failed
// write is retried on the next Check whether or not the Outbox has recovered
// in the meantime.
func (m *Monitor) Check(ctx context.Context) ([]event.Event, error) {
	pendingCount, oldestAgeSeconds, err := m.store.Stats(ctx)
	if err != nil {
		return nil, err
	}
	m.backlog.observe(pendingCount >= m.backlogThreshold)
	m.delay.observe(oldestAgeSeconds >= m.delayThresholdSeconds)

	var produced []event.Event
	for _, c := range []*condition{&m.backlog, &m.delay} {
		if !c.unsent {
			continue
		}
		evt := event.NewSystem(event.SystemParams{
			Now:        m.now(),
			ReasonCode: c.reasonCode,
			TraceID:    uuid.NewString(),
		})
		if err := m.store.Enqueue(ctx, evt); err != nil {
			// Store.Enqueue's own error names only the event id, so the
			// condition is carried out separately for the structured log.
			return produced, &RecordError{ReasonCode: c.reasonCode, TraceID: evt.TraceID, Err: err}
		}
		c.unsent = false
		produced = append(produced, evt)
	}
	return produced, nil
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
