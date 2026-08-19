package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"tech.certgate/gateway/internal/event"
	"tech.certgate/gateway/internal/outbox"
)

func newStatsTestStore(t *testing.T) *outbox.Store {
	t.Helper()
	store, err := outbox.Open(filepath.Join(t.TempDir(), "outbox.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func getStats(t *testing.T, handler http.HandlerFunc, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/internal/outbox/stats", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

// docs/api-spec.md §9: the Dashboard's "outbox" object is
// {"pendingCount":..,"oldestAgeSeconds":..}.
func TestOutboxStatsHandler_ReportsPendingCountAndOldestAge(t *testing.T) {
	store := newStatsTestStore(t)
	for i := 0; i < 3; i++ {
		evt := event.New(event.Params{Now: time.Now(), ReasonCode: event.ReasonRequestAllowed, TraceID: "t"})
		if err := store.Enqueue(context.Background(), evt); err != nil {
			t.Fatalf("Enqueue: %v", err)
		}
	}
	handler := outboxStatsHandler("correct-token", store)

	rec := getStats(t, handler, "correct-token")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body map[string]int
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["pendingCount"] != 3 {
		t.Errorf("pendingCount = %d, want 3", body["pendingCount"])
	}
	if _, ok := body["oldestAgeSeconds"]; !ok {
		t.Errorf("body = %v, want an oldestAgeSeconds field", body)
	}
}

func TestOutboxStatsHandler_EmptyOutbox_ReportsZeroes(t *testing.T) {
	handler := outboxStatsHandler("correct-token", newStatsTestStore(t))

	rec := getStats(t, handler, "correct-token")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body map[string]int
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["pendingCount"] != 0 || body["oldestAgeSeconds"] != 0 {
		t.Errorf("body = %v, want both zero for an empty Outbox", body)
	}
}

// docs/api-spec.md §8: the internal listener is guarded by the internal
// Service Token, so Outbox depth is not readable without it.
func TestOutboxStatsHandler_RejectsWrongToken(t *testing.T) {
	handler := outboxStatsHandler("correct-token", newStatsTestStore(t))

	rec := getStats(t, handler, "wrong-token")

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestOutboxStatsHandler_RejectsMissingToken(t *testing.T) {
	handler := outboxStatsHandler("correct-token", newStatsTestStore(t))

	rec := getStats(t, handler, "")

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestOutboxStatsHandler_RejectsNonGet(t *testing.T) {
	handler := outboxStatsHandler("correct-token", newStatsTestStore(t))

	req := httptest.NewRequest(http.MethodPost, "/internal/outbox/stats", nil)
	req.Header.Set("Authorization", "Bearer correct-token")
	rec := httptest.NewRecorder()

	handler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestOutboxStatsHandler_ClosedStore_ReturnsInternalError(t *testing.T) {
	store, err := outbox.Open(filepath.Join(t.TempDir(), "outbox.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	handler := outboxStatsHandler("correct-token", store)

	rec := getStats(t, handler, "correct-token")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["code"] != event.ReasonInternalError {
		t.Errorf("code = %q, want %q", body["code"], event.ReasonInternalError)
	}
}
