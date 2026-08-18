// Command gateway runs the CertGate Security Gateway.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tech.certgate/gateway/internal/access"
	"tech.certgate/gateway/internal/config"
	"tech.certgate/gateway/internal/management"
	"tech.certgate/gateway/internal/outbox"
	"tech.certgate/gateway/internal/proxy"
	"tech.certgate/gateway/internal/tlsauth"

	"net/http"
)

// senderFlushInterval is how often the Outbox Sender retries due Security
// Events. There is no dedicated environment variable for this — only the
// batch size and the maximum backoff interval are configurable
// (docs/operations.md "Event Outbox").
const senderFlushInterval = 2 * time.Second

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("gateway: %v", err)
	}

	store, err := outbox.Open(cfg.OutboxPath)
	if err != nil {
		log.Fatalf("gateway: %v", err)
	}
	defer store.Close()

	mgmtClient := management.NewClient(cfg.ManagementAPIURL, cfg.ServiceToken)
	accessCache := access.New(mgmtClient, time.Duration(cfg.AccessCacheTTLSeconds)*time.Second, nil)
	sender := outbox.NewSender(store, mgmtClient, cfg.EventBatchSize, cfg.EventRetryMaxSeconds)

	backendURL, err := url.Parse(cfg.BackendServiceURL)
	if err != nil {
		log.Fatalf("gateway: invalid BACKEND_SERVICE_URL: %v", err)
	}

	tlsConfig, err := tlsauth.ServerConfig(cfg.ServerCertPath, cfg.ServerKeyPath, cfg.RootCACertPath)
	if err != nil {
		log.Fatalf("gateway: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go sender.Run(ctx, senderFlushInterval, func(err error) {
		log.Printf("gateway: outbox send error: %v", err)
	})

	h := &accessHandler{
		access: accessCache,
		store:  store,
		proxy:  proxy.NewReverseProxy(backendURL),
	}
	h.proxy.ErrorHandler = h.backendErrorHandler

	mtlsServer := &http.Server{
		Addr:      ":" + cfg.MTLSPort,
		Handler:   h,
		TLSConfig: tlsConfig,
		ErrorLog:  log.New(os.Stderr, "gateway: tls handshake: ", log.LstdFlags),
	}

	internalMux := http.NewServeMux()
	internalMux.HandleFunc("/healthz", healthzHandler)
	internalMux.HandleFunc("/internal/cache/invalidations", cacheInvalidationHandler(cfg.InternalToken, accessCache))
	internalServer := &http.Server{Addr: ":" + cfg.InternalPort, Handler: internalMux}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = mtlsServer.Shutdown(shutdownCtx)
		_ = internalServer.Shutdown(shutdownCtx)
	}()

	go func() {
		log.Printf("gateway: internal API listening on :%s", cfg.InternalPort)
		if err := internalServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("gateway: internal server error: %v", err)
		}
	}()

	log.Printf("gateway: mTLS listening on :%s (backend=%s)", cfg.MTLSPort, cfg.BackendServiceURL)
	if err := mtlsServer.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		log.Fatalf("gateway: mTLS server error: %v", err)
	}
}

func healthzHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "UP"})
}
