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

# GNU coreutils(-c) 를 먼저 시도하고 실패하면 BSD/macOS(-f) 로 넘어간다. 순서가
# 중요하다: GNU stat 의 -f 는 "파일시스템 정보"라서 %Lp 를 줘도 exit 0 으로
# 성공하며 권한과 무관한 값을 낸다. BSD 문법을 먼저 두면 Linux 에서 fallback 이
# 실행되지 않아 항상 비교가 어긋난다.
key_perm() {
  stat -c "%a" "$1" 2>/dev/null || stat -f "%Lp" "$1"
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

# gateway.crt는 leaf 단독이 아니라 Intermediate까지 이어 붙인 Chain이어야 한다.
# 서버가 handshake에서 보내는 것이 이 파일이므로, leaf만 두면 Root CA만 신뢰하는
# Client가 Chain을 만들지 못한다(Issue #42).
cert_count="$(grep -c "BEGIN CERTIFICATE" "$WORK_DIR/ca-a/gateway.crt")"
[ "$cert_count" -eq 2 ] \
  || fail "gateway.crt has $cert_count certificate(s); expected leaf + intermediate"

# 두 번째 인증서가 실제로 이 CA의 Intermediate인지 확인한다. 아무거나 붙였는지
# 개수만으로는 알 수 없다. 텍스트를 그대로 비교하지 않고 지문으로 비교한다 —
# Windows에서 gawk가 일부 텍스트를 CRLF -> LF로 정규화해서 원본 파일과의 순수
# 바이트 비교가 우연히 깨지는 것을 봤다. 지문 비교는 그 표현 방식과 무관하게
# 실제로 같은 인증서인지만 본다.
second_cert_fingerprint="$(awk '/BEGIN CERTIFICATE/{n++} n==2' "$WORK_DIR/ca-a/gateway.crt" \
  | openssl x509 -noout -fingerprint -sha256)"
intermediate_fingerprint="$(openssl x509 -in "$WORK_DIR/ca-a/intermediate-ca.crt" -noout -fingerprint -sha256)"
[ "$second_cert_fingerprint" = "$intermediate_fingerprint" ] \
  || fail "the second certificate in gateway.crt is not this CA's intermediate"

# 핵심 회귀 방지: Root만 신뢰하는 Client가 서버가 보내는 것(=이 파일)만으로 Chain을
# 만들 수 있어야 한다.
openssl verify -CAfile "$WORK_DIR/ca-a/root-ca.crt" -untrusted "$WORK_DIR/ca-a/gateway.crt" \
  "$WORK_DIR/ca-a/gateway.crt" >/dev/null \
  || fail "a client trusting only the root cannot build the chain from gateway.crt"

cert_text="$(openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -text)"

# A Device reaches the Gateway as "gateway" inside Compose and as
# localhost/127.0.0.1 from the host. All three must be present or TLS
# verification fails on whichever name is used.
echo "$cert_text" | grep -q "DNS:gateway" || fail "missing SAN DNS:gateway"
echo "$cert_text" | grep -q "DNS:localhost" || fail "missing SAN DNS:localhost"
echo "$cert_text" | grep -q "IP Address:127.0.0.1" || fail "missing SAN IP:127.0.0.1"

# A server certificate must not be usable as a CA.
echo "$cert_text" | grep -q "CA:FALSE" || fail "gateway certificate is not CA:FALSE"

# EKU and Key Usage are compared as exact sets, not just "contains". An extra
# clientAuth would let this certificate impersonate a Device against the Gateway
# itself, and keyEncipherment is meaningless for an EC key
# (Codex 리뷰 PR #35 Low). `tr -d ' \r\n'` strips \r too, not just \n -- on
# Windows this openssl build's `-ext` output ends each line with \r\n, and a
# stray trailing \r otherwise makes an exact-match comparison fail even though
# the value looks identical when printed.
eku="$(openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -ext extendedKeyUsage \
  | tail -n +2 | tr -d ' \r\n')"
[ "$eku" = "TLSWebServerAuthentication" ] || fail "extendedKeyUsage = '$eku', want exactly TLS Web Server Authentication"
echo "$cert_text" | grep -q "TLS Web Client Authentication" && fail "gateway certificate must not carry clientAuth"

key_usage="$(openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -ext keyUsage \
  | tail -n +2 | tr -d ' \r\n')"
[ "$key_usage" = "DigitalSignature" ] || fail "keyUsage = '$key_usage', want exactly Digital Signature"
openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -ext keyUsage | grep -q "critical" \
  || fail "keyUsage is not marked critical"

# SAN must be exactly the three names the Gateway is reached by -- an extra name
# would widen who this certificate can speak for.
san="$(openssl x509 -in "$WORK_DIR/ca-a/gateway.crt" -noout -ext subjectAltName \
  | tail -n +2 | tr -d ' \r\n')"
[ "$san" = "DNS:gateway,DNS:localhost,IPAddress:127.0.0.1" ] \
  || fail "subjectAltName = '$san', want exactly DNS:gateway, DNS:localhost, IP Address:127.0.0.1"

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

# docs/security-design.md §3 and ADR-003: "발급 인증서의 유효기간은 상위 CA의 남은
# 유효기간을 넘지 않는다". A fixed -days would quietly violate this once the
# Intermediate has less time left than the requested validity
# (Codex 리뷰 PR #35 Medium).
SHORT_CA="$WORK_DIR/ca-short"
mkdir -p "$SHORT_CA"
cp "$WORK_DIR/ca-a/root-ca.crt" "$WORK_DIR/ca-a/root-ca.key" "$SHORT_CA/"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out "$SHORT_CA/intermediate-ca.key" 2>/dev/null
openssl req -new -key "$SHORT_CA/intermediate-ca.key" \
  -config "$SCRIPT_DIR/../config/intermediate-ca.cnf" \
  -out "$SHORT_CA/intermediate-ca.csr" 2>/dev/null
openssl x509 -req -in "$SHORT_CA/intermediate-ca.csr" \
  -CA "$SHORT_CA/root-ca.crt" -CAkey "$SHORT_CA/root-ca.key" -CAcreateserial \
  -extfile "$SCRIPT_DIR/../config/intermediate-ca.cnf" -extensions v3_intermediate_ca \
  -days 30 -out "$SHORT_CA/intermediate-ca.crt" 2>/dev/null

"$SCRIPT_DIR/issue-gateway-cert.sh" "$SHORT_CA" >/dev/null

# 30일 남은 CA 아래에서는 기본 365일이 아니라 30일 이내로 잘려야 한다.
openssl x509 -in "$SHORT_CA/gateway.crt" -noout -checkend $(( 31 * 86400 )) \
  && fail "gateway certificate outlives its 30-day Intermediate CA"
openssl x509 -in "$SHORT_CA/gateway.crt" -noout -checkend $(( 28 * 86400 )) \
  || fail "gateway certificate was clamped too aggressively under a 30-day CA"

# Failure path: a failed issue must leave the previous gateway.crt/key in place
# rather than pairing a fresh key with the stale certificate.
before_cert="$(cat "$WORK_DIR/ca-a/gateway.crt")"
before_key="$(cat "$WORK_DIR/ca-a/gateway.key")"
mv "$WORK_DIR/ca-a/intermediate-ca.key" "$WORK_DIR/ca-a/intermediate-ca.key.bak"
if "$SCRIPT_DIR/issue-gateway-cert.sh" "$WORK_DIR/ca-a" >/dev/null 2>&1; then
  fail "issue-gateway-cert.sh succeeded with a missing intermediate key"
fi
mv "$WORK_DIR/ca-a/intermediate-ca.key.bak" "$WORK_DIR/ca-a/intermediate-ca.key"
[ "$(cat "$WORK_DIR/ca-a/gateway.crt")" = "$before_cert" ] || fail "failed issue overwrote gateway.crt"
[ "$(cat "$WORK_DIR/ca-a/gateway.key")" = "$before_key" ] || fail "failed issue overwrote gateway.key"

# Failure path: an Intermediate certificate that does not match its key must be
# rejected before anything is signed.
cp -r "$WORK_DIR/ca-a" "$WORK_DIR/ca-mismatch"
cp "$WORK_DIR/ca-b/intermediate-ca.key" "$WORK_DIR/ca-mismatch/intermediate-ca.key"
if "$SCRIPT_DIR/issue-gateway-cert.sh" "$WORK_DIR/ca-mismatch" >/dev/null 2>&1; then
  fail "issue-gateway-cert.sh succeeded with a mismatched intermediate cert/key pair"
fi

echo "PASS: issue-gateway-cert.sh produces a valid Intermediate-signed Gateway server certificate"
