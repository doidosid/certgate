// Command device-agent runs the CertGate virtual Device client.
package main

import (
	"log"

	"tech.certgate/device-agent/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("device-agent: %v", err)
	}

	log.Printf("device-agent: starting for device %s (management-api=%s)", cfg.DeviceKey, cfg.ManagementAPIURL)
	log.Print("device-agent: enrollment and mTLS client not yet implemented (Foundation stage)")
}
