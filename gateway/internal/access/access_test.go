package access

import (
	"context"
	"errors"
	"testing"
	"time"

	"tech.certgate/gateway/internal/management"
)

type fakeFetcher struct {
	calls    int
	response management.AccessContext
	err      error
}

func (f *fakeFetcher) GetAccessContext(ctx context.Context, serialNumber string) (management.AccessContext, error) {
	f.calls++
	return f.response, f.err
}

func TestCache_MissFetchesLive(t *testing.T) {
	fetcher := &fakeFetcher{response: management.AccessContext{DeviceKey: "sensor-floor-01"}}
	cache := New(fetcher, 30*time.Second, nil)

	got, err := cache.Get(context.Background(), "7F28A109")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.DeviceKey != "sensor-floor-01" {
		t.Errorf("DeviceKey = %s, want sensor-floor-01", got.DeviceKey)
	}
	if fetcher.calls != 1 {
		t.Errorf("calls = %d, want 1", fetcher.calls)
	}
}

func TestCache_HitWithinTTLDoesNotRefetch(t *testing.T) {
	fetcher := &fakeFetcher{response: management.AccessContext{DeviceKey: "sensor-floor-01"}}
	now := time.Now()
	clock := func() time.Time { return now }
	cache := New(fetcher, 30*time.Second, clock)

	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	now = now.Add(10 * time.Second)
	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fetcher.calls != 1 {
		t.Errorf("calls = %d, want 1 (second Get should hit cache)", fetcher.calls)
	}
}

// The 30s TTL bounds how long a revoked Certificate's stale ALLOW can keep
// working (docs/security-design.md §6), so an expired entry must always
// re-fetch — never serve stale data past TTL.
func TestCache_ExpiredEntryRefetchesLive(t *testing.T) {
	fetcher := &fakeFetcher{response: management.AccessContext{DeviceKey: "sensor-floor-01"}}
	now := time.Now()
	clock := func() time.Time { return now }
	cache := New(fetcher, 30*time.Second, clock)

	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	now = now.Add(31 * time.Second)
	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fetcher.calls != 2 {
		t.Errorf("calls = %d, want 2 (expired entry must refetch)", fetcher.calls)
	}
}

// Fail Closed (docs/security-design.md §5): a live-call failure past TTL
// must propagate as an error, never silently serve stale cached data.
func TestCache_ExpiredEntryLiveFailureFailsClosed(t *testing.T) {
	fetcher := &fakeFetcher{response: management.AccessContext{DeviceKey: "sensor-floor-01"}}
	now := time.Now()
	clock := func() time.Time { return now }
	cache := New(fetcher, 30*time.Second, clock)

	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	now = now.Add(31 * time.Second)
	fetcher.err = errors.New("management api unreachable")
	_, err := cache.Get(context.Background(), "7F28A109")
	if err == nil {
		t.Fatal("expected an error when the live call fails after TTL expiry, not a stale cache hit")
	}
}

func TestCache_UnreachableWithNoPriorCacheFailsClosed(t *testing.T) {
	fetcher := &fakeFetcher{err: errors.New("management api unreachable")}
	cache := New(fetcher, 30*time.Second, nil)

	_, err := cache.Get(context.Background(), "7F28A109")
	if err == nil {
		t.Fatal("expected an error when there is no cache and the live call fails")
	}
}

func TestCache_InvalidateForcesRefetch(t *testing.T) {
	fetcher := &fakeFetcher{response: management.AccessContext{DeviceKey: "sensor-floor-01"}}
	cache := New(fetcher, 30*time.Second, nil)

	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	cache.Invalidate("7F28A109")
	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fetcher.calls != 2 {
		t.Errorf("calls = %d, want 2 (invalidate must force a live refetch)", fetcher.calls)
	}
}
