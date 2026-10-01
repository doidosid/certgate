// Package client sends mTLS Heartbeat, Telemetry, and Command requests to
// the Gateway using the Device's issued certificate.
package client

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultTimeout = 10 * time.Second

// Client sends authenticated requests to the Gateway over mTLS, using the
// Device's issued certificate and verifying the Gateway's server certificate
// against the Device's CA chain. It never skips certificate verification.
type Client struct {
	baseURL    string
	httpClient *http.Client
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
	}, nil
}

// Heartbeat sends one mTLS POST /heartbeat to the Gateway. It reports
// non-2xx responses as an error carrying only the status code, never the
// response body.
func (c *Client) Heartbeat(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/heartbeat", nil)
	if err != nil {
		return fmt.Errorf("client: build heartbeat request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("client: heartbeat request: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("client: heartbeat: unexpected status %d", resp.StatusCode)
	}
	return nil
}

// Run calls Heartbeat immediately, then again on every tick of interval,
// until ctx is done. onResult (may be nil) receives the outcome of every
// attempt, nil error on success; Run itself makes no logging decisions.
func (c *Client) Run(ctx context.Context, interval time.Duration, onResult func(error)) {
	attempt := func() {
		err := c.Heartbeat(ctx)
		if onResult != nil {
			onResult(err)
		}
	}

	attempt()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			attempt()
		}
	}
}
