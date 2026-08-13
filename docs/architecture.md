# Architecture

## 1. Components

| Component | Technology | Responsibility |
|---|---|---|
| Device Agent | Go | Generates key/CSR, stores the issued certificate, connects through mTLS, sends heartbeat and telemetry |
| Security Gateway | Go | Terminates mTLS, extracts certificate identity, checks status and policy, proxies permitted requests, emits events |
| Management API | Java / Spring Boot | Manages devices, CSRs, certificates, roles, policies, and security events |
| Admin Console | React | Provides operational views and certificate/device administration |
| Database | PostgreSQL | Stores operational metadata and security events |
| Private CA | OpenSSL initially | Signs approved CSRs; CA private key is runtime-only |
| Backend Service | Minimal HTTP service | Demonstrates that only trusted requests cross the gateway |

## 2. Runtime flow

```text
Device Agent
    │ TLS 1.3 / mTLS
    ▼
Security Gateway ── device/certificate/policy lookup ──► Management API
    │                                                       │
    │ permitted request                                     ▼
    ▼                                                   PostgreSQL
Backend Service
    ▲
    └──────────── security decision/event ─────────────── Gateway

Administrator ── HTTPS ──► React Console ── REST ──► Management API
```

## 3. Trust boundaries

- The device network is untrusted.
- The gateway is the only entry point to the backend service.
- The management API and database belong to the trusted management network.
- The CA private key is more sensitive than ordinary application data and is isolated from source control and the browser.
- Identity received from a device request is ignored; identity is derived from the verified client certificate.

## 4. Gateway decision pipeline

1. Complete TLS handshake with a certificate issued by the configured CA.
2. Extract certificate serial number and device identity.
3. Reject invalid or expired certificate chains.
4. Query cached certificate/device status from the management API.
5. Reject unregistered, disabled, or revoked identities.
6. Evaluate role, HTTP method, and request path with default deny.
7. Forward the request and attach trusted internal identity headers.
8. Record the outcome and latency as a security event.

## 5. Repository layout

```text
certgate/
├─ device-agent/
├─ gateway/
├─ management-api/
├─ admin-console/
├─ backend-service/
├─ pki/
├─ infra/
├─ tests/e2e/
└─ docs/
```

## 6. Key constraint

Revocation in the MVP is enforced immediately after the TLS handshake and before backend forwarding. Native handshake-time CRL/OCSP validation is future work and must not be claimed as implemented.
