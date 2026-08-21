package management

import (
	"context"
	"sync"
	"time"
)

// HealthTracker periodically pings the Management API and remembers the
// outcome, so the Gateway's Readiness Endpoint (Issue #36,
// docs/operations.md "Health") doesn't need to make a blocking network call
// on every health-check request.
type HealthTracker struct {
	client *Client

	mu    sync.RWMutex
	ready bool
}

// NewHealthTracker builds a HealthTracker that is not ready until its first
// poll completes — Run's first check happens immediately, before returning
// a stale "ready" for a Process that just started.
func NewHealthTracker(client *Client) *HealthTracker {
	return &HealthTracker{client: client}
}

// Run polls the Management API every interval until ctx is done.
func (h *HealthTracker) Run(ctx context.Context, interval, pingTimeout time.Duration) {
	h.check(ctx, pingTimeout)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.check(ctx, pingTimeout)
		}
	}
}

func (h *HealthTracker) check(ctx context.Context, timeout time.Duration) {
	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	err := h.client.Ping(pingCtx)

	h.mu.Lock()
	h.ready = err == nil
	h.mu.Unlock()
}

// Ready reports whether the most recent poll succeeded. False before the
// first poll completes.
func (h *HealthTracker) Ready() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.ready
}
