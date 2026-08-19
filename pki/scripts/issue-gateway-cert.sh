#!/usr/bin/env bash
# Issues the Gateway's own TLS server certificate, signed by the Intermediate CA
# produced by init-ca.sh (docs/security-design.md §3 "CA 계층"). The Root CA key
# is not read here -- only the Intermediate signs leaf certificates.
#
# Usage: issue-gateway-cert.sh [ca-dir]
#   ca-dir defaults to pki/runtime (git-ignored) and must already contain
#   root-ca.crt, intermediate-ca.crt and intermediate-ca.key. Outputs
#   gateway.crt and gateway.key into the same directory.
#
# Validity: GATEWAY_CERT_DAYS (default 365), clamped so the certificate never
# outlives the Intermediate CA. docs/adr/003-certificate-validity.md fixes
# Root CA (10y), Intermediate CA (3y) and Device Certificate (30d) but does not
# cover the Gateway's server certificate; it does require that "발급 인증서의
# 유효기간은 상위 CA의 남은 유효기간을 넘지 않는다", which the clamp enforces.
# The ADR also asks for defaults to be configurable so tests can use short
# expiries, hence the environment variable.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
CA_DIR="${1:-$SCRIPT_DIR/../runtime}"

GATEWAY_CERT_DAYS="${GATEWAY_CERT_DAYS:-365}"

# Every input is checked before anything is written. root-ca.crt is required
# too: the final chain verification needs it, and discovering that only after
# overwriting gateway.key would leave a new key beside the old certificate
# (Codex 리뷰 PR #35 Medium).
for required in root-ca.crt intermediate-ca.crt intermediate-ca.key; do
  if [ ! -s "$CA_DIR/$required" ]; then
    echo "error: $CA_DIR/$required not found. Run init-ca.sh first." >&2
    exit 1
  fi
done

# The Intermediate's certificate and key must belong together, or the signature
# below would be made by an unrelated key.
intermediate_cert_pub="$(openssl x509 -in "$CA_DIR/intermediate-ca.crt" -noout -pubkey)"
intermediate_key_pub="$(openssl pkey -in "$CA_DIR/intermediate-ca.key" -pubout)"
if [ "$intermediate_cert_pub" != "$intermediate_key_pub" ]; then
  echo "error: $CA_DIR/intermediate-ca.crt and intermediate-ca.key do not match." >&2
  exit 1
fi

intermediate_not_after="$(openssl x509 -in "$CA_DIR/intermediate-ca.crt" -noout -enddate | cut -d= -f2)"

if ! openssl x509 -in "$CA_DIR/intermediate-ca.crt" -noout -checkend 0; then
  echo "error: Intermediate CA expired on $intermediate_not_after. Re-run init-ca.sh." >&2
  exit 1
fi

# The common case -- a freshly initialized 3-year Intermediate against a 1-year
# request -- is answered by openssl alone, so no date(1) parsing happens at all.
# That matters for portability: GNU date and BSD/macOS date disagree on both the
# flag (-d vs -j -f) and the accepted input, and this script must run on both.
if ! openssl x509 -in "$CA_DIR/intermediate-ca.crt" -noout -checkend $(( GATEWAY_CERT_DAYS * 86400 )); then
  # Only the clamp path needs real arithmetic. GNU date(-d) first, then
  # BSD/macOS(-j -f): the wrong one must fail cleanly rather than return a value
  # that means something else.
  to_epoch() {
    date -u -d "$1" +%s 2>/dev/null || date -u -j -f "%b %e %T %Y %Z" "$1" +%s
  }
  intermediate_remaining_days=$(( ($(to_epoch "$intermediate_not_after") - $(date -u +%s)) / 86400 ))
  echo "note: clamping validity from ${GATEWAY_CERT_DAYS}d to the Intermediate CA's remaining ${intermediate_remaining_days}d"
  GATEWAY_CERT_DAYS="$intermediate_remaining_days"
fi

# Build into a temp directory and move into place only after every check passes,
# so a failure leaves the previous gateway.crt/key untouched instead of pairing a
# fresh key with a stale certificate.
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
umask 077

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out "$STAGE_DIR/gateway.key"

openssl req -new \
  -key "$STAGE_DIR/gateway.key" \
  -config "$CONFIG_DIR/gateway.cnf" \
  -out "$STAGE_DIR/gateway.csr"

# -copy_extensions is not used: the SAN comes from our own config, never from the
# CSR, so a CSR cannot smuggle in an extra name.
openssl x509 -req \
  -in "$STAGE_DIR/gateway.csr" \
  -CA "$CA_DIR/intermediate-ca.crt" -CAkey "$CA_DIR/intermediate-ca.key" \
  -CAcreateserial -CAserial "$STAGE_DIR/gateway.srl" \
  -extfile "$CONFIG_DIR/gateway.cnf" -extensions v3_gateway \
  -days "$GATEWAY_CERT_DAYS" \
  -out "$STAGE_DIR/gateway.crt"

# The certificate must chain to the Root through the Intermediate, and the key
# must belong to it, before either file is published.
openssl verify -CAfile "$CA_DIR/root-ca.crt" -untrusted "$CA_DIR/intermediate-ca.crt" \
  "$STAGE_DIR/gateway.crt" >/dev/null

cert_pub="$(openssl x509 -in "$STAGE_DIR/gateway.crt" -noout -pubkey)"
key_pub="$(openssl pkey -in "$STAGE_DIR/gateway.key" -pubout)"
if [ "$cert_pub" != "$key_pub" ]; then
  echo "error: issued certificate does not match the generated key." >&2
  exit 1
fi

mv "$STAGE_DIR/gateway.key" "$CA_DIR/gateway.key"
mv "$STAGE_DIR/gateway.crt" "$CA_DIR/gateway.crt"
chmod 600 "$CA_DIR/gateway.key"
chmod 644 "$CA_DIR/gateway.crt"

echo "Gateway server certificate issued in $CA_DIR (gateway.crt, gateway.key), valid ${GATEWAY_CERT_DAYS}d"
