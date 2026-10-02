package config

import (
	"testing"
	"time"
)

func setValidEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DEVICE_KEY", "sensor-floor-01")
	t.Setenv("MANAGEMENT_API_URL", "http://management-api:8080")
	t.Setenv("GATEWAY_URL", "https://gateway:8443")
	t.Setenv("DEVICE_ENROLLMENT_TOKEN", "cg_enroll_test")
	t.Setenv("DEVICE_RUNTIME_DIR", "/tmp/certgate-device")
}

func TestLoad_Valid(t *testing.T) {
	setValidEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DeviceKey != "sensor-floor-01" {
		t.Errorf("DeviceKey = %q, want %q", cfg.DeviceKey, "sensor-floor-01")
	}
}

func TestLoad_HeartbeatIntervalDefaultsWhenUnset(t *testing.T) {
	setValidEnv(t)
	t.Setenv("HEARTBEAT_INTERVAL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HeartbeatInterval != defaultHeartbeatInterval {
		t.Errorf("HeartbeatInterval = %v, want default %v", cfg.HeartbeatInterval, defaultHeartbeatInterval)
	}
}

func TestLoad_HeartbeatIntervalParsesOverride(t *testing.T) {
	setValidEnv(t)
	t.Setenv("HEARTBEAT_INTERVAL", "5s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.HeartbeatInterval != 5*time.Second {
		t.Errorf("HeartbeatInterval = %v, want 5s", cfg.HeartbeatInterval)
	}
}

func TestLoad_HeartbeatIntervalRejectsInvalidDuration(t *testing.T) {
	setValidEnv(t)
	t.Setenv("HEARTBEAT_INTERVAL", "not-a-duration")

	if _, err := Load(); err == nil {
		t.Fatal("expected error for invalid HEARTBEAT_INTERVAL")
	}
}

func TestLoad_HeartbeatIntervalRejectsNonPositive(t *testing.T) {
	setValidEnv(t)
	t.Setenv("HEARTBEAT_INTERVAL", "0s")

	if _, err := Load(); err == nil {
		t.Fatal("expected error for non-positive HEARTBEAT_INTERVAL")
	}
}

func TestLoad_RejectsGatewayURLWithoutHTTPSScheme(t *testing.T) {
	setValidEnv(t)
	t.Setenv("GATEWAY_URL", "http://gateway:8443")

	if _, err := Load(); err == nil {
		t.Fatal("expected error for a non-https GATEWAY_URL")
	}
}

func TestLoad_RejectsGatewayURLWithoutHost(t *testing.T) {
	setValidEnv(t)
	t.Setenv("GATEWAY_URL", "https:///no-host")

	if _, err := Load(); err == nil {
		t.Fatal("expected error for a GATEWAY_URL with no host")
	}
}

func TestLoad_RejectsUnparseableGatewayURL(t *testing.T) {
	setValidEnv(t)
	// A raw control character makes url.Parse itself fail.
	t.Setenv("GATEWAY_URL", "https://gateway:8443/\x7f")

	if _, err := Load(); err == nil {
		t.Fatal("expected error for an unparseable GATEWAY_URL")
	}
}

func TestLoad_EnrollmentTokenNotRequired(t *testing.T) {
	// A Device that already has a usable certificate on disk never needs to
	// enroll again, so Load must not require a Token up front — only
	// whoever actually attempts enrollment does
	// (codexReview/feature-device-agent-mtls.md Medium finding).
	setValidEnv(t)
	t.Setenv("DEVICE_ENROLLMENT_TOKEN", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.EnrollmentToken != "" {
		t.Errorf("EnrollmentToken = %q, want empty", cfg.EnrollmentToken)
	}
}

func TestLoad_MissingRequiredVars(t *testing.T) {
	required := []string{
		"DEVICE_KEY",
		"MANAGEMENT_API_URL",
		"GATEWAY_URL",
		"DEVICE_RUNTIME_DIR",
	}

	for _, missingVar := range required {
		t.Run(missingVar, func(t *testing.T) {
			setValidEnv(t)
			t.Setenv(missingVar, "")

			_, err := Load()
			if err == nil {
				t.Fatalf("expected error when %s is missing", missingVar)
			}
		})
	}
}

func TestLoad_ErrorDoesNotLeakSecretValues(t *testing.T) {
	setValidEnv(t)
	t.Setenv("DEVICE_KEY", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when DEVICE_KEY is missing")
	}
	if err.Error() != "config: missing required environment variables: DEVICE_KEY" {
		t.Errorf("error = %q, want only the variable name, no value", err.Error())
	}
}
