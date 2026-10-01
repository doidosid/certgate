package client

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

func (ca *testCA) pemBlock() *pem.Block {
	return &pem.Block{Type: "CERTIFICATE", Bytes: ca.cert.Raw}
}

// issueLeaf signs a leaf certificate with this CA's key, returning its DER
// bytes and private key (not yet PEM-encoded, so callers decide which chain
// segments to write to which file).
func (ca *testCA) issueLeaf(t *testing.T, serial int64, extKeyUsage []x509.ExtKeyUsage) ([]byte, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: "test-leaf"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(30 * 24 * time.Hour),
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

func newMTLSFixture(t *testing.T, handler http.HandlerFunc) *mtlsFixture {
	t.Helper()
	dir := t.TempDir()

	root := newRootCA(t)
	intermediate := root.issueIntermediateCA(t, 2)

	serverLeafDER, serverKey := intermediate.issueLeaf(t, 10, []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth})
	deviceLeafDER, deviceKey := intermediate.issueLeaf(t, 20, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth})

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

	go c.Run(ctx, time.Hour, func(err error) {
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
