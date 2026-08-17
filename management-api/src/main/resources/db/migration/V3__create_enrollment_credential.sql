CREATE TABLE enrollment_credential (
    id            UUID PRIMARY KEY,
    device_id     UUID NOT NULL REFERENCES device (id),
    token_hash    VARCHAR(64) NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL,
    last_used_at  TIMESTAMPTZ
);

CREATE INDEX idx_enrollment_credential_device_expires ON enrollment_credential (device_id, expires_at);

-- ADR-005: Device당 활성(미폐기) Enrollment Credential은 하나만 허용한다.
CREATE UNIQUE INDEX idx_enrollment_credential_active_per_device
    ON enrollment_credential (device_id)
    WHERE revoked_at IS NULL;
