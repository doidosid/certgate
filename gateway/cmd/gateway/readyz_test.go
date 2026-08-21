package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tech.certgate/gateway/internal/management"
)

func TestReadyzHandler_ReturnsServiceUnavailableBeforeAnyPoll(t *testing.T) {
	tracker := management.NewHealthTracker(management.NewClient("http://127.0.0.1:0", "test-token"))
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()

	readyzHandler(tracker)(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "NOT_READY" {
		t.Errorf("status field = %q, want NOT_READY", body["status"])
	}
}

func TestReadyzHandler_ReturnsOkAfterManagementApiPollSucceeds(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"UP"}`))
	}))
	defer server.Close()

	tracker := management.NewHealthTracker(management.NewClient(server.URL, "test-token"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go tracker.Run(ctx, time.Hour, time.Second)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !tracker.Ready() {
		time.Sleep(5 * time.Millisecond)
	}

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	readyzHandler(tracker)(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestHealthzHandler_AlwaysOkRegardlessOfReadiness(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	healthzHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("healthz status = %d, want %d — liveness must not depend on Management API reachability", rec.Code, http.StatusOK)
	}
}
