#!/usr/bin/env bash
# Issues the Gateway's own TLS server certificate, signed by the Intermediate CA
# produced by init-ca.sh (docs/security-design.md §3 "CA 계층"). The Root CA key
# is not read here -- only the Intermediate signs leaf certificates.
#
# Usage: issue-gateway-cert.sh [ca-dir]
#   ca-dir defaults to pki/runtime (git-ignored) and must already contain
#   intermediate-ca.crt and intermediate-ca.key. Outputs gateway.crt and
#   gateway.key into the same directory.
#
# Validity is 1 year. docs/adr/003-certificate-validity.md fixes Root CA (10y),
# Intermediate CA (3y) and Device Certificate (30d) but does not cover the
# Gateway's server certificate; 1 year stays well inside the Intermediate's
# remaining lifetime, which the ADR does require ("발급 인증서의 유효기간은 상위
# CA의 남은 유효기간을 넘지 않는다").
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
CA_DIR="${1:-$SCRIPT_DIR/../runtime}"

GATEWAY_CERT_DAYS=365

for required in intermediate-ca.crt intermediate-ca.key; do
  if [ ! -s "$CA_DIR/$required" ]; then
    echo "error: $CA_DIR/$required not found. Run init-ca.sh first." >&2
    exit 1
  fi
done

umask 077

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out "$CA_DIR/gateway.key"

openssl req -new \
  -key "$CA_DIR/gateway.key" \
  -config "$CONFIG_DIR/gateway.cnf" \
  -out "$CA_DIR/gateway.csr"

# -copy_extensions is not used: the SAN comes from our own config, never from the
# CSR, so a CSR cannot smuggle in an extra name.
openssl x509 -req \
  -in "$CA_DIR/gateway.csr" \
  -CA "$CA_DIR/intermediate-ca.crt" -CAkey "$CA_DIR/intermediate-ca.key" -CAcreateserial \
  -extfile "$CONFIG_DIR/gateway.cnf" -extensions v3_gateway \
  -days "$GATEWAY_CERT_DAYS" \
  -out "$CA_DIR/gateway.crt"

rm -f "$CA_DIR/gateway.csr" "$CA_DIR"/*.srl
chmod 600 "$CA_DIR/gateway.key"
chmod 644 "$CA_DIR/gateway.crt"

# The Gateway certificate must chain to the Root through the Intermediate.
openssl verify -CAfile "$CA_DIR/root-ca.crt" -untrusted "$CA_DIR/intermediate-ca.crt" \
  "$CA_DIR/gateway.crt" >/dev/null

echo "Gateway server certificate issued in $CA_DIR (gateway.crt, gateway.key)"
