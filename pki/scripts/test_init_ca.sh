#!/usr/bin/env bash
# Runnable check for init-ca.sh. Generates a fresh CA per run (pki/README.md)
# into a temp directory and verifies the chain, validity periods, extensions,
# key permissions, and that an unrelated CA's intermediate does NOT verify
# (the "다른 CA" rejection case from docs/testing.md Device Profile C).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() { echo "FAIL: $1"; exit 1; }

key_perm() {
  stat -f "%Lp" "$1" 2>/dev/null || stat -c "%a" "$1"
}

"$SCRIPT_DIR/init-ca.sh" "$WORK_DIR/ca-a" >/dev/null

for f in root-ca.key root-ca.crt intermediate-ca.key intermediate-ca.crt ca-chain.crt; do
  [ -s "$WORK_DIR/ca-a/$f" ] || fail "missing $f"
done

openssl verify -CAfile "$WORK_DIR/ca-a/root-ca.crt" "$WORK_DIR/ca-a/intermediate-ca.crt" >/dev/null \
  || fail "intermediate does not chain to its own root"

# Validity: root ~10y, intermediate ~3y (docs/adr/003-certificate-validity.md).
# checkend N returns 0 if the cert is still valid N seconds from now.
openssl x509 -in "$WORK_DIR/ca-a/root-ca.crt" -noout -checkend $(( (3650 - 1) * 86400 )) \
  || fail "root CA does not last ~10 years"
openssl x509 -in "$WORK_DIR/ca-a/root-ca.crt" -noout -checkend $(( (3650 + 5) * 86400 )) \
  && fail "root CA lasts longer than ~10 years"

openssl x509 -in "$WORK_DIR/ca-a/intermediate-ca.crt" -noout -checkend $(( (1095 - 1) * 86400 )) \
  || fail "intermediate CA does not last ~3 years"
openssl x509 -in "$WORK_DIR/ca-a/intermediate-ca.crt" -noout -checkend $(( (1095 + 5) * 86400 )) \
  && fail "intermediate CA lasts longer than ~3 years"

# Intermediate must be CA:TRUE, pathlen:0 (cannot sign further sub-CAs).
intermediate_text="$(openssl x509 -in "$WORK_DIR/ca-a/intermediate-ca.crt" -noout -text)"
echo "$intermediate_text" | grep -q "CA:TRUE" || fail "intermediate is not a CA"
echo "$intermediate_text" | grep -q "pathlen:0" || fail "intermediate is missing pathlen:0"

# Private keys must not be group/world readable.
[ "$(key_perm "$WORK_DIR/ca-a/root-ca.key")" = "600" ] || fail "root-ca.key is not 600"
[ "$(key_perm "$WORK_DIR/ca-a/intermediate-ca.key")" = "600" ] || fail "intermediate-ca.key is not 600"

# Failure path: an independent CA's root must NOT verify this intermediate.
"$SCRIPT_DIR/init-ca.sh" "$WORK_DIR/ca-b" >/dev/null
if openssl verify -CAfile "$WORK_DIR/ca-b/root-ca.crt" "$WORK_DIR/ca-a/intermediate-ca.crt" >/dev/null 2>&1; then
  fail "CA A's intermediate incorrectly verified against CA B's root"
fi

echo "PASS: init-ca.sh produces a valid, correctly-scoped 10y/3y CA chain"
