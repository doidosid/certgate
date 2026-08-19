#!/usr/bin/env bash
# Runnable check for issue-gateway-cert.sh. Generates a fresh CA and Gateway
# certificate per run (pki/README.md) into a temp directory and verifies the
# chain, SANs, extensions, key permissions, and the failure paths that matter:
# a missing CA, and another CA's root rejecting this certificate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

fail() { echo "FAIL: $1"; exit 1; }

key_perm() {
  stat -f "%Lp" "$1" 2>/dev/null || stat -c "%a" "$1"
}

# Windows (Git Bash/MSYS) does not implement Unix permission bits: chmod 600
# reads back as 644. The assertion is only meaningful on Unix, which is where it
# matters anyway -- CI runs on ubuntu-latest and the services run in Linux
# containers. Skipping keeps the rest of the check runnable on a Windows dev box.
assert_key_perm() {
  case "$(uname -s)" in
    Linux | Darwin)
      [ "$(key_perm "$1")" = "600" ] || fail "$(basename "$1") is not 600"
      ;;
    *)
      echo "SKIP: $(basename "$1") permission check (not meaningful on $(uname -s))"
      ;;
  esac
}

"$SCRIPT_DIR/init-ca.sh" "$WORK_DIR/ca-a" >/dev/null
"$SCRIPT_DIR/issue-gateway-cert.sh" "$WORK_DIR/ca-a" >/dev/null

for f in gateway.key gateway.crt; do
  [ -s "$WORK_DIR/ca-a/$f" ] || fail "missing $f"
done

# The Gateway certificate must chain to the Root only through the Intermediate.
openssl verify -CAfile "$WORK_DIR/ca-a/root-ca.crt" -untrusted "$WORK_DIR/ca-a/intermediate-ca.crt" \
  "$WORK_DIR/ca-a/gateway.crt" >/dev/null \
  || fail "gateway certificate does not chain to its own root via the intermediate"

# ...and must NOT verify against the Root alone, which proves it is a leaf under
# the Intermediate rather than something the Root signed directly.
if openssl verify -CAfile "$WORK_DIR/ca-a/root-ca.crt" "$WORK_DIR/ca-a/gateway.crt" >/dev/null 2>&1; then
  fail "gateway certificate verified without the intermediate; it is not signed by the Intermediate CA"
fi

cert_text="$(openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -text)"

# A Device reaches the Gateway as "gateway" inside Compose and as
# localhost/127.0.0.1 from the host. All three must be present or TLS
# verification fails on whichever name is used.
echo "$cert_text" | grep -q "DNS:gateway" || fail "missing SAN DNS:gateway"
echo "$cert_text" | grep -q "DNS:localhost" || fail "missing SAN DNS:localhost"
echo "$cert_text" | grep -q "IP Address:127.0.0.1" || fail "missing SAN IP:127.0.0.1"

# A server certificate must not be usable as a CA, and must declare serverAuth.
echo "$cert_text" | grep -q "CA:FALSE" || fail "gateway certificate is not CA:FALSE"
echo "$cert_text" | grep -q "TLS Web Server Authentication" || fail "missing serverAuth EKU"

# Validity: 1 year (see issue-gateway-cert.sh for why this value).
openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -checkend $(( (365 - 1) * 86400 )) \
  || fail "gateway certificate does not last ~1 year"
openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -checkend $(( (365 + 5) * 86400 )) \
  && fail "gateway certificate lasts longer than ~1 year"

assert_key_perm "$WORK_DIR/ca-a/gateway.key"

# The certificate and key must actually belong together, or the Gateway fails at
# tls.LoadX509KeyPair on startup.
cert_pub="$(openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -pubkey)"
key_pub="$(openssl pkey -in "$WORK_DIR/ca-a/gateway.key" -pubout)"
[ "$cert_pub" = "$key_pub" ] || fail "gateway.crt and gateway.key do not match"

# Failure path: another CA's root must not verify this certificate.
"$SCRIPT_DIR/init-ca.sh" "$WORK_DIR/ca-b" >/dev/null
if openssl verify -CAfile "$WORK_DIR/ca-b/root-ca.crt" -untrusted "$WORK_DIR/ca-a/intermediate-ca.crt" \
  "$WORK_DIR/ca-a/gateway.crt" >/dev/null 2>&1; then
  fail "CA A's gateway certificate incorrectly verified against CA B's root"
fi

# Failure path: running without a CA must fail loudly instead of producing an
# unsigned or self-signed certificate.
if "$SCRIPT_DIR/issue-gateway-cert.sh" "$WORK_DIR/empty" >/dev/null 2>&1; then
  fail "issue-gateway-cert.sh succeeded without an existing CA"
fi

echo "PASS: issue-gateway-cert.sh produces a valid Intermediate-signed Gateway server certificate"
