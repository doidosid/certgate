# Roadmap

Target submission date: **2026-08-23**

## Submission definition of done

The submission is ready when:

- A device generates a CSR and receives an approved certificate.
- A valid device completes mTLS and reaches the backend through the gateway.
- A missing, foreign-CA, expired, or revoked certificate cannot reach the backend.
- A valid but unauthorized device receives an access denial.
- Device, certificate, and security event data appear in the React console.
- Core scenarios are reproducible with documented commands or automated tests.
- README clearly separates implemented, in-progress, and planned features.
- No CA private key, device private key, credential, or personal data is committed.

## Phase 0 - Design

- Finalize requirements, architecture, security decisions, API, and data model
- Create ADRs for certificate identity and revocation caching
- Turn the design into GitHub issues

## Phase 1 - Vertical security slice

- Go device key/CSR generation
- Private CA bootstrap scripts
- Go gateway TLS 1.3 and mTLS
- Minimal backend service
- Valid and invalid certificate tests

## Phase 2 - Management plane

- Spring Boot project and PostgreSQL
- Device registration
- CSR approval and certificate issuance
- Certificate status and revocation
- Gateway access-context lookup
- Security event ingestion

## Phase 3 - Console

- Dashboard
- Devices
- Certificate Requests
- Certificates
- Security Events

## Phase 4 - Portfolio hardening

- Docker Compose
- End-to-end scenario script
- Packet capture and TLS failure analysis
- Screenshots and architecture diagram
- Implementation status, limitations, and design decisions
- AI-assisted development and verification log

## After submission

- Policy editing UI
- Cloud deployment and operational monitoring
- Rate limiting and performance testing
- CRL/OCSP
- Message signing and replay protection
- C++ test client or deeper Linux network-stack study

## Scope rule

Prefer one complete, demonstrable path over several disconnected features. Any incomplete feature must be labeled as in progress or planned.
