// Package config loads and validates Gateway runtime configuration from
// environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds the environment-derived settings the Gateway needs to serve
// mTLS traffic, reach the Management API, and persist Security Events.
type Config struct {
	MTLSPort              string
	InternalPort          string
	ManagementAPIURL      string
	BackendServiceURL     string
	ServiceToken          string
	InternalToken         string
	AccessCacheTTLSeconds int
	OutboxPath            string
	EventBatchSize        int
	EventRetryMaxSeconds  int
	RootCACertPath        string
	ServerCertPath        string
	ServerKeyPath         string
}

// Load reads Config from the process environment and validates it.
func Load() (Config, error) {
	ttl, ttlErr := parsePositiveInt("GATEWAY_ACCESS_CACHE_TTL_SECONDS")
	batchSize, batchErr := parsePositiveInt("GATEWAY_EVENT_BATCH_SIZE")
	retryMax, retryErr := parsePositiveInt("GATEWAY_EVENT_RETRY_MAX_SECONDS")

	cfg := Config{
		MTLSPort:              os.Getenv("GATEWAY_MTLS_PORT"),
		InternalPort:          os.Getenv("GATEWAY_INTERNAL_PORT"),
		ManagementAPIURL:      os.Getenv("MANAGEMENT_API_URL"),
		BackendServiceURL:     os.Getenv("BACKEND_SERVICE_URL"),
		ServiceToken:          os.Getenv("GATEWAY_SERVICE_TOKEN"),
		InternalToken:         os.Getenv("GATEWAY_INTERNAL_TOKEN"),
		AccessCacheTTLSeconds: ttl,
		OutboxPath:            os.Getenv("GATEWAY_OUTBOX_PATH"),
		EventBatchSize:        batchSize,
		EventRetryMaxSeconds:  retryMax,
		RootCACertPath:        os.Getenv("ROOT_CA_CERT_PATH"),
		ServerCertPath:        os.Getenv("GATEWAY_SERVER_CERT_PATH"),
		ServerKeyPath:         os.Getenv("GATEWAY_SERVER_KEY_PATH"),
	}

	if err := cfg.validate(ttlErr, batchErr, retryErr); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func parsePositiveInt(envVar string) (int, error) {
	value, err := strconv.Atoi(os.Getenv(envVar))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", envVar, err)
	}
	if value <= 0 {
		return 0, fmt.Errorf("%s: must be a positive integer, got %d", envVar, value)
	}
	return value, nil
}

func (c Config) validate(ttlErr, batchErr, retryErr error) error {
	var missing []string
	if c.MTLSPort == "" {
		missing = append(missing, "GATEWAY_MTLS_PORT")
	}
	if c.InternalPort == "" {
		missing = append(missing, "GATEWAY_INTERNAL_PORT")
	}
	if c.ManagementAPIURL == "" {
		missing = append(missing, "MANAGEMENT_API_URL")
	}
	if c.BackendServiceURL == "" {
		missing = append(missing, "BACKEND_SERVICE_URL")
	}
	if c.ServiceToken == "" {
		missing = append(missing, "GATEWAY_SERVICE_TOKEN")
	}
	if c.InternalToken == "" {
		missing = append(missing, "GATEWAY_INTERNAL_TOKEN")
	}
	if c.OutboxPath == "" {
		missing = append(missing, "GATEWAY_OUTBOX_PATH")
	}
	if c.RootCACertPath == "" {
		missing = append(missing, "ROOT_CA_CERT_PATH")
	}
	if c.ServerCertPath == "" {
		missing = append(missing, "GATEWAY_SERVER_CERT_PATH")
	}
	if c.ServerKeyPath == "" {
		missing = append(missing, "GATEWAY_SERVER_KEY_PATH")
	}
	if len(missing) > 0 {
		return fmt.Errorf("config: missing required environment variables: %s", strings.Join(missing, ", "))
	}

	for _, err := range []error{ttlErr, batchErr, retryErr} {
		if err != nil {
			return fmt.Errorf("config: invalid environment variable: %w", err)
		}
	}
	return nil
}
