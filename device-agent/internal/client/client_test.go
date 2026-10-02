package client

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// testCA models one level of CertGate's two-tier PKI (Root CA signs an
// Intermediate CA, which issues Device and Gateway leaf certificates —
// docs/security-design.md §3/§5). Fixtures below build Root -> Intermediate
// -> leaf, the same shape as a real CertGate deployment, because the
// Gateway's Client CA Pool only ever trusts the Root CA directly: a Device's
// own certificate must be presented together with the Intermediate CA
// certificate for the handshake to succeed.
type testCA struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
}

func newRootCA(t *testing.T) *testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate root CA key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test Root CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create root CA certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse root CA certificate: %v", err)
	}
	return &testCA{cert: cert, key: key}
}

func (parent *testCA) issueIntermediateCA(t *testing.T, serial int64) *testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate intermediate CA key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(serial),
		Subject:               pkix.Name{CommonName: "Test Intermediate CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(5 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, parent.cert, &key.PublicKey, parent.key)
	if err != nil {
		t.Fatalf("create intermediate CA certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse intermediate CA certificate: %v", err)
	}
	return &testCA{cert: cert, key: key}
}

// issueLeaf signs a leaf certificate with this CA's key, expiring at
// notAfter, returning its DER bytes and private key (not yet PEM-encoded,
// so callers decide which chain segments to write to which file).
func (ca *testCA) issueLeaf(t *testing.T, serial int64, extKeyUsage []x509.ExtKeyUsage, notAfter time.Time) ([]byte, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: "test-leaf"},
		NotBefore:    time.Now().Add(-2 * time.Hour),
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  extKeyUsage,
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatalf("create leaf certificate: %v", err)
	}
	return der, key
}

func certBlockPEM(der []byte) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func keyBlockPEM(t *testing.T, key *ecdsa.PrivateKey) []byte {
	t.Helper()
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der})
}

func writeFile(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

// mtlsFixture is a running mTLS test server plus the Device-side material a
// Client needs to connect to it, laid out exactly as device-agent writes it
// to DEVICE_RUNTIME_DIR: device.crt holds only the Device's own leaf, and
// ca-chain.crt holds the Intermediate + Root CA certificates.
type mtlsFixture struct {
	server            *httptest.Server
	certPath, keyPath string
	caChainPath       string
}

// newMTLSFixtureWithDeviceNotAfter is newMTLSFixture but lets the caller
// control the Device leaf's own expiry, for testing Client's locally
// detected certificate expiry.
func newMTLSFixtureWithDeviceNotAfter(t *testing.T, handler http.HandlerFunc, deviceNotAfter time.Time) *mtlsFixture {
	t.Helper()
	dir := t.TempDir()

	root := newRootCA(t)
	intermediate := root.issueIntermediateCA(t, 2)

	serverLeafDER, serverKey := intermediate.issueLeaf(t, 10, []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, time.Now().Add(30*24*time.Hour))
	deviceLeafDER, deviceKey := intermediate.issueLeaf(t, 20, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, deviceNotAfter)

	// The Gateway's own server certificate chain carries its Intermediate
	// issuer too (Issue #42), which is what lets the Device's RootCAs pool
	// (built from ca-chain.crt, i.e. Intermediate+Root) verify it.
	serverCert := tls.Certificate{
		Certificate: [][]byte{serverLeafDER, intermediate.cert.Raw},
		PrivateKey:  serverKey,
	}

	// Only the Root CA is a trusted Client CA, mirroring the Gateway's real
	// Client CA Pool (docs/security-design.md §5: "Client CA Pool에는
	// root-ca.crt만 있다").
	clientCAPool := x509.NewCertPool()
	clientCAPool.AddCert(root.cert)

	server := httptest.NewUnstartedServer(handler)
	server.TLS = &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    clientCAPool,
	}
	server.StartTLS()
	t.Cleanup(server.Close)

	caChainPEM := append(certBlockPEM(intermediate.cert.Raw), certBlockPEM(root.cert.Raw)...)

	certPath := writeFile(t, dir, "device.crt", certBlockPEM(deviceLeafDER))
	keyPath := writeFile(t, dir, "device.key", keyBlockPEM(t, deviceKey))
	caChainPath := writeFile(t, dir, "ca-chain.crt", caChainPEM)

	return &mtlsFixture{
		server:      server,
		certPath:    certPath,
		keyPath:     keyPath,
		caChainPath: caChainPath,
	}
}

func newMTLSFixture(t *testing.T, handler http.HandlerFunc) *mtlsFixture {
	t.Helper()
	return newMTLSFixtureWithDeviceNotAfter(t, handler, time.Now().Add(30*24*time.Hour))
}

// closedPortURL returns an https:// URL for a loopback port that nothing is
// listening on, for simulating "connection refused".
func closedPortURL(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve a port: %v", err)
	}
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatalf("close reserved port: %v", err)
	}
	return "https://" + addr
}

func writeJSONReason(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code, "traceId": "test-trace"})
}

func TestNewClient_MissingCertFileErrors(t *testing.T) {
	dir := t.TempDir()
	root := newRootCA(t)
	caChainPath := writeFile(t, dir, "ca-chain.crt", certBlockPEM(root.cert.Raw))

	if _, err := NewClient("https://example.invalid", filepath.Join(dir, "missing.crt"), filepath.Join(dir, "missing.key"), caChainPath); err == nil {
		t.Fatal("expected error for missing certificate/key files")
	}
}

func TestNewClient_EmptyCAChainErrors(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	dir := t.TempDir()
	badCAPath := writeFile(t, dir, "ca-chain.crt", []byte("not a pem file"))

	if _, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, badCAPath); err == nil {
		t.Fatal("expected error for a CA chain file with no usable certificates")
	}
}

// TestHeartbeat_PresentsFullChainToIntermediateIssuedServer guards against a
// regression where the Client only loads the Device's own leaf certificate.
// Since the Gateway's Client CA Pool trusts only the Root CA while Device
// certificates are issued by the Intermediate CA, a leaf-only certificate
// fails Go's own client-certificate-selection check (no configured
// certificate's chain satisfies the server's advertised acceptable CAs), so
// crypto/tls silently sends no certificate and the handshake fails with
// "tls: certificate required" — this must not happen.
func TestHeartbeat_PresentsFullChainToIntermediateIssuedServer(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	if err := c.Heartbeat(context.Background()); err != nil {
		t.Fatalf("Heartbeat: %v (client must present Device leaf + Intermediate CA, not the leaf alone)", err)
	}
}

func TestHeartbeat_Success(t *testing.T) {
	var gotPath, gotMethod string
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		w.WriteHeader(http.StatusOK)
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	if err := c.Heartbeat(context.Background()); err != nil {
		t.Fatalf("Heartbeat: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/heartbeat" {
		t.Errorf("path = %q, want /heartbeat", gotPath)
	}
}

func TestHeartbeat_NonOKStatus(t *testing.T) {
	const bodyMarker = "internal failure detail that must never leak into an error string"
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(bodyMarker))
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	err = c.Heartbeat(context.Background())
	if err == nil {
		t.Fatal("expected error for a non-2xx response")
	}
	if strings.Contains(err.Error(), bodyMarker) {
		t.Errorf("error must not contain the response body, got %q", err.Error())
	}

	var hbErr *HeartbeatError
	if !errors.As(err, &hbErr) {
		t.Fatalf("expected *HeartbeatError, got %T", err)
	}
	if hbErr.Kind != FailureTemporary {
		t.Errorf("Kind = %v, want FailureTemporary for a 503", hbErr.Kind)
	}
}

func TestHeartbeat_RequiresClientCertificate(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	caChainPEM, err := os.ReadFile(fixture.caChainPath)
	if err != nil {
		t.Fatalf("read ca chain: %v", err)
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(caChainPEM)

	noCertClient := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool},
		},
	}

	_, err = noCertClient.Get(fixture.server.URL + "/heartbeat")
	if err == nil {
		t.Fatal("expected the mTLS fixture to reject a request without a client certificate")
	}
}

func TestHeartbeat_CertificateRevokedReasonCode(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSONReason(w, http.StatusForbidden, "CERTIFICATE_REVOKED")
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	err = c.Heartbeat(context.Background())
	var hbErr *HeartbeatError
	if !errors.As(err, &hbErr) {
		t.Fatalf("expected *HeartbeatError, got %T (%v)", err, err)
	}
	if hbErr.Kind != FailureReenrollRequired {
		t.Errorf("Kind = %v, want FailureReenrollRequired", hbErr.Kind)
	}
	if hbErr.ReasonCode != "CERTIFICATE_REVOKED" {
		t.Errorf("ReasonCode = %q, want CERTIFICATE_REVOKED", hbErr.ReasonCode)
	}
}

func TestHeartbeat_CertificateExpiredReasonCode(t *testing.T) {
	// Exercises the HTTP-reasonCode path (the Gateway's own app-layer
	// decision), distinct from TestHeartbeat_LocalCertificateExpired below,
	// which exercises the locally-detected path that is what actually
	// fires in production (an expired client certificate normally never
	// reaches the HTTP layer at all — see client.go's NewClient comment).
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSONReason(w, http.StatusForbidden, "CERTIFICATE_EXPIRED")
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	err = c.Heartbeat(context.Background())
	var hbErr *HeartbeatError
	if !errors.As(err, &hbErr) {
		t.Fatalf("expected *HeartbeatError, got %T (%v)", err, err)
	}
	if hbErr.Kind != FailureReenrollRequired {
		t.Errorf("Kind = %v, want FailureReenrollRequired", hbErr.Kind)
	}
}

func TestHeartbeat_OtherAuthReasonCodeIsPermanentNotReenroll(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSONReason(w, http.StatusForbidden, "DEVICE_DISABLED")
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	err = c.Heartbeat(context.Background())
	var hbErr *HeartbeatError
	if !errors.As(err, &hbErr) {
		t.Fatalf("expected *HeartbeatError, got %T (%v)", err, err)
	}
	if hbErr.Kind != FailurePermanent {
		t.Errorf("Kind = %v, want FailurePermanent (a new certificate would not fix DEVICE_DISABLED)", hbErr.Kind)
	}
}

// TestHeartbeat_UnparseableAuthBodyIsTemporary guards against treating an
// ambiguous 401/403 as a diagnosed auth failure. The Gateway's own
// responses always carry a known reasonCode; an empty or undecodable body
// could come from something else entirely (a reverse proxy, a transient
// decode failure), so it must not permanently stop the heartbeat loop.
func TestHeartbeat_UnparseableAuthBodyIsTemporary(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("not json"))
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	err = c.Heartbeat(context.Background())
	var hbErr *HeartbeatError
	if !errors.As(err, &hbErr) {
		t.Fatalf("expected *HeartbeatError, got %T (%v)", err, err)
	}
	if hbErr.Kind != FailureTemporary {
		t.Errorf("Kind = %v, want FailureTemporary for an undecodable 403 body", hbErr.Kind)
	}
}

func TestHeartbeat_EmptyReasonCodeOn403IsTemporary(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSONReason(w, http.StatusForbidden, "")
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	err = c.Heartbeat(context.Background())
	var hbErr *HeartbeatError
	if !errors.As(err, &hbErr) {
		t.Fatalf("expected *HeartbeatError, got %T (%v)", err, err)
	}
	if hbErr.Kind != FailureTemporary {
		t.Errorf("Kind = %v, want FailureTemporary for an empty reasonCode", hbErr.Kind)
	}
}

// TestHeartbeat_LocalCertificateExpired is the realistic expiry path: the
// Client detects its own certificate has expired locally and never even
// attempts the request, since a genuinely expired client certificate fails
// the Gateway's TLS handshake before any HTTP response could be parsed.
func TestHeartbeat_LocalCertificateExpired(t *testing.T) {
	var requests atomic.Int64
	fixture := newMTLSFixtureWithDeviceNotAfter(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
	}, time.Now().Add(-time.Hour))

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	err = c.Heartbeat(context.Background())
	var hbErr *HeartbeatError
	if !errors.As(err, &hbErr) {
		t.Fatalf("expected *HeartbeatError, got %T (%v)", err, err)
	}
	if hbErr.Kind != FailureReenrollRequired {
		t.Errorf("Kind = %v, want FailureReenrollRequired", hbErr.Kind)
	}
	if hbErr.ReasonCode != "CERTIFICATE_EXPIRED" {
		t.Errorf("ReasonCode = %q, want CERTIFICATE_EXPIRED", hbErr.ReasonCode)
	}
	if requests.Load() != 0 {
		t.Errorf("expected no request to reach the server, got %d", requests.Load())
	}
}

func TestRun_StopsOnContextCancel(t *testing.T) {
	// count is incremented on the server's per-request goroutine. The
	// client's ctx can expire mid-request (aborting an in-flight Heartbeat
	// before it cleanly reads a response), so there is no guarantee the
	// handler goroutine has fully synchronized with this test's goroutine
	// by the time Run returns — an atomic counter avoids a data race
	// regardless of that timing.
	var count atomic.Int64
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		w.WriteHeader(http.StatusOK)
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	c.Run(ctx, 2*time.Millisecond, nil)
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Errorf("Run took %v after context cancellation, expected a prompt return", elapsed)
	}
	if count.Load() == 0 {
		t.Error("expected at least one heartbeat attempt before cancellation")
	}
}

func TestRun_StopsOnContextCancelDuringBackoff(t *testing.T) {
	// Same as TestRun_StopsOnContextCancel, but the server never succeeds,
	// so Run is cancelled while sitting in a backoff wait rather than
	// between successful attempts.
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	start := time.Now()
	c.Run(ctx, time.Hour, nil) // interval far longer than the test timeout: only the first attempt + backoff wait happen
	elapsed := time.Since(start)

	if elapsed > 500*time.Millisecond {
		t.Errorf("Run took %v after context cancellation during backoff, expected a prompt return", elapsed)
	}
}

func TestRun_SendsFirstHeartbeatImmediately(t *testing.T) {
	results := make(chan error, 1)
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	go c.Run(ctx, time.Hour, func(state State, err error) {
		if state != StateRunning {
			return
		}
		select {
		case results <- err:
		default:
		}
	})

	select {
	case err := <-results:
		if err != nil {
			t.Errorf("unexpected heartbeat error: %v", err)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("expected an immediate first heartbeat before the first tick")
	}
}

func TestRun_ConnectionRefusedRetries(t *testing.T) {
	// Reuse a valid cert fixture just for its files; baseURL points at a
	// closed port so the connection itself fails before any TLS/HTTP.
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	c, err := NewClient(closedPortURL(t), fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var retryCount atomic.Int64
	var sawAuthFailedOrReenroll atomic.Bool
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()

	c.Run(ctx, 5*time.Millisecond, func(state State, err error) {
		switch state {
		case StateRetrying:
			retryCount.Add(1)
		case StateAuthFailed, StateReenrollRequired:
			sawAuthFailedOrReenroll.Store(true)
		}
	})

	if retryCount.Load() == 0 {
		t.Error("expected at least one RETRYING transition for connection refused")
	}
	if sawAuthFailedOrReenroll.Load() {
		t.Error("connection refused must never be classified as a permanent auth failure")
	}
}

func TestRun_5xxRetries(t *testing.T) {
	var requests atomic.Int64
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var retryCount atomic.Int64
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()

	c.Run(ctx, 5*time.Millisecond, func(state State, err error) {
		if state == StateRetrying {
			retryCount.Add(1)
		}
	})

	if requests.Load() < 2 {
		t.Errorf("expected multiple retried requests, got %d", requests.Load())
	}
	if retryCount.Load() == 0 {
		t.Error("expected at least one RETRYING transition for repeated 5xx")
	}
}

func TestRun_RecoversAfterGatewayRestored(t *testing.T) {
	var requests atomic.Int64
	const failuresBeforeRecovery = 3
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		n := requests.Add(1)
		if n <= failuresBeforeRecovery {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var mu sync.Mutex
	var sawRetrying, sawRunningAfterRetrying bool
	done := make(chan struct{})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go c.Run(ctx, 2*time.Millisecond, func(state State, err error) {
		mu.Lock()
		defer mu.Unlock()
		switch state {
		case StateRetrying:
			sawRetrying = true
		case StateRunning:
			if sawRetrying {
				sawRunningAfterRetrying = true
			}
		}
		if sawRunningAfterRetrying {
			select {
			case <-done:
			default:
				close(done)
			}
		}
	})

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("expected Run to report RUNNING again after the Gateway recovered")
	}
	cancel()

	mu.Lock()
	defer mu.Unlock()
	if !sawRunningAfterRetrying {
		t.Error("expected a RUNNING transition after RETRYING once the Gateway recovered")
	}
}

func TestRun_StopsOnCertificateRevoked(t *testing.T) {
	var requests atomic.Int64
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		writeJSONReason(w, http.StatusForbidden, "CERTIFICATE_REVOKED")
	})
	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var transitions atomic.Int64
	var lastState atomic.Value
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	c.Run(ctx, 5*time.Millisecond, func(state State, err error) {
		transitions.Add(1)
		lastState.Store(state)
	})
	elapsed := time.Since(start)

	if elapsed > 150*time.Millisecond {
		t.Errorf("Run took %v, expected to stop promptly on CERTIFICATE_REVOKED rather than run out the full ctx timeout", elapsed)
	}
	if got := lastState.Load(); got != StateReenrollRequired {
		t.Errorf("final state = %v, want REENROLL_REQUIRED", got)
	}
	if requests.Load() != 1 {
		t.Errorf("expected exactly one request before Run stopped, got %d", requests.Load())
	}
}

func TestRun_StopsOnLocallyExpiredCertificate(t *testing.T) {
	var requests atomic.Int64
	fixture := newMTLSFixtureWithDeviceNotAfter(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
	}, time.Now().Add(-time.Hour))
	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var lastState atomic.Value
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	c.Run(ctx, 5*time.Millisecond, func(state State, err error) {
		lastState.Store(state)
	})

	if got := lastState.Load(); got != StateReenrollRequired {
		t.Errorf("final state = %v, want REENROLL_REQUIRED", got)
	}
	if requests.Load() != 0 {
		t.Errorf("expected no request to ever reach the server, got %d", requests.Load())
	}
}

func TestRun_DoesNotRepeatIdenticalRetryTransitions(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var retryTransitions atomic.Int64
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()

	c.Run(ctx, 2*time.Millisecond, func(state State, err error) {
		if state == StateRetrying {
			retryTransitions.Add(1)
		}
	})

	// Multiple heartbeat attempts happen (backoff keeps retrying at a short
	// interval within 60ms), but since every failure is the exact same 503,
	// only the first should have produced a RETRYING transition.
	if n := retryTransitions.Load(); n != 1 {
		t.Errorf("RETRYING transitions = %d, want exactly 1 for repeated identical failures", n)
	}
}

// TestRun_DoesNotRepeatRunningTransitions guards against RUNNING being
// reported on every single successful Heartbeat: at production scale
// (thousands of Devices on a short interval) that is the same kind of log
// volume problem as repeating identical RETRYING failures — only the first
// success (at startup, or right after recovering from RETRYING) should be
// reported; a long steady-state run of successes must stay quiet.
func TestRun_DoesNotRepeatRunningTransitions(t *testing.T) {
	fixture := newMTLSFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	c, err := NewClient(fixture.server.URL, fixture.certPath, fixture.keyPath, fixture.caChainPath)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	var runningTransitions atomic.Int64
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()

	c.Run(ctx, 2*time.Millisecond, func(state State, err error) {
		if state == StateRunning {
			runningTransitions.Add(1)
		}
	})

	if n := runningTransitions.Load(); n != 1 {
		t.Errorf("RUNNING transitions = %d, want exactly 1 for a steady run of successes", n)
	}
}

func TestNextBackoff(t *testing.T) {
	const max = 100 * time.Millisecond

	cases := []struct {
		name     string
		current  time.Duration
		interval time.Duration
		want     time.Duration
	}{
		{"first retry uses interval", 0, 10 * time.Millisecond, 10 * time.Millisecond},
		{"doubles on second retry", 10 * time.Millisecond, 10 * time.Millisecond, 20 * time.Millisecond},
		{"doubles again", 20 * time.Millisecond, 10 * time.Millisecond, 40 * time.Millisecond},
		{"clamps when doubling exceeds max", 80 * time.Millisecond, 10 * time.Millisecond, max},
		{"stays at max once reached", max, 10 * time.Millisecond, max},
		{
			// codexReview/PR-69.md Medium finding: HEARTBEAT_INTERVAL
			// configured larger than the cap must not produce a first wait
			// longer than the cap.
			"first retry clamps when interval itself exceeds max",
			0, 500 * time.Millisecond, max,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nextBackoff(tc.current, tc.interval, max)
			if got != tc.want {
				t.Errorf("nextBackoff(%v, %v, %v) = %v, want %v", tc.current, tc.interval, max, got, tc.want)
			}
		})
	}
}
