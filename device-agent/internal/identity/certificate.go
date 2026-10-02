package identity

import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"time"
)

// HasValidCertificate reports whether runtimeDir already holds a device
// certificate and CA chain usable for deviceKey right now: it parses, its
// public key matches this Identity's private key, it carries the single
// expected SAN URI urn:certgate:device:{deviceKey}, and it has not yet
// expired. Every failure mode — a missing file, corrupt PEM, an expired
// certificate, a key mismatch, or a certificate issued for a different
// Device Key — returns false. That is not treated as an error: it is the
// normal "(re-)enroll" signal, and returning false is this package's
// Fail-Closed behavior for certificate material.
//
// There is deliberately no "renew before actual expiry" logic here: a
// certificate that has not yet expired is always reported valid, no matter
// how little time is left. Automatic renewal ahead of expiry is explicitly
// out of MVP scope (docs/requirements.md "MVP 제외 범위": 자동 Certificate
// 갱신; docs/adr/003-certificate-validity.md: "제출용 MVP는 자동 갱신보다
// 만료 감지와 접속 차단을 우선 구현한다") — once this certificate actually
// expires, the next restart's "(re-)enroll" signal runs ordinary,
// admin-approved Enrollment exactly as if this were the Device's first
// enrollment, and until then the Gateway's own certificate verification is
// what detects and blocks an expired certificate.
func (id Identity) HasValidCertificate(runtimeDir, deviceKey string, now time.Time) bool {
	if id.key == nil {
		return false
	}

	certPEM, err := os.ReadFile(filepath.Join(runtimeDir, CertFileName))
	if err != nil {
		return false
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}

	caChainPEM, err := os.ReadFile(filepath.Join(runtimeDir, CAChainFileName))
	if err != nil {
		return false
	}
	if !x509.NewCertPool().AppendCertsFromPEM(caChainPEM) {
		return false
	}

	certKey, ok := cert.PublicKey.(*ecdsa.PublicKey)
	if !ok || !certKey.Equal(&id.key.PublicKey) {
		return false
	}

	if len(cert.URIs) != 1 || cert.URIs[0].String() != sanURIPrefix+deviceKey {
		return false
	}

	return now.Before(cert.NotAfter)
}
