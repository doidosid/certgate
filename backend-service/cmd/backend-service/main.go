// Command backend-service is the minimal internal HTTP service that
// verifies only Gateway-allowed requests arrive, and echoes back the
// trusted identity headers the Gateway injected.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

const (
	headerDeviceKey = "X-CertGate-Device-Key"
	headerRole      = "X-CertGate-Role"
)

func main() {
	port := os.Getenv("BACKEND_SERVICE_PORT")
	if port == "" {
		port = "8090"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/heartbeat", handleTrustedEcho)
	mux.HandleFunc("/telemetry", handleTrustedEcho)
	mux.HandleFunc("/commands", handleTrustedEcho)

	log.Printf("backend-service: listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("backend-service: server error: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "UP"})
}

// handleTrustedEcho returns the Gateway-injected identity headers so tests
// can confirm only Gateway-authenticated requests reach this service with
// the expected trusted identity.
func handleTrustedEcho(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"deviceKey": r.Header.Get(headerDeviceKey),
		"role":      r.Header.Get(headerRole),
	})
}
