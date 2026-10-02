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

	log.Printf("device-agent: state=%s starting for device %s (management-api=%s)", client.StateStarting, cfg.DeviceKey, cfg.ManagementAPIURL)

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
		mtlsClient.Run(ctx, cfg.HeartbeatInterval, func(state client.State, err error) {
			switch state {
			case client.StateRunning:
				log.Printf("device-agent: state=%s heartbeat ok", state)
			case client.StateRetrying:
				log.Printf("device-agent: state=%s heartbeat retrying after failure: %v", state, err)
			case client.StateAuthFailed:
				log.Printf("device-agent: state=%s heartbeat stopped, authentication failed: %v", state, err)
			case client.StateReenrollRequired:
				log.Printf("device-agent: state=%s heartbeat stopped, certificate no longer usable: %v", state, err)
			case client.StateStopping:
				// Shutdown is already logged below once Run returns.
			}
		})
	}()

	// Not state=RUNNING here: that would claim success before the first
	// Heartbeat attempt has even run. The Run callback reports the real
	// first transition (codexReview/PR-69.md Low finding).
	log.Printf("device-agent: gateway=%s heartbeat_interval=%s starting heartbeat loop", cfg.GatewayURL, cfg.HeartbeatInterval)
	<-ctx.Done()
	log.Printf("device-agent: state=%s shutting down", client.StateStopping)
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
	log.Printf("device-agent: state=%s submitting CSR and waiting for administrator approval", client.StateEnrolling)
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
