package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"tech.certgate/gateway/internal/access"
	"tech.certgate/gateway/internal/management"
	"tech.certgate/gateway/internal/outbox"
	"tech.certgate/gateway/internal/policy"
	"tech.certgate/gateway/internal/proxy"
	"tech.certgate/gateway/internal/tlsauth"
)

// testCA is a throwaway self-signed Root CA, matching pki/README.md's "Test는
// 매 실행마다 임시 PKI를 생성" convention (docs/testing.md: "실제로 생성한
// Certificate를 사용한다").
type testCA struct {
	cert *x509.Certificate
	der  []byte
	key  *ecdsa.PrivateKey
}

func newTestCA(t *testing.T) *testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
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
		t.Fatalf("create CA certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse CA certificate: %v", err)
	}
	return &testCA{cert: cert, der: der, key: key}
}

func (ca *testCA) pemBytes() []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.der})
}

func (ca *testCA) issueServerCert(t *testing.T) (certPEM, keyPEM []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate server key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "gateway"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(30 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatalf("create server certificate: %v", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal server key: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
}

// issueDeviceCert signs a Device leaf certificate with the given serial and
// SAN URI device key.
func (ca *testCA) issueDeviceCert(t *testing.T, serial int64, deviceKey string) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate device key: %v", err)
	}
	sanURI, err := url.Parse("urn:certgate:device:" + deviceKey)
	if err != nil {
		t.Fatalf("parse SAN URI: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: deviceKey},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(30 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		URIs:         []*url.URL{sanURI},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatalf("create device certificate: %v", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal device key: %v", err)
	}
	cert, err := tls.X509KeyPair(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}),
	)
	if err != nil {
		t.Fatalf("build tls.Certificate: %v", err)
	}
	return cert
}

// testGateway wires a real mTLS listener backed by accessHandler, a fake
// Management API, and a fake Backend, so tests exercise real TCP/TLS
// connections end to end (docs/testing.md: "실제 TCP/TLS 연결과 실제로 생성한
// Certificate를 사용한다").
type testGateway struct {
	addr       string
	rootCAPEM  []byte
	backendHit chan *http.Request
}

func startTestGateway(t *testing.T, ca *testCA, accessContexts map[string]management.AccessContext) *testGateway {
	t.Helper()
	serverCertPEM, serverKeyPEM := ca.issueServerCert(t)

	dir := t.TempDir()
	certPath := filepath.Join(dir, "gateway.crt")
	keyPath := filepath.Join(dir, "gateway.key")
	rootPath := filepath.Join(dir, "root-ca.crt")
	if err := os.WriteFile(certPath, serverCertPEM, 0o600); err != nil {
		t.Fatalf("write server cert: %v", err)
	}
	if err := os.WriteFile(keyPath, serverKeyPEM, 0o600); err != nil {
		t.Fatalf("write server key: %v", err)
	}
	if err := os.WriteFile(rootPath, ca.pemBytes(), 0o600); err != nil {
		t.Fatalf("write root CA: %v", err)
	}

	backendHit := make(chan *http.Request, 10)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cloned := r.Clone(r.Context())
		backendHit <- cloned
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(backend.Close)

	mgmt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serial := r.URL.Query().Get("serialNumber")
		ctx, ok := accessContexts[serial]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(management.APIError{Code: "CERTIFICATE_NOT_FOUND", Message: "unknown", TraceID: "t"})
			return
		}
		_ = json.NewEncoder(w).Encode(ctx)
	}))
	t.Cleanup(mgmt.Close)

	mgmtClient := management.NewClient(mgmt.URL, "test-service-token")
	accessCache := access.New(mgmtClient, 30*time.Second, nil)

	store, err := outbox.Open(filepath.Join(dir, "outbox.db"))
	if err != nil {
		t.Fatalf("open outbox: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	backendURL, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatalf("parse backend URL: %v", err)
	}

	h := &accessHandler{access: accessCache, store: store, proxy: proxy.NewReverseProxy(backendURL)}

	tlsConfig, err := tlsauth.ServerConfig(certPath, keyPath, rootPath)
	if err != nil {
		t.Fatalf("ServerConfig: %v", err)
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", tlsConfig)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := &http.Server{Handler: h}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })

	return &testGateway{addr: listener.Addr().String(), rootCAPEM: ca.pemBytes(), backendHit: backendHit}
}

// client builds an HTTP client trusting the Gateway's own Root CA (so it can
// verify the server's certificate) and presenting cert as its Client
// Certificate (which may be signed by a different CA, to exercise rejection).
func (g *testGateway) client(t *testing.T, cert tls.Certificate) *http.Client {
	t.Helper()
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(g.rootCAPEM) {
		t.Fatal("failed to load root CA pool for test client")
	}
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				RootCAs:      pool,
				Certificates: []tls.Certificate{cert},
			},
		},
		Timeout: 5 * time.Second,
	}
}

func sensorRules() []policy.Rule {
	return []policy.Rule{
		{HTTPMethod: "POST", PathPattern: "/telemetry", Effect: "ALLOW", Priority: 10},
		{HTTPMethod: "POST", PathPattern: "/heartbeat", Effect: "ALLOW", Priority: 20},
	}
}

func operatorRules() []policy.Rule {
	return append(sensorRules(), policy.Rule{HTTPMethod: "GET", PathPattern: "/commands", Effect: "ALLOW", Priority: 30})
}

func doRequest(t *testing.T, client *http.Client, addr, method, path string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, "https://"+addr+path, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

// Device Profile A (docs/testing.md): normal SENSOR Heartbeat/Telemetry
// allowed, and it reaches the Backend with Gateway-issued trusted headers,
// not whatever the Device claimed.
func TestGateway_ProfileA_NormalSensorAllowed(t *testing.T) {
	ca := newTestCA(t)
	cert := ca.issueDeviceCert(t, 100, "sensor-floor-01")
	gw := startTestGateway(t, ca, map[string]management.AccessContext{
		"64": {DeviceID: "device-1", DeviceKey: "sensor-floor-01", DeviceStatus: "ACTIVE", CertificateStatus: "VALID", RoleName: "SENSOR", Rules: sensorRules()},
	})
	client := gw.client(t, cert)

	req, err := http.NewRequest(http.MethodPost, "https://"+gw.addr+"/telemetry", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set(proxy.HeaderDeviceKey, "attacker-supplied")
	req.Header.Set(proxy.HeaderRole, "OPERATOR")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want 200, body=%s", resp.StatusCode, body)
	}

	select {
	case hit := <-gw.backendHit:
		if got := hit.Header.Get(proxy.HeaderDeviceKey); got != "sensor-floor-01" {
			t.Errorf("Backend saw HeaderDeviceKey = %q, want sensor-floor-01 (Gateway-verified identity)", got)
		}
		if got := hit.Header.Get(proxy.HeaderRole); got != "SENSOR" {
			t.Errorf("Backend saw HeaderRole = %q, want SENSOR", got)
		}
	default:
		t.Fatal("expected the request to reach the Backend")
	}
}

// Device Profile B analog (docs/testing.md): a Certificate the Access
// Context reports as REVOKED is blocked before it reaches the Backend.
func TestGateway_ProfileB_RevokedCertificateBlocked(t *testing.T) {
	ca := newTestCA(t)
	cert := ca.issueDeviceCert(t, 101, "sensor-floor-02")
	gw := startTestGateway(t, ca, map[string]management.AccessContext{
		"65": {DeviceID: "device-2", DeviceKey: "sensor-floor-02", DeviceStatus: "ACTIVE", CertificateStatus: "REVOKED", RoleName: "SENSOR", Rules: sensorRules()},
	})
	client := gw.client(t, cert)

	resp := doRequest(t, client, gw.addr, http.MethodPost, "/telemetry")
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
	assertBackendNotReached(t, gw)
}

// Device Profile C (docs/testing.md): a Client Certificate signed by a
// different CA fails the TLS handshake itself and never reaches the
// Backend.
func TestGateway_ProfileC_DifferentCARejectedAtHandshake(t *testing.T) {
	trustedCA := newTestCA(t)
	otherCA := newTestCA(t)
	cert := otherCA.issueDeviceCert(t, 999, "sensor-floor-99")
	gw := startTestGateway(t, trustedCA, map[string]management.AccessContext{})
	client := gw.client(t, cert)

	req, err := http.NewRequest(http.MethodPost, "https://"+gw.addr+"/telemetry", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	if _, err := client.Do(req); err == nil {
		t.Fatal("expected the TLS handshake to fail for a certificate signed by an untrusted CA")
	}
	assertBackendNotReached(t, gw)
}

// Device Profile D (docs/testing.md): an expired Certificate is blocked.
func TestGateway_ProfileD_ExpiredCertificateBlocked(t *testing.T) {
	ca := newTestCA(t)
	cert := ca.issueDeviceCert(t, 102, "sensor-floor-03")
	gw := startTestGateway(t, ca, map[string]management.AccessContext{
		"66": {DeviceID: "device-3", DeviceKey: "sensor-floor-03", DeviceStatus: "ACTIVE", CertificateStatus: "EXPIRED", RoleName: "SENSOR", Rules: sensorRules()},
	})
	client := gw.client(t, cert)

	resp := doRequest(t, client, gw.addr, http.MethodPost, "/telemetry")
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
	assertBackendNotReached(t, gw)
}

// Device Profile E (docs/testing.md): SENSOR hitting /commands is denied.
func TestGateway_ProfileE_SensorCommandsDenied(t *testing.T) {
	ca := newTestCA(t)
	cert := ca.issueDeviceCert(t, 103, "sensor-floor-04")
	gw := startTestGateway(t, ca, map[string]management.AccessContext{
		"67": {DeviceID: "device-4", DeviceKey: "sensor-floor-04", DeviceStatus: "ACTIVE", CertificateStatus: "VALID", RoleName: "SENSOR", Rules: sensorRules()},
	})
	client := gw.client(t, cert)

	resp := doRequest(t, client, gw.addr, http.MethodGet, "/commands")
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
	assertBackendNotReached(t, gw)
}

// Device Profile F (docs/testing.md): OPERATOR is allowed /commands.
func TestGateway_ProfileF_OperatorCommandsAllowed(t *testing.T) {
	ca := newTestCA(t)
	cert := ca.issueDeviceCert(t, 104, "operator-floor-01")
	gw := startTestGateway(t, ca, map[string]management.AccessContext{
		"68": {DeviceID: "device-5", DeviceKey: "operator-floor-01", DeviceStatus: "ACTIVE", CertificateStatus: "VALID", RoleName: "OPERATOR", Rules: operatorRules()},
	})
	client := gw.client(t, cert)

	resp := doRequest(t, client, gw.addr, http.MethodGet, "/commands")
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

// Disabled Device: even a VALID Certificate is blocked once the Device is
// DISABLED (docs/security-design.md §5).
func TestGateway_DisabledDeviceBlocked(t *testing.T) {
	ca := newTestCA(t)
	cert := ca.issueDeviceCert(t, 105, "sensor-floor-05")
	gw := startTestGateway(t, ca, map[string]management.AccessContext{
		"69": {DeviceID: "device-6", DeviceKey: "sensor-floor-05", DeviceStatus: "DISABLED", CertificateStatus: "VALID", RoleName: "SENSOR", Rules: sensorRules()},
	})
	client := gw.client(t, cert)

	resp := doRequest(t, client, gw.addr, http.MethodPost, "/telemetry")
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
	assertBackendNotReached(t, gw)
}

// Fail Closed (docs/security-design.md §5): a serial number the Management
// API does not recognize is blocked, not silently allowed.
func TestGateway_UnknownSerialFailsClosed(t *testing.T) {
	ca := newTestCA(t)
	cert := ca.issueDeviceCert(t, 106, "sensor-floor-06")
	gw := startTestGateway(t, ca, map[string]management.AccessContext{})
	client := gw.client(t, cert)

	resp := doRequest(t, client, gw.addr, http.MethodPost, "/telemetry")
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
	assertBackendNotReached(t, gw)
}

func assertBackendNotReached(t *testing.T, gw *testGateway) {
	t.Helper()
	select {
	case <-gw.backendHit:
		t.Fatal("expected the Backend to never receive this request")
	case <-time.After(50 * time.Millisecond):
	}
}
