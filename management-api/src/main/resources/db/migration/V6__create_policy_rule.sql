CREATE TABLE policy_rule (
    id           UUID PRIMARY KEY,
    role_name    VARCHAR(32) NOT NULL REFERENCES role (name),
    http_method  VARCHAR(10) NOT NULL,
    path_pattern VARCHAR(255) NOT NULL,
    effect       VARCHAR(10) NOT NULL,
    priority     INTEGER NOT NULL,
    UNIQUE (role_name, http_method, path_pattern)
);

-- Matches V1__create_role.sql's role descriptions and docs/api-spec.md §6.
INSERT INTO policy_rule (id, role_name, http_method, path_pattern, effect, priority) VALUES
    (gen_random_uuid(), 'SENSOR', 'POST', '/telemetry', 'ALLOW', 10),
    (gen_random_uuid(), 'SENSOR', 'POST', '/heartbeat', 'ALLOW', 20),
    (gen_random_uuid(), 'OPERATOR', 'POST', '/telemetry', 'ALLOW', 10),
    (gen_random_uuid(), 'OPERATOR', 'POST', '/heartbeat', 'ALLOW', 20),
    (gen_random_uuid(), 'OPERATOR', 'GET', '/commands', 'ALLOW', 30);
