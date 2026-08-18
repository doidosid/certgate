package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"
)

func TestStripIdentityHeaders_RemovesExternalHeaders(t *testing.T) {
	header := http.Header{}
	header.Set(HeaderDeviceKey, "attacker-supplied")
	header.Set(HeaderRole, "OPERATOR")

	StripIdentityHeaders(header)

	if header.Get(HeaderDeviceKey) != "" {
		t.Error("expected externally supplied device key header to be removed")
	}
	if header.Get(HeaderRole) != "" {
		t.Error("expected externally supplied role header to be removed")
	}
}

func TestSetTrustedHeaders_OverwritesAnyExisting(t *testing.T) {
	header := http.Header{}
	header.Set(HeaderDeviceKey, "attacker-supplied")

	SetTrustedHeaders(header, "sensor-floor-01", "SENSOR")

	if got := header.Get(HeaderDeviceKey); got != "sensor-floor-01" {
		t.Errorf("HeaderDeviceKey = %q, want sensor-floor-01", got)
	}
	if got := header.Get(HeaderRole); got != "SENSOR" {
		t.Errorf("HeaderRole = %q, want SENSOR", got)
	}
}

func TestStripThenSetHeaders_DeviceCannotSpoofIdentity(t *testing.T) {
	header := http.Header{}
	header.Set(HeaderDeviceKey, "attacker-supplied")
	header.Set(HeaderRole, "OPERATOR")

	StripIdentityHeaders(header)
	SetTrustedHeaders(header, "sensor-floor-01", "SENSOR")

	if got := header.Get(HeaderDeviceKey); got != "sensor-floor-01" {
		t.Errorf("HeaderDeviceKey = %q, want sensor-floor-01 (Gateway-verified identity must win)", got)
	}
	if got := header.Get(HeaderRole); got != "SENSOR" {
		t.Errorf("HeaderRole = %q, want SENSOR", got)
	}
}

func TestNewReverseProxy_ForwardsToBackend(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Backend-Saw-Device-Key", r.Header.Get(HeaderDeviceKey))
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatalf("parse backend URL: %v", err)
	}

	var rp *httputil.ReverseProxy = NewReverseProxy(backendURL)

	req := httptest.NewRequest(http.MethodPost, "/telemetry", nil)
	req.Header.Set(HeaderDeviceKey, "sensor-floor-01")
	rec := httptest.NewRecorder()

	rp.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("X-Backend-Saw-Device-Key"); got != "sensor-floor-01" {
		t.Errorf("backend saw device key %q, want sensor-floor-01", got)
	}
}
