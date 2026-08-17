// Package identity generates and holds the Device private key, CSR, and SAN
// URI. Private key material must never be exposed outside this package.
package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
)

const keyFileName = "device.key"

// sanURIPrefix is the single allowed SAN URI prefix for Device identity
// (docs/adr/001-device-identity.md).
const sanURIPrefix = "urn:certgate:device:"

// Identity is a handle to a Device's persisted private key. The key itself
// is never exposed outside this package; only CreateCSR uses it.
type Identity struct {
	keyPath string
	key     *ecdsa.PrivateKey
}

// EnsureKey loads the Device private key from runtimeDir, generating an
// ECDSA P-256 key and persisting it with 0600 permissions if none exists yet.
// Calling it again against the same runtimeDir reloads the same key so the
// Device identity survives a restart.
func EnsureKey(runtimeDir string) (Identity, error) {
	if runtimeDir == "" {
		return Identity{}, errors.New("identity: runtime directory is required")
	}
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		return Identity{}, fmt.Errorf("identity: create runtime dir: %w", err)
	}

	keyPath := filepath.Join(runtimeDir, keyFileName)

	if pemBytes, err := os.ReadFile(keyPath); err == nil {
		key, parseErr := parseECPrivateKey(pemBytes)
		if parseErr != nil {
			return Identity{}, fmt.Errorf("identity: load existing key: %w", parseErr)
		}
		return Identity{keyPath: keyPath, key: key}, nil
	} else if !os.IsNotExist(err) {
		return Identity{}, fmt.Errorf("identity: read key file: %w", err)
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return Identity{}, fmt.Errorf("identity: generate key: %w", err)
	}
	if err := persistKey(keyPath, key); err != nil {
		return Identity{}, err
	}

	return Identity{keyPath: keyPath, key: key}, nil
}

// CreateCSR builds a PEM-encoded PKCS#10 CSR for deviceKey, signed with this
// Identity's private key. The CSR carries exactly one SAN URI,
// urn:certgate:device:{deviceKey} (docs/adr/001-device-identity.md). Common
// Name is set for display only and is never used for authentication.
func (id Identity) CreateCSR(deviceKey string) ([]byte, error) {
	if deviceKey == "" {
		return nil, errors.New("identity: device key is required")
	}
	if id.key == nil {
		return nil, errors.New("identity: no key loaded, call EnsureKey first")
	}

	sanURI, err := url.Parse(sanURIPrefix + deviceKey)
	if err != nil {
		return nil, fmt.Errorf("identity: build SAN URI: %w", err)
	}

	template := &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: deviceKey},
		SignatureAlgorithm: x509.ECDSAWithSHA256,
		URIs:               []*url.URL{sanURI},
	}

	der, err := x509.CreateCertificateRequest(rand.Reader, template, id.key)
	if err != nil {
		return nil, fmt.Errorf("identity: create CSR: %w", err)
	}

	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}), nil
}

func persistKey(keyPath string, key *ecdsa.PrivateKey) error {
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return fmt.Errorf("identity: marshal key: %w", err)
	}
	block := &pem.Block{Type: "EC PRIVATE KEY", Bytes: der}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(block), 0o600); err != nil {
		return fmt.Errorf("identity: write key file: %w", err)
	}
	return nil
}

func parseECPrivateKey(pemBytes []byte) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("no PEM block found in key file")
	}
	return x509.ParseECPrivateKey(block.Bytes)
}
