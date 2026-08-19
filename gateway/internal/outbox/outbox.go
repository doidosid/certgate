// Package outbox durably queues Security Events in a local WAL-mode SQLite
// database before the Gateway attempts delivery to the Management API, so an
// Event created just before a crash or during a Management API outage is not
// lost (docs/security-design.md §9, docs/operations.md "Event Outbox").
package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"tech.certgate/gateway/internal/event"
)

const schema = `
CREATE TABLE IF NOT EXISTS outbox_event (
	event_id TEXT PRIMARY KEY,
	payload_json TEXT NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0,
	next_attempt_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
`

// Store is a WAL-mode SQLite-backed Durable Outbox for Security Events.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Open opens (creating if needed) the SQLite database at path in WAL mode
// and ensures its schema exists.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("outbox: open %s: %w", path, err)
	}
	if _, err := db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("outbox: create schema: %w", err)
	}
	return &Store{db: db, now: time.Now}, nil
}

// Close releases the underlying database handle.
func (s *Store) Close() error {
	return s.db.Close()
}

// Enqueue durably stores evt before any delivery attempt is made
// (docs/security-design.md §9: Event 생성과 Outbox 저장은 하나의 로컬 Transaction).
func (s *Store) Enqueue(ctx context.Context, evt event.Event) error {
	payload, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("outbox: encode event %s: %w", evt.ID, err)
	}
	now := s.now().Unix()
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO outbox_event (event_id, payload_json, attempts, next_attempt_at, created_at) VALUES (?, ?, 0, ?, ?)`,
		evt.ID, string(payload), now, now)
	if err != nil {
		return fmt.Errorf("outbox: enqueue event %s: %w", evt.ID, err)
	}
	return nil
}

// Delete removes eventID once the Management API has accepted it.
func (s *Store) Delete(ctx context.Context, eventID string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM outbox_event WHERE event_id = ?`, eventID); err != nil {
		return fmt.Errorf("outbox: delete event %s: %w", eventID, err)
	}
	return nil
}

// MarkFailed schedules eventID's next retry using capped exponential backoff
// (docs/operations.md "Event Outbox": "재시도: 지수 Backoff + 최대 간격").
func (s *Store) MarkFailed(ctx context.Context, eventID string, maxIntervalSeconds int) error {
	row := s.db.QueryRowContext(ctx, `SELECT attempts FROM outbox_event WHERE event_id = ?`, eventID)
	var attempts int
	if err := row.Scan(&attempts); err != nil {
		return fmt.Errorf("outbox: read attempts for event %s: %w", eventID, err)
	}
	attempts++

	backoffSeconds := 1 << min(attempts, 30)
	if maxIntervalSeconds > 0 && backoffSeconds > maxIntervalSeconds {
		backoffSeconds = maxIntervalSeconds
	}
	next := s.now().Add(time.Duration(backoffSeconds) * time.Second).Unix()

	_, err := s.db.ExecContext(ctx,
		`UPDATE outbox_event SET attempts = ?, next_attempt_at = ? WHERE event_id = ?`,
		attempts, next, eventID)
	if err != nil {
		return fmt.Errorf("outbox: mark failed for event %s: %w", eventID, err)
	}
	return nil
}

// Due returns up to limit events whose next retry time has passed, oldest
// first.
func (s *Store) Due(ctx context.Context, limit int) ([]event.Event, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT payload_json FROM outbox_event WHERE next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?`,
		s.now().Unix(), limit)
	if err != nil {
		return nil, fmt.Errorf("outbox: query due events: %w", err)
	}
	defer rows.Close()

	var events []event.Event
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("outbox: scan due event: %w", err)
		}
		var evt event.Event
		if err := json.Unmarshal([]byte(payload), &evt); err != nil {
			return nil, fmt.Errorf("outbox: decode due event: %w", err)
		}
		events = append(events, evt)
	}
	return events, rows.Err()
}

// Stats reports the number of pending events and the age in seconds of the
// oldest one, for the Dashboard Outbox indicator (docs/api-spec.md §9
// "outbox": pendingCount, oldestAgeSeconds) and for the Monitor's threshold
// checks. oldestAgeSeconds is 0 when the Outbox is empty.
//
// Both values come from a single statement so they always describe the same
// Outbox. Reading them with two queries lets a concurrent Sender delete land
// in between, which could report a non-empty Outbox whose oldest age is 0, or
// trip a backlog threshold that had already cleared (Codex 리뷰 PR #31 Medium).
func (s *Store) Stats(ctx context.Context) (pendingCount, oldestAgeSeconds int, err error) {
	var oldestCreatedAt sql.NullInt64
	row := s.db.QueryRowContext(ctx, `SELECT COUNT(*), MIN(created_at) FROM outbox_event`)
	if err := row.Scan(&pendingCount, &oldestCreatedAt); err != nil {
		return 0, 0, fmt.Errorf("outbox: read stats: %w", err)
	}
	if !oldestCreatedAt.Valid {
		return pendingCount, 0, nil
	}
	age := s.now().Unix() - oldestCreatedAt.Int64
	if age < 0 {
		age = 0
	}
	return pendingCount, int(age), nil
}
