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

// forwardAndCapture sends req through NewReverseProxy and returns the headers
// the Backend received.
func forwardAndCapture(t *testing.T, req *http.Request) http.Header {
	t.Helper()
	var seen http.Header
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatalf("parse backend URL: %v", err)
	}

	rec := httptest.NewRecorder()
	NewReverseProxy(backendURL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	return seen
}

// A Device can name any header in Connection, and the proxy drops every
// header Connection names as hop-by-hop (RFC 9110 §7.6.1). The Gateway-set
// identity headers must still reach the Backend, or a Device could make its
// own authenticated request arrive without the identity the Gateway verified.
func TestNewReverseProxy_ConnectionHeaderCannotDropTrustedHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/telemetry", nil)
	req.Header.Set("Connection", HeaderDeviceKey+", "+HeaderRole)
	SetTrustedHeaders(req.Header, "sensor-floor-01", "SENSOR")

	seen := forwardAndCapture(t, req)

	if got := seen.Get(HeaderDeviceKey); got != "sensor-floor-01" {
		t.Errorf("backend saw device key %q, want sensor-floor-01", got)
	}
	if got := seen.Get(HeaderRole); got != "SENSOR" {
		t.Errorf("backend saw role %q, want SENSOR", got)
	}
}

// X-Forwarded-For is set from the connection the Gateway accepted, not
// appended to whatever the Device claimed.
func TestNewReverseProxy_IgnoresDeviceSuppliedForwardingHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/telemetry", nil)
	req.RemoteAddr = "10.0.0.7:51234"
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	req.Header.Set("Forwarded", "for=203.0.113.9")

	seen := forwardAndCapture(t, req)

	if got := seen.Get("X-Forwarded-For"); got != "10.0.0.7" {
		t.Errorf("backend saw X-Forwarded-For %q, want 10.0.0.7", got)
	}
	if got := seen.Get("Forwarded"); got != "" {
		t.Errorf("backend saw Forwarded %q, want none", got)
	}
}

// The inbound Host is kept, as NewSingleHostReverseProxy did before.
func TestNewReverseProxy_KeepsInboundHost(t *testing.T) {
	var host string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host = r.Host
	}))
	defer backend.Close()
	backendURL, _ := url.Parse(backend.URL)

	req := httptest.NewRequest(http.MethodPost, "https://gateway.certgate.local/telemetry", nil)
	NewReverseProxy(backendURL).ServeHTTP(httptest.NewRecorder(), req)

	if host != "gateway.certgate.local" {
		t.Errorf("backend saw Host %q, want gateway.certgate.local", host)
	}
}
