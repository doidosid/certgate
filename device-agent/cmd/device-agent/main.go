// Command device-agent runs the CertGate virtual Device client.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"tech.certgate/device-agent/internal/config"
	"tech.certgate/device-agent/internal/enrollment"
	"tech.certgate/device-agent/internal/identity"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("device-agent: %v", err)
	}

	log.Printf("device-agent: starting for device %s (management-api=%s)", cfg.DeviceKey, cfg.ManagementAPIURL)

	id, err := identity.EnsureKey(cfg.RuntimeDir)
	if err != nil {
		log.Fatalf("device-agent: %v", err)
	}
	csrPEM, err := id.CreateCSR(cfg.DeviceKey)
	if err != nil {
		log.Fatalf("device-agent: %v", err)
	}
	log.Printf("device-agent: local key and CSR ready for SAN URI urn:certgate:device:%s", cfg.DeviceKey)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	client := enrollment.NewClient(cfg.ManagementAPIURL, cfg.EnrollmentToken)
	log.Print("device-agent: submitting CSR and waiting for administrator approval")
	result, err := client.Enroll(ctx, csrPEM)
	if err != nil {
		log.Fatalf("device-agent: enrollment failed: %v", err)
	}

	if err := os.WriteFile(filepath.Join(cfg.RuntimeDir, "device.crt"), result.CertificatePEM, 0o644); err != nil {
		log.Fatalf("device-agent: write certificate: %v", err)
	}
	if err := os.WriteFile(filepath.Join(cfg.RuntimeDir, "ca-chain.crt"), result.CAChainPEM, 0o644); err != nil {
		log.Fatalf("device-agent: write ca chain: %v", err)
	}
	log.Printf("device-agent: certificate issued (serial=%s, notAfter=%s)", result.SerialNumber, result.NotAfter)

	log.Print("device-agent: mTLS client not yet implemented")
}
