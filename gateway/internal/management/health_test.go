package management

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestClient_Ping_SuccessOnUp(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/actuator/health" {
			t.Errorf("path = %s, want /actuator/health", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"status":"UP"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	if err := client.Ping(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClient_Ping_FailsOnNon200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"status":"DOWN"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	if err := client.Ping(context.Background()); err == nil {
		t.Fatal("expected an error for a 503 response, got nil")
	}
}

func TestHealthTracker_NotReadyBeforeFirstPoll(t *testing.T) {
	tracker := NewHealthTracker(NewClient("http://127.0.0.1:0", "test-token"))
	if tracker.Ready() {
		t.Error("Ready() = true before any poll has run, want false")
	}
}

func TestHealthTracker_Run_BecomesReadyAfterSuccessfulPingAndNotReadyAfterFailure(t *testing.T) {
	var up atomic.Bool
	up.Store(true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if up.Load() {
			_, _ = w.Write([]byte(`{"status":"UP"}`))
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	tracker := NewHealthTracker(NewClient(server.URL, "test-token"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		tracker.Run(ctx, 20*time.Millisecond, time.Second)
		close(done)
	}()

	waitUntil(t, func() bool { return tracker.Ready() }, "tracker to become ready after the first successful poll")

	up.Store(false)
	waitUntil(t, func() bool { return !tracker.Ready() }, "tracker to become not-ready once polls start failing")

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Error("Run did not return after ctx was cancelled")
	}
}

func TestHealthTracker_Run_StopsPollingWhenContextCancelledBeforeFirstTick(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"status":"UP"}`))
	}))
	defer server.Close()

	tracker := NewHealthTracker(NewClient(server.URL, "test-token"))
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		// A long interval means the only poll that should ever happen is
		// Run's immediate one — cancelling right after must stop the loop
		// before any ticker-driven poll fires.
		tracker.Run(ctx, time.Hour, time.Second)
		close(done)
	}()

	waitUntil(t, func() bool { return calls.Load() >= 1 }, "the immediate poll to happen")
	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return promptly after ctx was cancelled")
	}
}

func waitUntil(t *testing.T, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for: %s", what)
}
