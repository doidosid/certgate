CREATE TABLE device (
    id            UUID PRIMARY KEY,
    device_key    VARCHAR(255) NOT NULL UNIQUE,
    name          VARCHAR(255) NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    role_name     VARCHAR(32) NOT NULL REFERENCES role (name),
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ
);
