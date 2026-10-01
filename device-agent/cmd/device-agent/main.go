// Command device-agent runs the CertGate virtual Device client.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"tech.certgate/device-agent/internal/client"
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

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	id, err := identity.EnsureKey(cfg.RuntimeDir)
	if err != nil {
		log.Fatalf("device-agent: %v", err)
	}

	certPath := filepath.Join(cfg.RuntimeDir, identity.CertFileName)
	keyPath := filepath.Join(cfg.RuntimeDir, identity.KeyFileName)
	caChainPath := filepath.Join(cfg.RuntimeDir, identity.CAChainFileName)

	if id.HasValidCertificate(cfg.RuntimeDir, cfg.DeviceKey, time.Now()) {
		log.Print("device-agent: existing certificate is still valid, skipping enrollment")
	} else {
		if err := enrollAndPersist(ctx, cfg, id, certPath, caChainPath); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				log.Print("device-agent: shutting down before enrollment completed")
				return
			}
			log.Fatalf("device-agent: enrollment failed: %v", err)
		}
	}

	mtlsClient, err := client.NewClient(cfg.GatewayURL, certPath, keyPath, caChainPath)
	if err != nil {
		log.Fatalf("device-agent: %v", err)
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		mtlsClient.Run(ctx, cfg.HeartbeatInterval, func(err error) {
			if err != nil {
				log.Printf("device-agent: heartbeat failed: %v", err)
				return
			}
			log.Print("device-agent: heartbeat ok")
		})
	}()

	log.Printf("device-agent: running (gateway=%s, heartbeat every %s)", cfg.GatewayURL, cfg.HeartbeatInterval)
	<-ctx.Done()
	log.Print("device-agent: shutting down")
	wg.Wait()
}

// enrollAndPersist runs the CSR + enrollment flow and writes the issued
// certificate and CA chain to certPath/caChainPath.
func enrollAndPersist(ctx context.Context, cfg config.Config, id identity.Identity, certPath, caChainPath string) error {
	if cfg.EnrollmentToken == "" {
		return errors.New("enrollment required but DEVICE_ENROLLMENT_TOKEN is not set")
	}

	csrPEM, err := id.CreateCSR(cfg.DeviceKey)
	if err != nil {
		return err
	}
	log.Printf("device-agent: local key and CSR ready for SAN URI urn:certgate:device:%s", cfg.DeviceKey)

	enrollClient := enrollment.NewClient(cfg.ManagementAPIURL, cfg.EnrollmentToken)
	log.Print("device-agent: submitting CSR and waiting for administrator approval")
	result, err := enrollClient.Enroll(ctx, csrPEM)
	if err != nil {
		return err
	}

	if err := os.WriteFile(certPath, result.CertificatePEM, 0o644); err != nil {
		return fmt.Errorf("write certificate: %w", err)
	}
	if err := os.WriteFile(caChainPath, result.CAChainPEM, 0o644); err != nil {
		return fmt.Errorf("write ca chain: %w", err)
	}
	log.Printf("device-agent: certificate issued (serial=%s, notAfter=%s)", result.SerialNumber, result.NotAfter)
	return nil
}
