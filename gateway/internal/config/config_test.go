package config

import "testing"

func setValidEnv(t *testing.T) {
	t.Helper()
	t.Setenv("GATEWAY_MTLS_PORT", "8443")
	t.Setenv("GATEWAY_INTERNAL_PORT", "8081")
	t.Setenv("MANAGEMENT_API_URL", "http://management-api:8080")
	t.Setenv("BACKEND_SERVICE_URL", "http://backend-service:8090")
	t.Setenv("GATEWAY_SERVICE_TOKEN", "local-dev-gateway-token-change-me")
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "local-dev-internal-token-change-me")
	t.Setenv("GATEWAY_ACCESS_CACHE_TTL_SECONDS", "30")
	t.Setenv("GATEWAY_OUTBOX_PATH", "/data/outbox.db")
	t.Setenv("GATEWAY_EVENT_BATCH_SIZE", "50")
	t.Setenv("GATEWAY_EVENT_RETRY_MAX_SECONDS", "60")
	t.Setenv("ROOT_CA_CERT_PATH", "/run/certgate/root-ca.crt")
	t.Setenv("GATEWAY_SERVER_CERT_PATH", "/run/certgate/gateway.crt")
	t.Setenv("GATEWAY_SERVER_KEY_PATH", "/run/certgate/gateway.key")
}

func TestLoad_Valid(t *testing.T) {
	setValidEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AccessCacheTTLSeconds != 30 {
		t.Errorf("AccessCacheTTLSeconds = %d, want 30", cfg.AccessCacheTTLSeconds)
	}
	if cfg.EventBatchSize != 50 {
		t.Errorf("EventBatchSize = %d, want 50", cfg.EventBatchSize)
	}
	if cfg.EventRetryMaxSeconds != 60 {
		t.Errorf("EventRetryMaxSeconds = %d, want 60", cfg.EventRetryMaxSeconds)
	}
}

func TestLoad_MissingRequiredVars(t *testing.T) {
	required := []string{
		"GATEWAY_MTLS_PORT",
		"GATEWAY_INTERNAL_PORT",
		"MANAGEMENT_API_URL",
		"BACKEND_SERVICE_URL",
		"GATEWAY_SERVICE_TOKEN",
		"GATEWAY_INTERNAL_TOKEN",
		"GATEWAY_OUTBOX_PATH",
		"ROOT_CA_CERT_PATH",
		"GATEWAY_SERVER_CERT_PATH",
		"GATEWAY_SERVER_KEY_PATH",
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

func TestLoad_InvalidNumericVars(t *testing.T) {
	cases := []struct {
		name  string
		env   string
		value string
	}{
		{"TTL not a number", "GATEWAY_ACCESS_CACHE_TTL_SECONDS", "not-a-number"},
		{"TTL zero", "GATEWAY_ACCESS_CACHE_TTL_SECONDS", "0"},
		{"TTL negative", "GATEWAY_ACCESS_CACHE_TTL_SECONDS", "-1"},
		{"batch size zero", "GATEWAY_EVENT_BATCH_SIZE", "0"},
		{"batch size negative", "GATEWAY_EVENT_BATCH_SIZE", "-5"},
		{"retry max not a number", "GATEWAY_EVENT_RETRY_MAX_SECONDS", "soon"},
		{"retry max zero", "GATEWAY_EVENT_RETRY_MAX_SECONDS", "0"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setValidEnv(t)
			t.Setenv(tc.env, tc.value)

			_, err := Load()
			if err == nil {
				t.Fatalf("expected error for %s=%q", tc.env, tc.value)
			}
		})
	}
}
