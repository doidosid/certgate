package identity

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureKey_GeneratesAndPersistsKey(t *testing.T) {
	dir := t.TempDir()

	id, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	keyPath := filepath.Join(dir, keyFileName)
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("expected key file to exist: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("key file permission = %v, want 0600", perm)
	}
	if id.key == nil {
		t.Error("expected loaded key, got nil")
	}
}

func TestEnsureKey_ReloadsSameKeyAcrossCalls(t *testing.T) {
	dir := t.TempDir()

	first, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	second, err := EnsureKey(dir)
	if err != nil {
		t.Fatalf("unexpected error on reload: %v", err)
	}

	if !first.key.Equal(second.key) {
		t.Error("expected EnsureKey to reload the same key on a restart, got a different key")
	}
}

func TestEnsureKey_EmptyRuntimeDir(t *testing.T) {
	_, err := EnsureKey("")
	if err == nil {
		t.Fatal("expected error for empty runtime directory")
	}
}

func TestCreateCSR_ValidSelfSignatureAndSingleSANURI(t *testing.T) {
	id, err := EnsureKey(t.TempDir())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	csrPEM, err := id.CreateCSR("sensor-floor-01")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	block, _ := pem.Decode(csrPEM)
	if block == nil || block.Type != "CERTIFICATE REQUEST" {
		t.Fatalf("expected a CERTIFICATE REQUEST PEM block, got %v", block)
	}

	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatalf("parse CSR: %v", err)
	}
	if err := csr.CheckSignature(); err != nil {
		t.Errorf("CSR self-signature invalid: %v", err)
	}

	if len(csr.URIs) != 1 {
		t.Fatalf("expected exactly one SAN URI, got %d", len(csr.URIs))
	}
	want := "urn:certgate:device:sensor-floor-01"
	if got := csr.URIs[0].String(); got != want {
		t.Errorf("SAN URI = %q, want %q", got, want)
	}
}

func TestCreateCSR_EmptyDeviceKeyRejected(t *testing.T) {
	id, err := EnsureKey(t.TempDir())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := id.CreateCSR(""); err == nil {
		t.Fatal("expected error for empty device key")
	}
}

func TestCreateCSR_WithoutKeyLoaded(t *testing.T) {
	var id Identity

	if _, err := id.CreateCSR("sensor-floor-01"); err == nil {
		t.Fatal("expected error when no key has been loaded")
	}
}
