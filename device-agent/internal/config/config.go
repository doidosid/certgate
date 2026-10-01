// Package config loads and validates Device Agent runtime configuration from
// environment variables.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// defaultHeartbeatInterval is used when HEARTBEAT_INTERVAL is unset.
const defaultHeartbeatInterval = 30 * time.Second

// Config holds the environment-derived settings a Device Agent needs to
// enroll and connect through the Gateway.
type Config struct {
	DeviceKey         string
	ManagementAPIURL  string
	GatewayURL        string
	EnrollmentToken   string
	RuntimeDir        string
	HeartbeatInterval time.Duration
}

// Load reads Config from the process environment and validates it.
func Load() (Config, error) {
	cfg := Config{
		DeviceKey:        os.Getenv("DEVICE_KEY"),
		ManagementAPIURL: os.Getenv("MANAGEMENT_API_URL"),
		GatewayURL:       os.Getenv("GATEWAY_URL"),
		EnrollmentToken:  os.Getenv("DEVICE_ENROLLMENT_TOKEN"),
		RuntimeDir:       os.Getenv("DEVICE_RUNTIME_DIR"),
	}

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}

	interval, err := parseHeartbeatInterval(os.Getenv("HEARTBEAT_INTERVAL"))
	if err != nil {
		return Config{}, err
	}
	cfg.HeartbeatInterval = interval

	return cfg, nil
}

func parseHeartbeatInterval(raw string) (time.Duration, error) {
	if raw == "" {
		return defaultHeartbeatInterval, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("config: invalid HEARTBEAT_INTERVAL: %w", err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("config: invalid HEARTBEAT_INTERVAL: must be positive, got %s", raw)
	}
	return d, nil
}

func (c Config) validate() error {
	var missing []string
	if c.DeviceKey == "" {
		missing = append(missing, "DEVICE_KEY")
	}
	if c.ManagementAPIURL == "" {
		missing = append(missing, "MANAGEMENT_API_URL")
	}
	if c.GatewayURL == "" {
		missing = append(missing, "GATEWAY_URL")
	}
	// DEVICE_ENROLLMENT_TOKEN is intentionally not required here: a Device
	// with an already-usable certificate on disk never needs to enroll
	// again, so it must be able to start without a Token present. Whoever
	// actually attempts enrollment is responsible for requiring it then
	// (codexReview/feature-device-agent-mtls.md Medium finding).
	if c.RuntimeDir == "" {
		missing = append(missing, "DEVICE_RUNTIME_DIR")
	}
	if len(missing) > 0 {
		return fmt.Errorf("config: missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return nil
}
