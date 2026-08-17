CREATE TABLE certificate_request (
    id                       UUID PRIMARY KEY,
    device_id                UUID NOT NULL REFERENCES device (id),
    enrollment_credential_id UUID NOT NULL REFERENCES enrollment_credential (id),
    csr_pem                  TEXT NOT NULL,
    subject_dn               VARCHAR(255),
    san_uri                  VARCHAR(255),
    public_key_algorithm     VARCHAR(64),
    fingerprint_sha256       VARCHAR(64),
    status                   VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    requested_at             TIMESTAMPTZ NOT NULL,
    decided_at               TIMESTAMPTZ,
    decision_note            VARCHAR(500)
);

CREATE INDEX idx_certificate_request_status_requested ON certificate_request (status, requested_at);
CREATE INDEX idx_certificate_request_device_requested ON certificate_request (device_id, requested_at);

-- 같은 Device의 PENDING 요청은 하나만 허용한다.
CREATE UNIQUE INDEX idx_certificate_request_pending_per_device
    ON certificate_request (device_id)
    WHERE status = 'PENDING';
