# Security Design

## 1. Certificate lifecycle

```text
PENDING ── approve/sign ──► VALID ── revoke ──► REVOKED
    └────── reject ───────► REJECTED
VALID ── validity period elapsed ──► EXPIRED
```

Certificate states:

- **PENDING**: CSR submitted and awaiting an administrative decision
- **VALID**: issued and available for authentication
- **EXPIRED**: validity period has elapsed
- **REVOKED**: trust was explicitly withdrawn
- **REJECTED**: CSR issuance request was denied

## 2. Enrollment

1. A device creates its private key locally.
2. The device creates a CSR containing its assigned device identity.
3. The CSR is submitted to the management API.
4. An administrator verifies and approves or rejects it.
5. On approval, the server signs the CSR through the private CA.
6. Only the certificate and CA chain are returned. The device private key never leaves the device.

## 3. Authentication

- Gateway accepts TLS 1.3 with mandatory client certificates.
- The configured private CA is the trust anchor.
- Device identity is mapped from an agreed certificate field and verified against registration data.
- Exact identity mapping (SAN URI preferred; Common Name fallback only for MVP) will be recorded as an ADR before implementation.

## 4. Revocation

MVP revocation uses the management database:

1. Administrator changes certificate state to `REVOKED`.
2. Gateway checks the certificate serial number after the TLS handshake.
3. Gateway denies forwarding and records `CERTIFICATE_REVOKED`.
4. Gateway uses a short TTL status cache; a revocation operation invalidates the relevant cache entry.

CRL and OCSP remain explicitly out of scope for the initial submission.

## 5. Authorization

Authorization uses role-based method/path rules.

| Role | Allowed operations |
|---|---|
| SENSOR | `POST /telemetry`, `POST /heartbeat` |
| OPERATOR | SENSOR operations plus `GET /commands` |
| ADMIN_DEVICE | Reserved device administration operations |

Rules:

- Default decision is **DENY**.
- A successful mTLS authentication does not imply authorization.
- Policy matching uses normalized HTTP methods and paths.
- The gateway, not the device, supplies trusted identity headers to the backend.

## 6. Security event reason codes

- `CERTIFICATE_REQUIRED`
- `INVALID_CERTIFICATE`
- `CERTIFICATE_EXPIRED`
- `CERTIFICATE_REVOKED`
- `DEVICE_NOT_REGISTERED`
- `DEVICE_DISABLED`
- `ACCESS_DENIED`
- `REQUEST_ALLOWED`
- `INTERNAL_ERROR`

Each event records timestamp, device ID when known, certificate serial number, method, path, decision, reason, client IP, and processing time.

## 7. Security limitations

The project does not claim production CA security. CA key protection, audit integrity, distributed revocation, certificate renewal, rate limiting, replay protection, and HA are documented future improvements.
