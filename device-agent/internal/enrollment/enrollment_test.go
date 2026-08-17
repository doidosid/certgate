package enrollment

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	c := NewClient(server.URL, "cg_enroll_test")
	c.PollInterval = time.Millisecond
	return c
}

func writeJSON(t *testing.T, w http.ResponseWriter, status int, body any) {
	t.Helper()
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		t.Fatalf("encode response: %v", err)
	}
}

func TestEnroll_Success(t *testing.T) {
	pollCount := 0

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer cg_enroll_test" {
			t.Errorf("Authorization header = %q", got)
		}

		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/enrollments/certificate-requests":
			writeJSON(t, w, http.StatusAccepted, map[string]any{
				"id": "req-1", "deviceId": "dev-1", "status": "PENDING", "requestedAt": "2026-08-13T05:40:00Z",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/enrollments/certificate-requests/req-1":
			pollCount++
			status := "PENDING"
			if pollCount >= 2 {
				status = "APPROVED"
			}
			writeJSON(t, w, http.StatusOK, map[string]any{"id": "req-1", "status": status})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/enrollments/certificate-requests/req-1/certificate":
			writeJSON(t, w, http.StatusOK, map[string]any{
				"certificatePem": "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----",
				"caChainPem":     "-----BEGIN CERTIFICATE-----chain-----END CERTIFICATE-----",
				"serialNumber":   "7F28A109",
				"notAfter":       "2026-09-12T05:45:00Z",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	})

	result, err := client.Enroll(context.Background(), []byte("csr"))
	if err != nil {
		t.Fatalf("Enroll() error = %v", err)
	}
	if string(result.CertificatePEM) != "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----" {
		t.Errorf("CertificatePEM = %q", result.CertificatePEM)
	}
	if result.SerialNumber != "7F28A109" {
		t.Errorf("SerialNumber = %q", result.SerialNumber)
	}
	wantNotAfter, _ := time.Parse(time.RFC3339, "2026-09-12T05:45:00Z")
	if !result.NotAfter.Equal(wantNotAfter) {
		t.Errorf("NotAfter = %v, want %v", result.NotAfter, wantNotAfter)
	}
	if pollCount < 2 {
		t.Errorf("pollCount = %d, want at least 2 (PENDING then APPROVED)", pollCount)
	}
}

func TestEnroll_InvalidToken(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusUnauthorized, map[string]any{
			"code": "ENROLLMENT_TOKEN_INVALID", "message": "invalid token", "traceId": "trace-1",
		})
	})

	_, err := client.Enroll(context.Background(), []byte("csr"))
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
	if got := err.Error(); !strings.Contains(got, "ENROLLMENT_TOKEN_INVALID") {
		t.Errorf("error = %q, want it to mention ENROLLMENT_TOKEN_INVALID", got)
	}
}

func TestEnroll_DuplicatePending(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusConflict, map[string]any{
			"code": "CERTIFICATE_REQUEST_ALREADY_PENDING", "message": "already pending", "traceId": "trace-2",
		})
	})

	_, err := client.Enroll(context.Background(), []byte("csr"))
	if err == nil {
		t.Fatal("expected error for duplicate pending request")
	}
	if !strings.Contains(err.Error(), "CERTIFICATE_REQUEST_ALREADY_PENDING") {
		t.Errorf("error = %q, want it to mention CERTIFICATE_REQUEST_ALREADY_PENDING", err.Error())
	}
}

func TestEnroll_Rejected(t *testing.T) {
	certificateRequested := false

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			writeJSON(t, w, http.StatusAccepted, map[string]any{"id": "req-1", "status": "PENDING"})
		case r.URL.Path == "/api/v1/enrollments/certificate-requests/req-1":
			writeJSON(t, w, http.StatusOK, map[string]any{"id": "req-1", "status": "REJECTED"})
		default:
			certificateRequested = true
			t.Fatalf("certificate should not be requested after rejection: %s", r.URL.Path)
		}
	})

	_, err := client.Enroll(context.Background(), []byte("csr"))
	if err == nil {
		t.Fatal("expected error for rejected request")
	}
	if certificateRequested {
		t.Error("certificate endpoint must not be called after rejection")
	}
}

func TestEnroll_ContextCancelledWhilePending(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			writeJSON(t, w, http.StatusAccepted, map[string]any{"id": "req-1", "status": "PENDING"})
		default:
			writeJSON(t, w, http.StatusOK, map[string]any{"id": "req-1", "status": "PENDING"})
		}
	})

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := client.Enroll(ctx, []byte("csr"))
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected context deadline error")
	}
	if elapsed > time.Second {
		t.Errorf("Enroll() took %v, want it to return promptly after context deadline", elapsed)
	}
}
