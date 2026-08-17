CREATE TABLE security_event (
    id                  UUID PRIMARY KEY,
    occurred_at         TIMESTAMPTZ NOT NULL,
    type                VARCHAR(16) NOT NULL,
    severity            VARCHAR(16) NOT NULL,
    device_id           UUID REFERENCES device (id),
    certificate_serial  VARCHAR(64),
    http_method         VARCHAR(10),
    request_path        VARCHAR(255),
    decision            VARCHAR(16) NOT NULL,
    reason_code         VARCHAR(64) NOT NULL,
    client_ip           VARCHAR(64),
    latency_ms          INTEGER,
    trace_id            VARCHAR(100) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_security_event_occurred_at ON security_event (occurred_at DESC);
CREATE INDEX idx_security_event_device_occurred_at ON security_event (device_id, occurred_at DESC);
CREATE INDEX idx_security_event_severity_occurred_at ON security_event (severity, occurred_at DESC);
CREATE INDEX idx_security_event_reason_code_occurred_at ON security_event (reason_code, occurred_at DESC);
