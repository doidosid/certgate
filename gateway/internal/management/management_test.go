package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tech.certgate/gateway/internal/event"
)

func TestGetAccessContext_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/access-context" {
			t.Errorf("path = %s, want /internal/access-context", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("Authorization = %q, want Bearer test-token", got)
		}
		if got := r.URL.Query().Get("serialNumber"); got != "7F28A109" {
			t.Errorf("serialNumber = %q, want 7F28A109", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(AccessContext{
			CertificateID: "cert-1", SerialNumber: "7F28A109", CertificateStatus: "VALID",
			DeviceID: "device-1", DeviceKey: "sensor-floor-01", DeviceStatus: "ACTIVE",
			RoleName: "SENSOR",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	got, err := client.GetAccessContext(context.Background(), "7F28A109")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.DeviceKey != "sensor-floor-01" || got.RoleName != "SENSOR" {
		t.Errorf("got %+v", got)
	}
}

func TestGetAccessContext_NotFoundReturnsAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(APIError{Code: "CERTIFICATE_NOT_FOUND", Message: "no such certificate", TraceID: "trace-1"})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	_, err := client.GetAccessContext(context.Background(), "unknown")
	if err == nil {
		t.Fatal("expected an error")
	}
	apiErr, ok := err.(APIError)
	if !ok {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != "CERTIFICATE_NOT_FOUND" {
		t.Errorf("Code = %s, want CERTIFICATE_NOT_FOUND", apiErr.Code)
	}
}

func TestGetAccessContext_ServiceTokenInvalid(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(APIError{Code: "SERVICE_TOKEN_INVALID", Message: "invalid", TraceID: "trace-2"})
	}))
	defer server.Close()

	client := NewClient(server.URL, "wrong-token")
	_, err := client.GetAccessContext(context.Background(), "7F28A109")
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestPostSecurityEvents_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/security-events/batch" {
			t.Errorf("path = %s, want /internal/security-events/batch", r.URL.Path)
		}
		var body struct {
			Events []event.Event `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if len(body.Events) != 1 || body.Events[0].ReasonCode != event.ReasonRequestAllowed {
			t.Errorf("unexpected events payload: %+v", body.Events)
		}
		_ = json.NewEncoder(w).Encode(BatchResult{AcceptedCount: 1, DuplicateCount: 0})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	evt := event.New(event.Params{Now: time.Now(), ReasonCode: event.ReasonRequestAllowed, TraceID: "t1"})
	result, err := client.PostSecurityEvents(context.Background(), []event.Event{evt})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.AcceptedCount != 1 {
		t.Errorf("AcceptedCount = %d, want 1", result.AcceptedCount)
	}
}

func TestPostSecurityEvents_BatchRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(APIError{Code: "SECURITY_EVENT_INVALID", Message: "missing field", TraceID: "trace-3"})
	}))
	defer server.Close()

	client := NewClient(server.URL, "test-token")
	evt := event.New(event.Params{Now: time.Now(), ReasonCode: event.ReasonRequestAllowed, TraceID: "t1"})
	_, err := client.PostSecurityEvents(context.Background(), []event.Event{evt})
	if err == nil {
		t.Fatal("expected an error")
	}
}
