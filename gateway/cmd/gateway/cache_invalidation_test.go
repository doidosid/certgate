package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tech.certgate/gateway/internal/access"
	"tech.certgate/gateway/internal/management"
)

type fakeAccessFetcher struct {
	calls int
}

func (f *fakeAccessFetcher) GetAccessContext(ctx context.Context, serialNumber string) (management.AccessContext, error) {
	f.calls++
	return management.AccessContext{SerialNumber: serialNumber, DeviceStatus: "ACTIVE", CertificateStatus: "VALID"}, nil
}

func TestCacheInvalidationHandler_RejectsWrongToken(t *testing.T) {
	fetcher := &fakeAccessFetcher{}
	cache := access.New(fetcher, 30*time.Second, nil)
	handler := cacheInvalidationHandler("correct-token", cache)

	req := httptest.NewRequest(http.MethodPost, "/internal/cache/invalidations", strings.NewReader(`{"type":"CERTIFICATE","key":"7F28A109"}`))
	req.Header.Set("Authorization", "Bearer wrong-token")
	rec := httptest.NewRecorder()

	handler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestCacheInvalidationHandler_RejectsMissingToken(t *testing.T) {
	fetcher := &fakeAccessFetcher{}
	cache := access.New(fetcher, 30*time.Second, nil)
	handler := cacheInvalidationHandler("correct-token", cache)

	req := httptest.NewRequest(http.MethodPost, "/internal/cache/invalidations", strings.NewReader(`{"type":"CERTIFICATE","key":"7F28A109"}`))
	rec := httptest.NewRecorder()

	handler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestCacheInvalidationHandler_RejectsNonPost(t *testing.T) {
	fetcher := &fakeAccessFetcher{}
	cache := access.New(fetcher, 30*time.Second, nil)
	handler := cacheInvalidationHandler("correct-token", cache)

	req := httptest.NewRequest(http.MethodGet, "/internal/cache/invalidations", nil)
	req.Header.Set("Authorization", "Bearer correct-token")
	rec := httptest.NewRecorder()

	handler(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
}

func TestCacheInvalidationHandler_RejectsUnknownType(t *testing.T) {
	fetcher := &fakeAccessFetcher{}
	cache := access.New(fetcher, 30*time.Second, nil)
	handler := cacheInvalidationHandler("correct-token", cache)

	req := httptest.NewRequest(http.MethodPost, "/internal/cache/invalidations", strings.NewReader(`{"type":"DEVICE","key":"device-1"}`))
	req.Header.Set("Authorization", "Bearer correct-token")
	rec := httptest.NewRecorder()

	handler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

// docs/api-spec.md §8: invalidation must force the next Access Context Get to
// re-fetch live rather than serve the cached (now-stale) entry.
func TestCacheInvalidationHandler_InvalidatesCachedEntry(t *testing.T) {
	fetcher := &fakeAccessFetcher{}
	cache := access.New(fetcher, 30*time.Second, nil)
	handler := cacheInvalidationHandler("correct-token", cache)

	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error priming cache: %v", err)
	}
	if fetcher.calls != 1 {
		t.Fatalf("calls = %d, want 1", fetcher.calls)
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/cache/invalidations", strings.NewReader(`{"type":"CERTIFICATE","key":"7F28A109"}`))
	req.Header.Set("Authorization", "Bearer correct-token")
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}

	if _, err := cache.Get(context.Background(), "7F28A109"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fetcher.calls != 2 {
		t.Errorf("calls = %d, want 2 (invalidation must force a live refetch)", fetcher.calls)
	}
}

func TestValidBearer(t *testing.T) {
	cases := []struct {
		name   string
		header string
		token  string
		want   bool
	}{
		{"correct", "Bearer secret", "secret", true},
		{"wrong token", "Bearer wrong", "secret", false},
		{"empty header", "", "secret", false},
		{"empty configured token", "Bearer secret", "", false},
		{"missing bearer prefix", "secret", "secret", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validBearer(tc.header, tc.token); got != tc.want {
				t.Errorf("validBearer(%q, %q) = %v, want %v", tc.header, tc.token, got, tc.want)
			}
		})
	}
}
