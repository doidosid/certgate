package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"time"

	"github.com/google/uuid"

	"tech.certgate/gateway/internal/access"
	"tech.certgate/gateway/internal/event"
	"tech.certgate/gateway/internal/management"
	"tech.certgate/gateway/internal/outbox"
	"tech.certgate/gateway/internal/policy"
	"tech.certgate/gateway/internal/proxy"
	"tech.certgate/gateway/internal/tlsauth"
)

// accessHandler is the mTLS listener's handler. It extracts the Device
// identity from the verified Client Certificate, checks Access Context and
// Role policy, strips and re-injects identity headers, forwards allowed
// requests to the Backend, and records a Security Event for every decision
// (docs/security-design.md §5, §7).
type accessHandler struct {
	access *access.Cache
	store  *outbox.Store
	proxy  *httputil.ReverseProxy
	now    func() time.Time
}

func (h *accessHandler) clock() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

func (h *accessHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := h.clock()
	traceID := uuid.NewString()
	clientIP := clientIPFrom(r)

	proxy.StripIdentityHeaders(r.Header)

	// tls.Config.ClientAuth = RequireAndVerifyClientCert guarantees a
	// non-empty, chain-verified PeerCertificates by the time the handler
	// runs; a request that fails the handshake never reaches here
	// (docs/security-design.md §5). This guard is defensive only.
	if len(r.TLS.PeerCertificates) == 0 {
		http.Error(w, "client certificate required", http.StatusUnauthorized)
		return
	}
	cert := r.TLS.PeerCertificates[0]
	serialNumber := tlsauth.SerialNumber(cert)

	deviceKey, err := tlsauth.DeviceKey(cert)
	if err != nil {
		h.finish(w, r, start, traceID, clientIP, "", serialNumber, event.ReasonInvalidCertificate)
		return
	}

	accessCtx, err := h.access.Get(r.Context(), serialNumber)
	if err != nil {
		reasonCode := event.ReasonInternalError
		var apiErr management.APIError
		if errors.As(err, &apiErr) && apiErr.Code == "CERTIFICATE_NOT_FOUND" {
			reasonCode = event.ReasonDeviceNotRegistered
		} else {
			log.Printf("gateway: access context lookup failed, failing closed: %v (traceId=%s)", err, traceID)
		}
		h.finish(w, r, start, traceID, clientIP, deviceKey, serialNumber, reasonCode)
		return
	}

	reasonCode := decide(accessCtx, r.Method, r.URL.Path)
	if reasonCode != event.ReasonRequestAllowed {
		h.finishWithDevice(w, r, start, traceID, clientIP, deviceKey, serialNumber, accessCtx.DeviceID, reasonCode)
		return
	}

	proxy.SetTrustedHeaders(r.Header, deviceKey, accessCtx.RoleName)
	h.recordEvent(r.Context(), event.Params{
		Now:               start,
		DeviceID:          accessCtx.DeviceID,
		CertificateSerial: serialNumber,
		HTTPMethod:        r.Method,
		RequestPath:       r.URL.Path,
		ReasonCode:        event.ReasonRequestAllowed,
		ClientIP:          clientIP,
		LatencyMs:         int(h.clock().Sub(start).Milliseconds()),
		TraceID:           traceID,
	})
	logDecision(logLine{
		Time: start.UTC().Format(time.RFC3339), TraceID: traceID, DeviceKey: deviceKey,
		Method: r.Method, Path: r.URL.Path, Decision: event.DecisionAllowed,
		ReasonCode: event.ReasonRequestAllowed, ClientIP: clientIP,
		LatencyMs: h.clock().Sub(start).Milliseconds(),
	})
	h.proxy.ServeHTTP(w, r)
}

// decide maps Access Context state and the requested method/path to a
// Reason Code (docs/security-design.md §5 "Gateway mTLS 인증", §7 "접근 정책").
func decide(ctx management.AccessContext, method, path string) string {
	if ctx.DeviceStatus != "ACTIVE" {
		return event.ReasonDeviceDisabled
	}
	switch ctx.CertificateStatus {
	case "REVOKED":
		return event.ReasonCertificateRevoked
	case "EXPIRED":
		return event.ReasonCertificateExpired
	}
	if !policy.Evaluate(ctx.Rules, method, path) {
		return event.ReasonAccessDenied
	}
	return event.ReasonRequestAllowed
}

// finish denies a request for which no deviceId is known yet (identity
// extraction failed or Access Context could not be determined).
func (h *accessHandler) finish(w http.ResponseWriter, r *http.Request, start time.Time, traceID, clientIP, deviceKey, serialNumber, reasonCode string) {
	h.finishWithDevice(w, r, start, traceID, clientIP, deviceKey, serialNumber, "", reasonCode)
}

func (h *accessHandler) finishWithDevice(w http.ResponseWriter, r *http.Request, start time.Time, traceID, clientIP, deviceKey, serialNumber, deviceID, reasonCode string) {
	h.recordEvent(r.Context(), event.Params{
		Now:               start,
		DeviceID:          deviceID,
		CertificateSerial: serialNumber,
		HTTPMethod:        r.Method,
		RequestPath:       r.URL.Path,
		ReasonCode:        reasonCode,
		ClientIP:          clientIP,
		LatencyMs:         int(h.clock().Sub(start).Milliseconds()),
		TraceID:           traceID,
	})

	decision := event.DecisionDenied
	status := http.StatusForbidden
	if reasonCode == event.ReasonInternalError {
		decision = event.DecisionError
		status = http.StatusServiceUnavailable
	}

	logDecision(logLine{
		Time: start.UTC().Format(time.RFC3339), TraceID: traceID, DeviceKey: deviceKey,
		Method: r.Method, Path: r.URL.Path, Decision: decision,
		ReasonCode: reasonCode, ClientIP: clientIP,
		LatencyMs: h.clock().Sub(start).Milliseconds(),
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": reasonCode, "traceId": traceID})
}

// recordEvent durably enqueues a Security Event for delivery. A failure here
// is logged but never changes the access decision already made — losing an
// Event must not become a way to block legitimate traffic.
func (h *accessHandler) recordEvent(ctx context.Context, p event.Params) {
	evt := event.New(p)
	if err := h.store.Enqueue(ctx, evt); err != nil {
		log.Printf("gateway: enqueue security event failed: %v (reasonCode=%s traceId=%s)", err, p.ReasonCode, p.TraceID)
	}
}

func clientIPFrom(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type logLine struct {
	Time       string `json:"time"`
	TraceID    string `json:"traceId"`
	DeviceKey  string `json:"deviceKey,omitempty"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Decision   string `json:"decision"`
	ReasonCode string `json:"reasonCode"`
	ClientIP   string `json:"clientIp,omitempty"`
	LatencyMs  int64  `json:"latencyMs"`
}

func logDecision(l logLine) {
	b, err := json.Marshal(l)
	if err != nil {
		log.Printf("gateway: log encode error: %v", err)
		return
	}
	log.Println(string(b))
}

func cacheInvalidationHandler(internalToken string, cache *access.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !validBearer(r.Header.Get("Authorization"), internalToken) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "SERVICE_TOKEN_INVALID"})
			return
		}

		var body struct {
			Type string `json:"type"`
			Key  string `json:"key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Type == "" || body.Key == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if body.Type != "CERTIFICATE" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		cache.Invalidate(body.Key)
		w.WriteHeader(http.StatusNoContent)
	}
}

func validBearer(header, token string) bool {
	if token == "" || header == "" {
		return false
	}
	expected := "Bearer " + token
	if len(header) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(header), []byte(expected)) == 1
}
