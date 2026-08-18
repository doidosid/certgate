package tlsauth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// testCA is a throwaway self-signed Root CA used to sign both the Gateway's
// own server certificate and Device leaf certificates in tests, matching
// pki/README.md's "Test는 매 실행마다 임시 PKI를 생성" convention.
type testCA struct {
	cert    *x509.Certificate
	certDER []byte
	key     *ecdsa.PrivateKey
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
	return &testCA{cert: cert, certDER: der, key: key}
}

func (ca *testCA) pem() []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.certDER})
}

// issueLeaf signs a leaf certificate for serial, optionally carrying sanURI,
// suitable both as the Gateway's own server certificate and as a Device
// Client Certificate.
func (ca *testCA) issueLeaf(t *testing.T, serial int64, sanURI string, extraDNSSAN string) (*ecdsa.PrivateKey, *x509.Certificate, []byte) {
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
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	if sanURI != "" {
		uri, err := url.Parse(sanURI)
		if err != nil {
			t.Fatalf("parse SAN URI: %v", err)
		}
		template.URIs = append(template.URIs, uri)
	}
	if extraDNSSAN != "" {
		template.DNSNames = append(template.DNSNames, extraDNSSAN)
	}

	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatalf("create leaf certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse leaf certificate: %v", err)
	}
	return key, cert, der
}

func writePEM(t *testing.T, dir, name string, block *pem.Block) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

func TestDeviceKey_ExtractsFromSingleSANURI(t *testing.T) {
	ca := newTestCA(t)
	_, cert, _ := ca.issueLeaf(t, 2, "urn:certgate:device:sensor-floor-01", "")

	got, err := DeviceKey(cert)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "sensor-floor-01" {
		t.Errorf("DeviceKey = %q, want sensor-floor-01", got)
	}
}

func TestDeviceKey_RejectsZeroURIs(t *testing.T) {
	ca := newTestCA(t)
	_, cert, _ := ca.issueLeaf(t, 3, "", "")

	if _, err := DeviceKey(cert); err == nil {
		t.Error("expected an error for a certificate with no SAN URI")
	}
}

func TestDeviceKey_RejectsWrongPrefix(t *testing.T) {
	ca := newTestCA(t)
	_, cert, _ := ca.issueLeaf(t, 4, "urn:something-else:sensor-floor-01", "")

	if _, err := DeviceKey(cert); err == nil {
		t.Error("expected an error for a SAN URI outside the certgate device prefix")
	}
}

func TestDeviceKey_RejectsMultipleURIs(t *testing.T) {
	ca := newTestCA(t)
	key, cert, der := ca.issueLeaf(t, 5, "urn:certgate:device:sensor-floor-01", "")
	_ = key
	_ = der

	// issueLeaf only supports one URI SAN; build a second URI directly via a
	// fresh template sharing the same cert's parsed URIs plus one appended.
	cert.URIs = append(cert.URIs, cert.URIs[0])

	if _, err := DeviceKey(cert); err == nil {
		t.Error("expected an error for a certificate with more than one SAN URI")
	}
}

func TestSerialNumber_IsUppercaseHexNoPadding(t *testing.T) {
	ca := newTestCA(t)
	_, cert, _ := ca.issueLeaf(t, 0x7F28A109, "urn:certgate:device:sensor-floor-01", "")

	got := SerialNumber(cert)
	if got != "7F28A109" {
		t.Errorf("SerialNumber = %q, want 7F28A109", got)
	}
}

func TestServerConfig_LoadsCertificatesAndRequiresTLS13ClientCert(t *testing.T) {
	ca := newTestCA(t)
	serverKey, _, serverDER := ca.issueLeaf(t, 10, "", "")
	dir := t.TempDir()

	serverKeyDER, err := x509.MarshalECPrivateKey(serverKey)
	if err != nil {
		t.Fatalf("marshal server key: %v", err)
	}
	certPath := writePEM(t, dir, "gateway.crt", &pem.Block{Type: "CERTIFICATE", Bytes: serverDER})
	keyPath := writePEM(t, dir, "gateway.key", &pem.Block{Type: "EC PRIVATE KEY", Bytes: serverKeyDER})
	rootPath := filepath.Join(dir, "root-ca.crt")
	if err := os.WriteFile(rootPath, ca.pem(), 0o600); err != nil {
		t.Fatalf("write root CA: %v", err)
	}

	cfg, err := ServerConfig(certPath, keyPath, rootPath)
	if err != nil {
		t.Fatalf("ServerConfig: %v", err)
	}
	if cfg.MinVersion != tls.VersionTLS13 {
		t.Errorf("MinVersion = %x, want TLS 1.3", cfg.MinVersion)
	}
	if cfg.ClientAuth != tls.RequireAndVerifyClientCert {
		t.Errorf("ClientAuth = %v, want RequireAndVerifyClientCert", cfg.ClientAuth)
	}
	if len(cfg.Certificates) != 1 {
		t.Errorf("Certificates = %d, want 1", len(cfg.Certificates))
	}
	if cfg.ClientCAs == nil {
		t.Error("expected a non-nil ClientCAs pool")
	}
}

func TestServerConfig_MissingServerCertFileErrors(t *testing.T) {
	dir := t.TempDir()
	if _, err := ServerConfig(filepath.Join(dir, "missing.crt"), filepath.Join(dir, "missing.key"), filepath.Join(dir, "root-ca.crt")); err == nil {
		t.Error("expected an error for a missing server certificate file")
	}
}
