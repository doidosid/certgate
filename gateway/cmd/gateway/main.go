// Command gateway runs the CertGate Security Gateway.
package main

import (
	"encoding/json"
	"log"
	"net/http"

	"tech.certgate/gateway/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("gateway: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", healthzHandler)

	log.Printf("gateway: internal API listening on :%s (mTLS listener not yet implemented, Foundation stage)", cfg.InternalPort)
	if err := http.ListenAndServe(":"+cfg.InternalPort, mux); err != nil {
		log.Fatalf("gateway: internal server error: %v", err)
	}
}

func healthzHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "UP"})
}
