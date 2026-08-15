package config

import "testing"

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

func TestLoad_MissingRequiredVars(t *testing.T) {
	required := []string{
		"DEVICE_KEY",
		"MANAGEMENT_API_URL",
		"GATEWAY_URL",
		"DEVICE_ENROLLMENT_TOKEN",
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
	t.Setenv("DEVICE_ENROLLMENT_TOKEN", "")

	_, err := Load()
	if err == nil {
		t.Fatal("expected error when DEVICE_ENROLLMENT_TOKEN is missing")
	}
	if err.Error() != "config: missing required environment variables: DEVICE_ENROLLMENT_TOKEN" {
		t.Errorf("error = %q, want only the variable name, no value", err.Error())
	}
}
