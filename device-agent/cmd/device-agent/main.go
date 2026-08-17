// Command device-agent runs the CertGate virtual Device client.
package main

import (
	"log"

	"tech.certgate/device-agent/internal/config"
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
	if _, err := id.CreateCSR(cfg.DeviceKey); err != nil {
		log.Fatalf("device-agent: %v", err)
	}
	log.Printf("device-agent: local key and CSR ready for SAN URI urn:certgate:device:%s", cfg.DeviceKey)

	log.Print("device-agent: enrollment submission and mTLS client not yet implemented")
}
