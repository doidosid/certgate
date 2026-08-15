package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	handleHealth(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestHandleTrustedEcho_ReflectsGatewayHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/telemetry", nil)
	req.Header.Set(headerDeviceKey, "sensor-floor-01")
	req.Header.Set(headerRole, "SENSOR")
	rec := httptest.NewRecorder()

	handleTrustedEcho(rec, req)

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["deviceKey"] != "sensor-floor-01" || body["role"] != "SENSOR" {
		t.Errorf("body = %+v, want deviceKey=sensor-floor-01 role=SENSOR", body)
	}
}

func TestHandleTrustedEcho_NoHeaderWhenAbsent(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/heartbeat", nil)
	rec := httptest.NewRecorder()

	handleTrustedEcho(rec, req)

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["deviceKey"] != "" {
		t.Errorf("deviceKey = %q, want empty when Gateway did not set it", body["deviceKey"])
	}
}
