// Package tlsauth builds the Gateway's mTLS server configuration and
// extracts a Device's identity from its verified Client Certificate
// (docs/security-design.md §5, docs/adr/001-device-identity.md).
package tlsauth

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"strings"
)

// sanURIPrefix is the single allowed SAN URI prefix for Device identity.
const sanURIPrefix = "urn:certgate:device:"

// ServerConfig loads the Gateway's own server certificate/key and the Root
// CA pool used to verify Device Client Certificates. TLS 1.3 and a Client
// Certificate are always required (docs/security-design.md §5).
func ServerConfig(serverCertPath, serverKeyPath, rootCACertPath string) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(serverCertPath, serverKeyPath)
	if err != nil {
		return nil, fmt.Errorf("tlsauth: load server certificate: %w", err)
	}

	rootPEM, err := os.ReadFile(rootCACertPath)
	if err != nil {
		return nil, fmt.Errorf("tlsauth: read root CA certificate: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(rootPEM) {
		return nil, fmt.Errorf("tlsauth: no certificates found in %s", rootCACertPath)
	}

	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
	}, nil
}

// DeviceKey extracts the Device Key from cert's single SAN URI
// (urn:certgate:device:{device-key}). Any other shape — zero URIs, more
// than one, or a URI outside this prefix — is rejected. Common Name is
// never used for authentication (docs/security-design.md §4).
func DeviceKey(cert *x509.Certificate) (string, error) {
	if len(cert.URIs) != 1 {
		return "", fmt.Errorf("tlsauth: expected exactly one SAN URI, got %d", len(cert.URIs))
	}
	uri := cert.URIs[0].String()
	if !strings.HasPrefix(uri, sanURIPrefix) {
		return "", fmt.Errorf("tlsauth: SAN URI %q does not have prefix %q", uri, sanURIPrefix)
	}
	deviceKey := strings.TrimPrefix(uri, sanURIPrefix)
	if deviceKey == "" {
		return "", errors.New("tlsauth: SAN URI has empty device key")
	}
	return deviceKey, nil
}

// SerialNumber formats cert's serial number the same way the Management API
// stores it (BigInteger.toString(16).toUpperCase() in
// IntermediateCertificateAuthority.java) so Access Context lookups match.
func SerialNumber(cert *x509.Certificate) string {
	return strings.ToUpper(cert.SerialNumber.Text(16))
}
