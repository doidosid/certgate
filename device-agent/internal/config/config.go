// Package config loads and validates Device Agent runtime configuration from
// environment variables.
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds the environment-derived settings a Device Agent needs to
// enroll and connect through the Gateway.
type Config struct {
	DeviceKey        string
	ManagementAPIURL string
	GatewayURL       string
	EnrollmentToken  string
	RuntimeDir       string
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
	return cfg, nil
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
	if c.EnrollmentToken == "" {
		missing = append(missing, "DEVICE_ENROLLMENT_TOKEN")
	}
	if c.RuntimeDir == "" {
		missing = append(missing, "DEVICE_RUNTIME_DIR")
	}
	if len(missing) > 0 {
		return fmt.Errorf("config: missing required environment variables: %s", strings.Join(missing, ", "))
	}
	return nil
}
