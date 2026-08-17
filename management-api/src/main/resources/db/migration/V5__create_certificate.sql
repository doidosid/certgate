CREATE TABLE certificate (
    id                  UUID PRIMARY KEY,
    device_id           UUID NOT NULL REFERENCES device (id),
    request_id          UUID NOT NULL UNIQUE REFERENCES certificate_request (id),
    serial_number       VARCHAR(64) NOT NULL UNIQUE,
    certificate_pem     TEXT NOT NULL,
    subject_dn          VARCHAR(255),
    san_uri             VARCHAR(255),
    fingerprint_sha256  VARCHAR(64) NOT NULL UNIQUE,
    not_before          TIMESTAMPTZ NOT NULL,
    not_after           TIMESTAMPTZ NOT NULL,
    issued_at           TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    revocation_reason   VARCHAR(64),
    revocation_note     VARCHAR(500)
);

CREATE INDEX idx_certificate_device_not_after ON certificate (device_id, not_after);
