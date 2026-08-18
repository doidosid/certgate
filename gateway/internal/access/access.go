// Package access retrieves Access Context from the Management API and
// caches it with a bounded TTL (docs/security-design.md §5,
// docs/api-spec.md §7 "Access Context").
package access

import (
	"context"
	"fmt"
	"sync"
	"time"

	"tech.certgate/gateway/internal/management"
)

// Fetcher is the subset of management.Client that Cache depends on, so tests
// can supply a fake without a real HTTP server.
type Fetcher interface {
	GetAccessContext(ctx context.Context, serialNumber string) (management.AccessContext, error)
}

type entry struct {
	context   management.AccessContext
	expiresAt time.Time
}

// Cache fronts Fetcher with a TTL cache keyed by Certificate serial number.
// A cache hit within TTL is served without calling the Management API; a
// miss or an expired entry always re-fetches live and never falls back to
// stale data — serving stale data past TTL would defeat the 30s
// revocation-propagation guarantee (docs/security-design.md §6).
type Cache struct {
	fetcher Fetcher
	ttl     time.Duration
	now     func() time.Time

	mu      sync.Mutex
	entries map[string]entry
}

// New builds a Cache with the given TTL. now defaults to time.Now if nil, so
// tests can inject a fake clock to make expiry deterministic.
func New(fetcher Fetcher, ttl time.Duration, now func() time.Time) *Cache {
	if now == nil {
		now = time.Now
	}
	return &Cache{
		fetcher: fetcher,
		ttl:     ttl,
		now:     now,
		entries: make(map[string]entry),
	}
}

// Get returns the Access Context for serialNumber, from cache if a valid
// entry exists, otherwise via a live Management API call. A live-call
// failure is returned as-is with no stale fallback: the caller must fail
// closed (docs/security-design.md §5).
func (c *Cache) Get(ctx context.Context, serialNumber string) (management.AccessContext, error) {
	c.mu.Lock()
	e, ok := c.entries[serialNumber]
	c.mu.Unlock()
	if ok && c.now().Before(e.expiresAt) {
		return e.context, nil
	}

	fetched, err := c.fetcher.GetAccessContext(ctx, serialNumber)
	if err != nil {
		return management.AccessContext{}, fmt.Errorf("access: fetch access context for serial %s: %w", serialNumber, err)
	}

	c.mu.Lock()
	c.entries[serialNumber] = entry{context: fetched, expiresAt: c.now().Add(c.ttl)}
	c.mu.Unlock()
	return fetched, nil
}

// Invalidate drops any cached entry for serialNumber so the next Get
// re-fetches immediately (docs/api-spec.md §8 "Gateway 내부 Cache API").
func (c *Cache) Invalidate(serialNumber string) {
	c.mu.Lock()
	delete(c.entries, serialNumber)
	c.mu.Unlock()
}
