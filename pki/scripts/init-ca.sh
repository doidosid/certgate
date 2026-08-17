#!/usr/bin/env bash
# Initializes the CertGate Root CA and Intermediate CA (docs/adr/002-ca-hierarchy.md,
# docs/adr/003-certificate-validity.md). Root CA key is used only to sign the
# Intermediate CA and is never touched again after this script runs.
#
# Usage: init-ca.sh [output-dir]
#   output-dir defaults to pki/runtime (git-ignored). Re-run against a fresh
#   directory each time -- an existing CA is not reused or renewed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
OUT_DIR="${1:-$SCRIPT_DIR/../runtime}"

ROOT_CA_DAYS=3650
INTERMEDIATE_CA_DAYS=1095

mkdir -p "$OUT_DIR"
umask 077

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out "$OUT_DIR/root-ca.key"

openssl req -x509 -new \
  -key "$OUT_DIR/root-ca.key" \
  -config "$CONFIG_DIR/root-ca.cnf" -extensions v3_ca \
  -days "$ROOT_CA_DAYS" \
  -out "$OUT_DIR/root-ca.crt"

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out "$OUT_DIR/intermediate-ca.key"

openssl req -new \
  -key "$OUT_DIR/intermediate-ca.key" \
  -config "$CONFIG_DIR/intermediate-ca.cnf" \
  -out "$OUT_DIR/intermediate-ca.csr"

openssl x509 -req \
  -in "$OUT_DIR/intermediate-ca.csr" \
  -CA "$OUT_DIR/root-ca.crt" -CAkey "$OUT_DIR/root-ca.key" -CAcreateserial \
  -extfile "$CONFIG_DIR/intermediate-ca.cnf" -extensions v3_intermediate_ca \
  -days "$INTERMEDIATE_CA_DAYS" \
  -out "$OUT_DIR/intermediate-ca.crt"

cat "$OUT_DIR/intermediate-ca.crt" "$OUT_DIR/root-ca.crt" > "$OUT_DIR/ca-chain.crt"

rm -f "$OUT_DIR/intermediate-ca.csr" "$OUT_DIR"/*.srl
chmod 600 "$OUT_DIR"/*.key

openssl verify -CAfile "$OUT_DIR/root-ca.crt" "$OUT_DIR/intermediate-ca.crt" >/dev/null

echo "CA initialized in $OUT_DIR (root-ca.crt, intermediate-ca.crt, intermediate-ca.key, ca-chain.crt)"
