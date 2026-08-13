# Management API Draft

Base path: `/api/v1`

## Devices

| Method | Path | Purpose |
|---|---|---|
| POST | `/devices` | Register a device |
| GET | `/devices` | List and filter devices |
| GET | `/devices/{deviceId}` | Get device details |
| PATCH | `/devices/{deviceId}/status` | Enable or disable a device |
| PUT | `/devices/{deviceId}/role` | Assign a role |

## Certificate requests

| Method | Path | Purpose |
|---|---|---|
| POST | `/certificate-requests` | Submit a CSR for a registered device |
| GET | `/certificate-requests` | List pending and completed requests |
| POST | `/certificate-requests/{requestId}/approve` | Sign an approved CSR |
| POST | `/certificate-requests/{requestId}/reject` | Reject a CSR |
| GET | `/certificate-requests/{requestId}/certificate` | Download the issued certificate |

## Certificates

| Method | Path | Purpose |
|---|---|---|
| GET | `/certificates` | List certificates |
| GET | `/certificates/{certificateId}` | Get certificate metadata |
| POST | `/certificates/{certificateId}/revoke` | Revoke a certificate |

## Policies

| Method | Path | Purpose |
|---|---|---|
| GET | `/roles` | List roles and rules |
| GET | `/roles/{roleName}` | Read a role policy |
| PUT | `/roles/{roleName}` | Update a role policy (post-submission) |

## Security events

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/security-events` | Gateway submits an access decision |
| GET | `/security-events` | Search events by time, device, decision, or reason |
| GET | `/dashboard/summary` | Return console summary metrics |

## Gateway internal checks

| Method | Path | Purpose |
|---|---|---|
| GET | `/internal/access-context?serial={serial}` | Return device, certificate status, role, and rules |
| POST | `/internal/cache-invalidations` | Notify gateway after a relevant state change (optional MVP optimization) |

## Common error response

```json
{
  "code": "CERTIFICATE_REVOKED",
  "message": "The certificate is not trusted.",
  "traceId": "..."
}
```

The public management endpoints and gateway-internal endpoints must be separated by network configuration or service credentials before deployment.
