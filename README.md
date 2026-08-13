# CertGate

PKI-based device security gateway with mTLS, policy enforcement, and an operational management console.

> CertGate verifies device identity with X.509 certificates on an untrusted network and forwards only authenticated and authorized requests to an internal service.

## Planned stack

- Go: Device Agent and Security Gateway
- Java / Spring Boot: Management API
- React: Admin Console
- PostgreSQL: Device, certificate, policy, and security event metadata
- OpenSSL: Initial private CA workflow
- Docker Compose: Local integration environment

## Design documents

- [Requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Security design](docs/security-design.md)
- [Management API draft](docs/api-spec.md)
- [Data model draft](docs/data-model.md)
- [Roadmap](docs/roadmap.md)
- [AI-assisted development log](docs/ai-usage.md)

## Current status

**Design phase.** No implementation claims are made yet. The submission MVP will prioritize one complete path: CSR enrollment, certificate issuance, mTLS authentication, policy enforcement, backend forwarding, event recording, and management-console visibility.
