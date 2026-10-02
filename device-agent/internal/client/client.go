// Package client sends mTLS Heartbeat, Telemetry, and Command requests to
// the Gateway using the Device's issued certificate.
package client

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultTimeout = 10 * time.Second
	// maxBackoffInterval caps how long Run waits between retries during a
	// sustained Gateway/network outage. Not configurable via environment —
	// a single sane constant is enough at this project's scale; add
	// HEARTBEAT_MAX_BACKOFF_INTERVAL later if that changes.
	maxBackoffInterval = 5 * time.Minute
)

// Client sends authenticated requests to the Gateway over mTLS, using the
// Device's issued certificate and verifying the Gateway's server certificate
// against the Device's CA chain. It never skips certificate verification.
type Client struct {
	baseURL    string
	httpClient *http.Client
	// notAfter is this Device's own leaf certificate expiry, checked locally
	// before every Heartbeat attempt. A certificate that is already expired
	// fails the Gateway's TLS handshake before any HTTP response is ever
	// produced (docs/security-design.md §5: chain/signature/validity are
	// verified at handshake), so waiting for a parseable 403 response would
	// never actually detect this case in practice — the local check does.
	notAfter time.Time
}

// NewClient builds a Client that authenticates to the Gateway at baseURL
// using the Device certificate at certPath/keyPath and verifies the
// Gateway's server certificate against the CA chain at caChainPath. Any
// failure to load this material is returned as an error rather than
// silently falling back to an unverified connection (Fail Closed).
func NewClient(baseURL, certPath, keyPath, caChainPath string) (*Client, error) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("client: read device certificate: %w", err)
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("client: read device key: %w", err)
	}
	caChainPEM, err := os.ReadFile(caChainPath)
	if err != nil {
		return nil, fmt.Errorf("client: read ca chain: %w", err)
	}

	leafBlock, _ := pem.Decode(certPEM)
	if leafBlock == nil {
		return nil, fmt.Errorf("client: no PEM block found in device certificate %s", certPath)
	}
	leaf, err := x509.ParseCertificate(leafBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("client: parse device certificate: %w", err)
	}

	// The Gateway's Client CA Pool only trusts the Root CA directly
	// (docs/security-design.md §5), while a Device's own certificate is
	// issued by the Intermediate CA. The client certificate therefore must
	// carry the Intermediate CA certificate alongside the Device leaf so the
	// Gateway can build a path to a CA it trusts — otherwise Go's TLS stack
	// finds no configured certificate whose chain satisfies the server's
	// requested CAs and silently sends none, failing the handshake.
	fullChainPEM := make([]byte, 0, len(certPEM)+len(caChainPEM))
	fullChainPEM = append(fullChainPEM, certPEM...)
	fullChainPEM = append(fullChainPEM, caChainPEM...)
	cert, err := tls.X509KeyPair(fullChainPEM, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("client: load device certificate: %w", err)
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caChainPEM) {
		return nil, fmt.Errorf("client: no usable certificates found in ca chain %s", caChainPath)
	}

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion:   tls.VersionTLS13,
			Certificates: []tls.Certificate{cert},
			RootCAs:      pool,
		},
	}

	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{Timeout: defaultTimeout, Transport: transport},
		notAfter:   leaf.NotAfter,
	}, nil
}

// reasonCodeBody is the Gateway's error response shape for a rejected
// request — just {"code": "...", "traceId": "..."}, distinct from the
// Management API's richer {code, message, traceId, fieldErrors}.
type reasonCodeBody struct {
	Code string `json:"code"`
}

// Heartbeat sends one mTLS POST /heartbeat to the Gateway. A non-nil error
// is always a *HeartbeatError classifying the failure; the raw response
// body is never captured or logged, only a reasonCode when the Gateway
// supplied one.
func (c *Client) Heartbeat(ctx context.Context) error {
	if !time.Now().Before(c.notAfter) {
		return &HeartbeatError{
			Kind:       FailureReenrollRequired,
			ReasonCode: "CERTIFICATE_EXPIRED",
			cause:      errors.New("local certificate has expired"),
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/heartbeat", nil)
	if err != nil {
		return fmt.Errorf("client: build heartbeat request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return &HeartbeatError{Kind: FailureTemporary, cause: fmt.Errorf("client: heartbeat request: %w", err)}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		var body reasonCodeBody
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body)
		_, _ = io.Copy(io.Discard, resp.Body)

		// The Gateway's own 401/403 responses always carry one of the
		// documented reasonCodes (docs/api-spec.md §10) — an empty or
		// unrecognized code means this response didn't actually come from
		// the Gateway's own auth decision (a reverse proxy, a transient
		// decode failure), so it's treated as temporary rather than
		// assumed to be a real, diagnosed auth failure.
		kind := FailureTemporary
		switch {
		case reenrollReasonCodes[body.Code]:
			kind = FailureReenrollRequired
		case knownAuthReasonCodes[body.Code]:
			kind = FailurePermanent
		}
		return &HeartbeatError{
			Kind:       kind,
			Status:     resp.StatusCode,
			ReasonCode: body.Code,
			cause:      fmt.Errorf("unexpected status %d", resp.StatusCode),
		}
	}

	// 5xx and any other unrecognized status: temporary by default (never
	// stop heartbeating on an ambiguous signal).
	_, _ = io.Copy(io.Discard, resp.Body)
	return &HeartbeatError{
		Kind:   FailureTemporary,
		Status: resp.StatusCode,
		cause:  fmt.Errorf("unexpected status %d", resp.StatusCode),
	}
}

// Run calls Heartbeat immediately, then again on every tick of interval,
// until ctx is done. onTransition (may be nil) is called only when the
// Device's State actually changes, or when a retrying failure's message
// changes — never on every single attempt — so a long steady-state run (all
// successes, or a sustained outage) logs once per transition, not once per
// interval. On FailurePermanent or FailureReenrollRequired, Run reports the
// corresponding terminal State and returns; it does not resume on its own.
//
// Failures classified FailureTemporary (including an unclassified error)
// are retried with exponential backoff starting at interval (or
// maxBackoffInterval, whichever is smaller — a HEARTBEAT_INTERVAL configured
// larger than the cap never waits longer than the cap even on the first
// retry), doubling on each consecutive failure, capped at maxBackoffInterval.
// A success resets the backoff to interval immediately.
func (c *Client) Run(ctx context.Context, interval time.Duration, onTransition func(State, error)) {
	report := func(state State, err error) {
		if onTransition != nil {
			onTransition(state, err)
		}
	}

	var backoff time.Duration
	var lastErrMsg string
	var lastState State

	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			report(StateStopping, nil)
			return
		case <-timer.C:
		}

		err := c.Heartbeat(ctx)
		if err == nil {
			backoff = 0
			lastErrMsg = ""
			if lastState != StateRunning {
				report(StateRunning, nil)
				lastState = StateRunning
			}
			timer.Reset(interval)
			continue
		}

		if ctx.Err() != nil {
			report(StateStopping, nil)
			return
		}

		var hbErr *HeartbeatError
		if errors.As(err, &hbErr) && hbErr.Kind != FailureTemporary {
			state := StateAuthFailed
			if hbErr.Kind == FailureReenrollRequired {
				state = StateReenrollRequired
			}
			report(state, err)
			return
		}

		if err.Error() != lastErrMsg {
			report(StateRetrying, err)
			lastErrMsg = err.Error()
		}
		lastState = StateRetrying

		backoff = nextBackoff(backoff, interval, maxBackoffInterval)
		timer.Reset(backoff)
	}
}

// nextBackoff computes the next retry delay given the current backoff (0
// before the first retry), the configured interval, and the cap. The first
// retry waits interval, or max if interval itself exceeds the cap — a
// HEARTBEAT_INTERVAL configured larger than max must never produce a wait
// longer than max, even on the very first retry (codexReview/PR-69.md
// Medium finding). Every subsequent retry doubles, also capped at max.
func nextBackoff(current, interval, max time.Duration) time.Duration {
	var next time.Duration
	switch {
	case current <= 0:
		next = interval
	case current < max:
		next = current * 2
	default:
		return current
	}
	if next > max {
		next = max
	}
	return next
}
