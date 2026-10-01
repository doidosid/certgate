package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const testDeviceKey = "sensor-floor-01"

// testCA is a throwaway self-signed Root CA used only to issue device leaf
// certificates for HasValidCertificate test fixtures.
type testCA struct {
	cert *x509.Certificate
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
	return &testCA{cert: cert, key: key}
}

func (ca *testCA) pemBlock() *pem.Block {
	return &pem.Block{Type: "CERTIFICATE", Bytes: ca.cert.Raw}
}

// issueLeafForKey signs a leaf certificate over pub (the Device's own key,
// so HasValidCertificate's key-match check can pass or fail deliberately),
// carrying sanURI (if non-empty) and expiring at notAfter.
func (ca *testCA) issueLeafForKey(t *testing.T, serial int64, pub *ecdsa.PublicKey, sanURI string, notAfter time.Time) *pem.Block {
	t.Helper()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: "test-device"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	if sanURI != "" {
		uri, err := url.Parse(sanURI)
		if err != nil {
			t.Fatalf("parse SAN URI: %v", err)
		}
		template.URIs = []*url.URL{uri}
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, pub, ca.key)
	if err != nil {
		t.Fatalf("create leaf certificate: %v", err)
	}
	return &pem.Block{Type: "CERTIFICATE", Bytes: der}
}

func writeCertFiles(t *testing.T, dir string, certBlock, caBlock *pem.Block) {
	t.Helper()
	if certBlock != nil {
		if err := os.WriteFile(filepath.Join(dir, CertFileName), pem.EncodeToMemory(certBlock), 0o644); err != nil {
			t.Fatalf("write %s: %v", CertFileName, err)
		}
	}
	if caBlock != nil {
		if err := os.WriteFile(filepath.Join(dir, CAChainFileName), pem.EncodeToMemory(caBlock), 0o644); err != nil {
			t.Fatalf("write %s: %v", CAChainFileName, err)
		}
	}
}

func TestHasValidCertificate_ValidCertAndChain(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ca := newTestCA(t)
	leaf := ca.issueLeafForKey(t, 2, &id.key.PublicKey, sanURIPrefix+testDeviceKey, time.Now().Add(30*24*time.Hour))
	writeCertFiles(t, dir, leaf, ca.pemBlock())

	if !id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected a fresh, matching certificate to be valid")
	}
}

// TestHasValidCertificate_ValidWithLittleTimeLeft guards against
// reintroducing a "renew before actual expiry" buffer: a certificate that
// has not yet expired must always be reported valid, no matter how little
// time is left. Automatic renewal ahead of expiry is explicitly out of MVP
// scope (docs/requirements.md "MVP 제외 범위": 자동 Certificate 갱신;
// docs/adr/003-certificate-validity.md).
func TestHasValidCertificate_ValidWithLittleTimeLeft(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ca := newTestCA(t)
	leaf := ca.issueLeafForKey(t, 2, &id.key.PublicKey, sanURIPrefix+testDeviceKey, time.Now().Add(time.Minute))
	writeCertFiles(t, dir, leaf, ca.pemBlock())

	if !id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected a certificate with little time left, but not yet expired, to still be valid")
	}
}

func TestHasValidCertificate_MissingCertFile(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ca := newTestCA(t)
	writeCertFiles(t, dir, nil, ca.pemBlock())

	if id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected missing device.crt to be invalid")
	}
}

func TestHasValidCertificate_MissingCAChainFile(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ca := newTestCA(t)
	leaf := ca.issueLeafForKey(t, 2, &id.key.PublicKey, sanURIPrefix+testDeviceKey, time.Now().Add(30*24*time.Hour))
	writeCertFiles(t, dir, leaf, nil)

	if id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected missing ca-chain.crt to be invalid")
	}
}

func TestHasValidCertificate_CorruptCertPEM(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ca := newTestCA(t)
	if err := os.WriteFile(filepath.Join(dir, CertFileName), []byte("not a pem file"), 0o644); err != nil {
		t.Fatalf("write corrupt cert: %v", err)
	}
	writeCertFiles(t, dir, nil, ca.pemBlock())

	if id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected corrupt device.crt to be invalid")
	}
}

func TestHasValidCertificate_ExpiredCertificate(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ca := newTestCA(t)
	leaf := ca.issueLeafForKey(t, 2, &id.key.PublicKey, sanURIPrefix+testDeviceKey, time.Now().Add(-time.Hour))
	writeCertFiles(t, dir, leaf, ca.pemBlock())

	if id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected an expired certificate to be invalid")
	}
}

func TestHasValidCertificate_KeyMismatch(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	otherKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate other key: %v", err)
	}

	ca := newTestCA(t)
	leaf := ca.issueLeafForKey(t, 2, &otherKey.PublicKey, sanURIPrefix+testDeviceKey, time.Now().Add(30*24*time.Hour))
	writeCertFiles(t, dir, leaf, ca.pemBlock())

	if id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected a certificate issued over a different key to be invalid")
	}
}

// TestHasValidCertificate_WrongDeviceKey guards against reusing a
// certificate issued for a different DEVICE_KEY's SAN URI (e.g. left over
// in a reused DEVICE_RUNTIME_DIR after DEVICE_KEY was changed), even though
// it matches the locally stored private key.
func TestHasValidCertificate_WrongDeviceKey(t *testing.T) {
	dir := t.TempDir()
	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ca := newTestCA(t)
	leaf := ca.issueLeafForKey(t, 2, &id.key.PublicKey, sanURIPrefix+"a-different-device", time.Now().Add(30*24*time.Hour))
	writeCertFiles(t, dir, leaf, ca.pemBlock())

	if id.HasValidCertificate(dir, testDeviceKey, time.Now()) {
		t.Error("expected a certificate issued for a different device key to be invalid")
	}
}
