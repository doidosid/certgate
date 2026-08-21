// Command gateway runs the CertGate Security Gateway.
package main

import (
	"context"
	"encoding/json"
	"errors"
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

// monitorCheckInterval is how often the Gateway inspects its own Outbox for
// the CRITICAL backlog and delay conditions (docs/security-design.md §9). It
// is well under the 60s delay threshold so a breach is noticed promptly, and
// the check itself is two counting queries against the local SQLite file.
const monitorCheckInterval = 10 * time.Second

// readinessPollInterval and readinessPingTimeout govern how often the
// Gateway checks Management API reachability for /readyz (Issue #36). The
// timeout is short so a hung Management API doesn't delay the next poll.
const readinessPollInterval = 10 * time.Second
const readinessPingTimeout = 3 * time.Second

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
	monitor := outbox.NewMonitor(store, outbox.DefaultBacklogThreshold, outbox.DefaultDelayThresholdSeconds)

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

	healthTracker := management.NewHealthTracker(mgmtClient)
	go healthTracker.Run(ctx, readinessPollInterval, readinessPingTimeout)

	go monitor.Run(ctx, monitorCheckInterval, logSystemEvent, func(err error) {
		// A CRITICAL Event that could not be stored gets the structured
		// Outbox-failure line docs/architecture.md "장애 원칙" requires; a read
		// failure is an operational problem with no Event behind it.
		var recordErr *outbox.RecordError
		if errors.As(err, &recordErr) {
			logOutboxFailure(time.Now(), recordErr.TraceID, recordErr.ReasonCode, recordErr.Err)
			return
		}
		log.Printf("gateway: outbox monitor error: %v", err)
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
	internalMux.HandleFunc("/readyz", readyzHandler(healthTracker))
	internalMux.HandleFunc("/internal/cache/invalidations", cacheInvalidationHandler(cfg.InternalToken, accessCache))
	internalMux.HandleFunc("/internal/outbox/stats", outboxStatsHandler(cfg.InternalToken, store))
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

// readyzHandler reports whether the Gateway can currently reach the
// Management API (Issue #36, docs/operations.md "Health"). Kept separate
// from healthzHandler: Compose's own healthcheck stays on /healthz so a
// transient Management API outage doesn't restart the Gateway Container and
// interrupt Outbox delivery (docs/architecture.md "장애 원칙" — Fail Closed
// is the correct response to that outage, not a Process restart).
func readyzHandler(tracker *management.HealthTracker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if tracker.Ready() {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "READY"})
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "NOT_READY"})
	}
}
