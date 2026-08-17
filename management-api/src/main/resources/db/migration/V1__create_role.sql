CREATE TABLE role (
    name        VARCHAR(32) PRIMARY KEY,
    description VARCHAR(255) NOT NULL
);

INSERT INTO role (name, description) VALUES
    ('SENSOR', 'POST /telemetry, POST /heartbeat 허용'),
    ('OPERATOR', 'SENSOR 권한 + GET /commands 허용');
