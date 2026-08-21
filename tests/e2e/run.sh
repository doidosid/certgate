#!/usr/bin/env bash
#
# CertGate E2E — 실제 TLS와 실행 중 생성한 Certificate로 핵심 흐름을 검증한다(Issue #4).
#
#   ./tests/e2e/run.sh
#
# 실제 Compose 스택을 띄우고, 실제 Device Agent가 만든 Key·CSR로 인증서를 발급받아,
# 실제 mTLS로 Gateway에 요청한다. Mock이나 Stub은 쓰지 않는다.
#
# 이 스크립트는 **DB Volume을 지우고 시작한다**(`down -v`). 개발 중인 데이터가 있으면
# 먼저 백업한다.
#
# 이번 실행에서 새로 만든 Device Key·Certificate·Enrollment Token은 전부 임시
# 디렉터리 안에만 있고 종료 시 지운다. 저장소에 남기지 않는다(docs/testing.md
# "Test Key·Certificate·Token은 Git과 로그에 없음"). 단, Root/Intermediate CA와
# Gateway 서버 인증서(pki/runtime/)는 예외다 — 여러 번 실행에 걸쳐 재사용하도록
# 그대로 두고 지우지 않는다. 이 디렉터리는 gitignore 대상이라 저장소에는 남지
# 않는다.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

COMPOSE=(docker compose -f "$REPO_DIR/infra/compose.yaml" --env-file "$REPO_DIR/.env.example")
V1="http://127.0.0.1:8080/api/v1"
GW="https://127.0.0.1:8443"
CA_DIR="$REPO_DIR/pki/runtime"

WORK_DIR="$(mktemp -d)"
KEEP_STACK="${E2E_KEEP_STACK:-0}"

cleanup() {
	# Key·Certificate·Token이 담긴 작업 디렉터리를 반드시 지운다.
	rm -rf "$WORK_DIR"
	if [ "$KEEP_STACK" = "1" ]; then
		printf '\n스택을 남겨 둔다(E2E_KEEP_STACK=1). 정리: docker compose -f infra/compose.yaml --env-file .env.example down -v\n'
	else
		"${COMPOSE[@]}" down -v >/dev/null 2>&1
	fi
}
trap cleanup EXIT

# ---------------------------------------------------------------- 준비

preflight() {
	scenario "0. 준비"

	for tool in docker go openssl curl python3; do
		command -v "$tool" >/dev/null 2>&1 || { ng "$tool 가 필요하다"; summary; exit 1; }
	done

	if [ ! -s "$CA_DIR/intermediate-ca.crt" ]; then
		printf '  PKI 자료가 없어 새로 만든다\n'
		"$REPO_DIR/pki/scripts/init-ca.sh" >/dev/null 2>&1 || { ng "init-ca.sh 실패"; summary; exit 1; }
	fi
	# Gateway 서버 인증서는 매번 새로 발급한다 — leaf + Intermediate Chain이어야 한다(Issue #42).
	"$REPO_DIR/pki/scripts/issue-gateway-cert.sh" >/dev/null 2>&1 \
		|| { ng "issue-gateway-cert.sh 실패"; summary; exit 1; }
	ok "PKI 자료 준비"

	(cd "$REPO_DIR/device-agent" && go build -o "$WORK_DIR/device-agent" ./cmd/device-agent) \
		|| { ng "device-agent 빌드 실패"; summary; exit 1; }
	ok "device-agent 빌드"

	"${COMPOSE[@]}" down -v >/dev/null 2>&1
	"${COMPOSE[@]}" up -d --build >/dev/null 2>&1 || { ng "스택 기동 실패"; summary; exit 1; }

	if wait_for 120 api_up; then
		ok "스택 기동 (5개 서비스)"
	else
		ng "스택이 120초 안에 준비되지 않았다"
		"${COMPOSE[@]}" ps
		summary
		exit 1
	fi
}

# ---------------------------------------------------------------- 공용 동작

# register <deviceKey> <name> <role> -> "id<TAB>token" (평문 Token은 출력하지 않는다)
register() {
	curl -sf -X POST "$V1/devices" -H 'Content-Type: application/json' \
		-d "{\"deviceKey\":\"$1\",\"name\":\"$2\",\"roleName\":\"$3\"}" |
		json 'd["id"]+"\t"+d["enrollmentToken"]'
}

# enroll <deviceKey> <token> — CSR 제출·승인·수령까지 마치고 fullchain을 만든다
enroll() {
	local key="$1" token="$2" dir="$WORK_DIR/$1"
	mkdir -p "$dir"
	DEVICE_KEY="$key" DEVICE_ENROLLMENT_TOKEN="$token" \
		MANAGEMENT_API_URL="http://127.0.0.1:8080" GATEWAY_URL="$GW" DEVICE_RUNTIME_DIR="$dir" \
		"$WORK_DIR/device-agent" >"$dir/agent.log" 2>&1 &
	local agent_pid=$!

	local device_id request_id
	device_id="$(curl -sf "$V1/devices?query=$key" | json 'd["content"][0]["id"]')"
	if ! wait_for 30 "has_pending_request $device_id"; then
		kill "$agent_pid" 2>/dev/null
		return 1
	fi
	request_id="$(pending_request_id "$device_id")"

	curl -sf -o /dev/null -X POST "$V1/certificate-requests/$request_id/approve" \
		-H 'Content-Type: application/json' -d '{"decisionNote":"E2E"}' || { kill "$agent_pid" 2>/dev/null; return 1; }

	if ! wait_for 30 "cert_written $key"; then
		kill "$agent_pid" 2>/dev/null
		return 1
	fi
	wait "$agent_pid" 2>/dev/null

	# Gateway의 Client CA Pool에는 root-ca.crt만 있다(security-design.md §5).
	# Device는 자기 인증서 뒤에 Intermediate를 이어 붙여 제시해야 한다.
	cat "$dir/device.crt" "$CA_DIR/intermediate-ca.crt" >"$dir/fullchain.crt"
}

# gw <deviceKey> <method> <path> [추가 curl 인자...] -> HTTP 코드
gw() {
	local key="$1" method="$2" path="$3"
	shift 3
	curl -s -o "$WORK_DIR/last-body" -w '%{http_code}' --max-time 15 \
		--cert "$WORK_DIR/$key/fullchain.crt" --key "$WORK_DIR/$key/device.key" \
		--cacert "$CA_DIR/root-ca.crt" \
		-X "$method" "$GW$path" -H 'Content-Type: application/json' -d '{"e2e":true}' "$@"
}

# gw_with <certPath> <keyPath> <method> <path> -> HTTP 코드 (없는 조합도 시도할 수 있다)
gw_with() {
	curl -s -o "$WORK_DIR/last-body" -w '%{http_code}' --max-time 15 \
		--cert "$1" --key "$2" --cacert "$CA_DIR/root-ca.crt" \
		-X "$3" "$GW$4" -H 'Content-Type: application/json' -d '{"e2e":true}'
}

pending_request_id() {
	curl -sf "$V1/certificate-requests?deviceId=$1&status=PENDING" |
		json 'd["content"][0]["id"] if d["content"] else ""'
}

# wait_for 가 eval 하는 조건들. 같은 셸이라 함수를 그대로 쓸 수 있다.
has_pending_request() { [ -n "$(pending_request_id "$1")" ]; }
cert_written()        { [ -s "$WORK_DIR/$1/device.crt" ]; }
api_up()              { [ "$(curl -s -o /dev/null -w '%{http_code}' "$V1/devices")" = "200" ]; }
outbox_empty()        { [ "$(outbox_pending)" = "0" ]; }
outbox_readable()     { [ -n "$(outbox_pending)" ]; }
reason_is()           { [ "$(latest_reason "$1")" = "$2" ]; }
severity_is()         { [ "$(latest_severity "$1")" = "$2" ]; }
sse_got_event()       { grep -q "critical-security-event" "$WORK_DIR/sse.txt"; }

# latest_reason <deviceId> -> 그 Device의 가장 최근 Security Event의 Reason Code
latest_reason() {
	curl -sf "$V1/security-events?deviceId=$1&size=1" |
		json 'd["content"][0]["reasonCode"] if d["content"] else "NONE"'
}

latest_severity() {
	curl -sf "$V1/security-events?deviceId=$1&size=1" |
		json 'd["content"][0]["severity"] if d["content"] else "NONE"'
}

outbox_pending() {
	"${COMPOSE[@]}" exec -T gateway wget -qO- \
		--header="Authorization: Bearer $(grep '^GATEWAY_INTERNAL_TOKEN=' "$REPO_DIR/.env.example" | cut -d= -f2-)" \
		http://localhost:8081/internal/outbox/stats 2>/dev/null | json 'd["pendingCount"]'
}

# ---------------------------------------------------------------- 시나리오

DEV_A_ID=""; DEV_B_ID=""; DEV_E_ID=""; DEV_F_ID=""

s1_enrollment() {
	scenario "1. Enrollment Token · CSR · 승인 · Certificate 수령"

	local out
	out="$(register e2e-sensor-01 "E2E 온도 센서" SENSOR)" || { ng "Device 등록 실패"; return; }
	DEV_A_ID="${out%%$'\t'*}"; local tok_a="${out##*$'\t'}"
	ok "Device 등록"

	if enroll e2e-sensor-01 "$tok_a"; then
		ok "CSR 제출 → 관리자 승인 → Certificate 수령"
	else
		ng "Enrollment 흐름 실패"
		return
	fi

	local san
	san="$(openssl x509 -in "$WORK_DIR/e2e-sensor-01/device.crt" -noout -ext subjectAltName 2>/dev/null | tr -d ' \n')"
	check_contains "발급된 인증서의 SAN URI가 계약 형식이다" "$san" "URI:urn:certgate:device:e2e-sensor-01"

	# Chain·Key 일치는 Device가 실제로 쓰기 전에 확인한다.
	if openssl verify -CAfile "$CA_DIR/root-ca.crt" -untrusted "$CA_DIR/intermediate-ca.crt" \
		"$WORK_DIR/e2e-sensor-01/device.crt" >/dev/null 2>&1; then
		ok "발급된 인증서가 Intermediate를 거쳐 Root에 닿는다"
	else
		ng "발급된 인증서의 Chain 검증 실패"
	fi

	local status
	status="$(curl -s -o /dev/null -w '%{http_code}' "$V1/devices/$DEV_A_ID")"
	check "Device 상세 조회" "$status" "200"
}

s2_enrollment_rejections() {
	scenario "2. Token 오류 · SAN 불일치 거절"

	# CSR 하나를 openssl로 직접 만들어 재사용한다 — Agent는 항상 자기 Device Key로만
	# CSR을 만들기 때문에 불일치 상황을 만들 수 없다.
	openssl ecparam -name prime256v1 -genkey -noout -out "$WORK_DIR/rogue.key" 2>/dev/null
	openssl req -new -key "$WORK_DIR/rogue.key" -subj "/CN=e2e-rogue" \
		-addext "subjectAltName=URI:urn:certgate:device:e2e-rogue" \
		-out "$WORK_DIR/rogue.csr" 2>/dev/null
	local rogue_csr
	rogue_csr="$(python3 -c "import json;print(json.dumps(open('$WORK_DIR/rogue.csr').read()))")"

	# Token 값은 실행할 때마다 새로 만든다. 소스에 Token처럼 보이는 리터럴을 두면
	# secret-scan(gitleaks)이 잡고, 무엇보다 우연히 실재하는 값과 겹칠 수 없어야 한다.
	local bogus_token status
	bogus_token="cg_enroll_$(openssl rand -hex 16)"
	status="$(curl -s -o "$WORK_DIR/last-body" -w '%{http_code}' -X POST "$V1/enrollments/certificate-requests" \
		-H "Authorization: Bearer $bogus_token" -H 'Content-Type: application/json' \
		-d "{\"csrPem\":$rogue_csr}")"
	check "존재하지 않는 Enrollment Token 거절" "$status" "401"
	check_contains "거절 Reason Code" "$(cat "$WORK_DIR/last-body")" "ENROLLMENT_TOKEN_INVALID"

	# 유효한 Token인데 CSR의 SAN이 그 Token의 Device가 아니다.
	local out tok_x
	out="$(register e2e-sensor-san "E2E SAN 확인용" SENSOR)" || { ng "Device 등록 실패"; return; }
	tok_x="${out##*$'\t'}"
	status="$(curl -s -o "$WORK_DIR/last-body" -w '%{http_code}' -X POST "$V1/enrollments/certificate-requests" \
		-H "Authorization: Bearer $tok_x" -H 'Content-Type: application/json' \
		-d "{\"csrPem\":$rogue_csr}")"
	# api-spec.md §1 "422: CSR 서명 검증, SAN URI, 공개키 정책 오류", §10 SAN_URI_INVALID (422).
	check "SAN URI가 Token 대상 Device와 다르면 거절" "$status" "422"
	check_contains "거절 Reason Code" "$(cat "$WORK_DIR/last-body")" "SAN_URI_INVALID"
}

s3_allowed() {
	scenario "3. 정상 SENSOR Heartbeat · Telemetry"

	check "POST /telemetry 허용" "$(gw e2e-sensor-01 POST /telemetry)" "200"
	check "POST /heartbeat 허용" "$(gw e2e-sensor-01 POST /heartbeat)" "200"
	check "Backend까지 도달했다" "$(json 'd["deviceKey"]' <"$WORK_DIR/last-body")" "e2e-sensor-01"

	if wait_for 20 "reason_is $DEV_A_ID REQUEST_ALLOWED"; then
		ok "허용 Security Event가 REQUEST_ALLOWED로 기록된다"
	else
		ng "허용 Security Event가 기록되지 않았다 (실제: $(latest_reason "$DEV_A_ID"))"
	fi
}

s4_rejected_certificates() {
	scenario "4. 다른 CA · 만료 · 폐기 차단"

	# --- 다른 CA: 신뢰하지 않는 CA가 서명한 Client 인증서는 handshake에서 끊긴다.
	local other="$WORK_DIR/other-ca"
	if "$REPO_DIR/pki/scripts/init-ca.sh" "$other" >/dev/null 2>&1; then
		openssl ecparam -name prime256v1 -genkey -noout -out "$WORK_DIR/otherdev.key" 2>/dev/null
		openssl req -new -key "$WORK_DIR/otherdev.key" -subj "/CN=e2e-sensor-01" \
			-addext "subjectAltName=URI:urn:certgate:device:e2e-sensor-01" \
			-out "$WORK_DIR/otherdev.csr" 2>/dev/null
		printf 'subjectAltName=URI:urn:certgate:device:e2e-sensor-01\nextendedKeyUsage=clientAuth\n' >"$WORK_DIR/otherdev.ext"
		openssl x509 -req -in "$WORK_DIR/otherdev.csr" \
			-CA "$other/intermediate-ca.crt" -CAkey "$other/intermediate-ca.key" -CAcreateserial \
			-extfile "$WORK_DIR/otherdev.ext" -days 30 -out "$WORK_DIR/otherdev.crt" 2>/dev/null
		cat "$WORK_DIR/otherdev.crt" "$other/intermediate-ca.crt" >"$WORK_DIR/otherdev-fullchain.crt"

		local code
		code="$(gw_with "$WORK_DIR/otherdev-fullchain.crt" "$WORK_DIR/otherdev.key" POST /telemetry)"
		# handshake 자체가 끊기므로 curl은 HTTP 코드를 받지 못한다(000).
		check "다른 CA가 서명한 Client 인증서는 TLS handshake에서 거부" "$code" "000"
	else
		skip "다른 CA 시나리오 (별도 CA 생성 실패)"
	fi

	# --- 만료: 우리 Intermediate가 서명했지만 이미 만료된 인증서.
	if openssl x509 -help 2>&1 | grep -q -- "-not_after"; then
		openssl ecparam -name prime256v1 -genkey -noout -out "$WORK_DIR/expired.key" 2>/dev/null
		openssl req -new -key "$WORK_DIR/expired.key" -subj "/CN=e2e-sensor-01" \
			-addext "subjectAltName=URI:urn:certgate:device:e2e-sensor-01" \
			-out "$WORK_DIR/expired.csr" 2>/dev/null
		printf 'subjectAltName=URI:urn:certgate:device:e2e-sensor-01\nextendedKeyUsage=clientAuth\n' >"$WORK_DIR/expired.ext"
		local nb na
		nb="$(date -u -v-40d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d '40 days ago' +%Y%m%d%H%M%SZ)"
		na="$(date -u -v-10d +%Y%m%d%H%M%SZ 2>/dev/null || date -u -d '10 days ago' +%Y%m%d%H%M%SZ)"
		openssl x509 -req -in "$WORK_DIR/expired.csr" \
			-CA "$CA_DIR/intermediate-ca.crt" -CAkey "$CA_DIR/intermediate-ca.key" -CAcreateserial \
			-extfile "$WORK_DIR/expired.ext" -not_before "$nb" -not_after "$na" \
			-out "$WORK_DIR/expired.crt" 2>/dev/null
		cat "$WORK_DIR/expired.crt" "$CA_DIR/intermediate-ca.crt" >"$WORK_DIR/expired-fullchain.crt"

		local code
		code="$(gw_with "$WORK_DIR/expired-fullchain.crt" "$WORK_DIR/expired.key" POST /telemetry)"
		check "만료된 Client 인증서는 TLS handshake에서 거부" "$code" "000"
	else
		skip "만료 인증서 시나리오 (openssl x509 -not_after 미지원, 3.2 이상 필요)"
	fi

	# --- 폐기: 정상 발급받은 뒤 관리자가 폐기한 인증서.
	local out tok_b
	out="$(register e2e-sensor-02 "E2E 폐기 대상" SENSOR)" || { ng "Device 등록 실패"; return; }
	DEV_B_ID="${out%%$'\t'*}"; tok_b="${out##*$'\t'}"
	if ! enroll e2e-sensor-02 "$tok_b"; then ng "폐기 대상 Device Enrollment 실패"; return; fi

	check "폐기 전에는 허용된다" "$(gw e2e-sensor-02 POST /telemetry)" "200"

	local cert_id
	cert_id="$(curl -sf "$V1/certificates?deviceId=$DEV_B_ID" | json 'd["content"][0]["id"]')"
	curl -sf -o /dev/null -X POST "$V1/certificates/$cert_id/revoke" \
		-H 'Content-Type: application/json' -d '{"reason":"KEY_COMPROMISE","note":"E2E"}' \
		|| { ng "인증서 폐기 실패"; return; }
	ok "인증서 폐기"

	# 폐기 Commit 후 Gateway Cache 무효화가 호출되므로 TTL(30초)을 기다리지 않아도 된다.
	# 이것이 docs/testing.md 필수 시나리오 12(Certificate 폐기 후 Cache 무효화)의 검증이다.
	# 무효화 호출은 비동기(2~3초 Timeout)라 요청 바로 다음 순간에는 아직 반영 전일
	# 수 있어 최대 5초까지 짧게 재시도한다 — TTL(30초)과는 자릿수가 다르므로, 그래도
	# 403이 안 나오면 우연한 flake가 아니라 진짜 회귀다.
	local code deadline
	deadline=$(( $(date +%s) + 5 ))
	code="$(gw e2e-sensor-02 POST /telemetry)"
	while [ "$code" != "403" ] && [ "$(date +%s)" -lt "$deadline" ]; do
		sleep 1
		code="$(gw e2e-sensor-02 POST /telemetry)"
	done
	check "폐기 직후 차단 (Cache 무효화가 TTL을 기다리지 않는다)" "$code" "403"
	check_contains "차단 Reason Code" "$(cat "$WORK_DIR/last-body")" "CERTIFICATE_REVOKED"

	if wait_for 20 "severity_is $DEV_B_ID CRITICAL"; then
		ok "폐기 인증서 접근이 CRITICAL Security Event로 남는다"
	else
		ng "CRITICAL Security Event가 기록되지 않았다"
	fi
}

s5_role_policy() {
	scenario "5. SENSOR /commands 차단 · OPERATOR 허용"

	local out tok
	out="$(register e2e-panel-01 "E2E 제어 패널" OPERATOR)" || { ng "Device 등록 실패"; return; }
	DEV_F_ID="${out%%$'\t'*}"; tok="${out##*$'\t'}"
	if ! enroll e2e-panel-01 "$tok"; then ng "OPERATOR Device Enrollment 실패"; return; fi

	local code
	code="$(gw e2e-sensor-01 GET /commands)"
	check "SENSOR의 GET /commands 차단" "$code" "403"
	check_contains "차단 Reason Code" "$(cat "$WORK_DIR/last-body")" "ACCESS_DENIED"

	check "OPERATOR의 GET /commands 허용" "$(gw e2e-panel-01 GET /commands)" "200"
	check "OPERATOR의 POST /telemetry 허용" "$(gw e2e-panel-01 POST /telemetry)" "200"
}

s6_identity_headers() {
	scenario "6. 외부 Identity Header 제거 · 재생성"

	# 공격자가 다른 Device를 주장하는 Header를 붙여 보낸다. Gateway는 이를 제거하고
	# 검증된 Client 인증서의 SAN URI로 새로 만들어야 한다(ADR-001, CLAUDE.md 보안 규칙).
	local code
	code="$(gw e2e-sensor-01 POST /telemetry \
		-H 'X-CertGate-Device-Key: e2e-panel-01' \
		-H 'X-CertGate-Role: OPERATOR')"
	check "위조 Header를 붙여도 요청 자체는 정상 처리" "$code" "200"

	local body; body="$(cat "$WORK_DIR/last-body")"
	check "Backend가 본 Device Key는 인증서의 것이다" "$(json 'd["deviceKey"]' <<<"$body")" "e2e-sensor-01"
	check "Backend가 본 Role은 인증서 Device의 것이다" "$(json 'd["role"]' <<<"$body")" "SENSOR"

	# 위조 Header가 통과했다면 Backend는 OPERATOR를 봤을 것이다.
	check_not_contains "주장된 Role이 그대로 전달되지 않았다" "$body" "OPERATOR"
}

s7_outbox_during_outage() {
	scenario "7. Management API 장애 중 Outbox 보관"

	"${COMPOSE[@]}" stop management-api >/dev/null 2>&1
	ok "Management API 중단"

	# Access Context를 확인할 수 없고 유효한 Cache도 없으면 차단한다(Fail Closed).
	# 방금 요청한 Device는 Cache가 살아 있으므로, Cache가 없는 새 경로로 확인한다.
	sleep 31 # Access Cache TTL(30초)이 지나 Cache가 비도록 한다
	local code
	code="$(gw e2e-sensor-01 POST /telemetry)"
	check "Access Context를 못 얻으면 Fail Closed로 차단" "$code" "503"
	check_contains "Fail Closed Reason Code" "$(cat "$WORK_DIR/last-body")" "INTERNAL_ERROR"

	local pending
	pending="$(outbox_pending)"
	if [ "${pending:-0}" -gt 0 ]; then
		ok "Security Event가 Gateway Outbox에 쌓인다 (대기 ${pending}건)"
	else
		ng "Outbox에 Event가 쌓이지 않았다 (대기 ${pending:-?}건)"
	fi
}

s8_gateway_restart() {
	scenario "8. Gateway 재시작 후 Outbox 보존"

	local before after
	before="$(outbox_pending)"
	"${COMPOSE[@]}" restart gateway >/dev/null 2>&1
	if ! wait_for 60 outbox_readable; then
		ng "재시작한 Gateway의 Outbox 상태를 읽을 수 없다"
		return
	fi
	after="$(outbox_pending)"

	if [ -n "$after" ] && [ "${after:-0}" -ge "${before:-0}" ] && [ "${after:-0}" -gt 0 ]; then
		ok "재시작 후에도 Outbox가 보존된다 (${before}건 → ${after}건)"
	else
		ng "Outbox가 재시작에서 유실됐다 (${before:-?}건 → ${after:-?}건)"
	fi
}

s9_recovery_resend() {
	scenario "9. 복구 후 재전송 · 중복 방지"

	local before_events
	before_events="$(curl -sf "$V1/security-events?size=1" | json 'd["totalElements"]' 2>/dev/null || echo 0)"

	"${COMPOSE[@]}" start management-api >/dev/null 2>&1
	if wait_for 120 api_up; then
		ok "Management API 복구"
	else
		ng "Management API가 복구되지 않았다"
		return
	fi

	if wait_for 90 outbox_empty; then
		ok "Outbox가 비워진다 (재전송 완료)"
	else
		ng "Outbox가 90초 안에 비워지지 않았다 (대기 $(outbox_pending)건)"
	fi

	local after_events
	after_events="$(curl -sf "$V1/security-events?size=1" | json 'd["totalElements"]')"
	if [ "${after_events:-0}" -gt "${before_events:-0}" ]; then
		ok "장애 중 쌓인 Event가 저장됐다 (${before_events} → ${after_events})"
	else
		ng "재전송된 Event가 저장되지 않았다 (${before_events} → ${after_events})"
	fi

	# 같은 Event ID가 두 번 들어가지 않는다(재전송은 멱등해야 한다).
	# curl·json 파싱이 실패하면 두 변수 모두 빈 문자열이 되어 "" = "" 로 조용히
	# 통과할 수 있다 — 조회 자체가 됐는지(정수인지)를 먼저 확인해 그 함정을 막는다.
	local content ids uniq
	content="$(curl -sf "$V1/security-events?size=100")"
	if [ -z "$content" ]; then
		ng "재전송에 중복 Event가 없다 — Security Event 목록 조회 자체가 실패했다"
	else
		ids="$(json 'len(d["content"])' <<<"$content")"
		uniq="$(json 'len({e["id"] for e in d["content"]})' <<<"$content")"
		if [ -z "$ids" ] || [ -z "$uniq" ]; then
			ng "재전송에 중복 Event가 없다 — 응답을 파싱할 수 없었다"
		else
			check "재전송에 중복 Event가 없다" "$uniq" "$ids"
		fi
	fi
}

s11_sse_critical() {
	scenario "10. CRITICAL SSE 알림"

	# 새 CRITICAL Event를 만들면서 SSE Stream을 함께 열어 둔다.
	local sse_out="$WORK_DIR/sse.txt"
	curl -sN --max-time 25 "$V1/security-events/stream" >"$sse_out" 2>/dev/null &
	local sse_pid=$!
	sleep 3

	local code
	code="$(gw e2e-sensor-02 POST /telemetry)" # 폐기된 인증서 → CRITICAL
	check "폐기 인증서 재접근이 여전히 차단된다" "$code" "403"

	if wait_for 20 sse_got_event; then
		ok "CRITICAL Event가 SSE로 전달된다"
		# 한 줄만 잘라 보지 않고 Stream 전체에서 찾는다 — data 줄을 필드로 자르면
		# 본문의 공백에 걸려 조용히 일부만 검사하게 된다(첫 실행에서 실제로 그랬다).
		local payload; payload="$(cat "$sse_out")"
		check_contains "SSE payload에 reasonCode가 있다" "$payload" "CERTIFICATE_REVOKED"
		check_contains "SSE payload에 사용자용 message가 있다" "$payload" '"message"'
		check_contains "SSE payload에 eventId가 있다" "$payload" '"eventId"'
		check_not_contains "SSE payload에 인증서 원문이 없다" "$payload" "BEGIN CERTIFICATE"
	else
		ng "CRITICAL Event가 SSE로 오지 않았다"
	fi
	kill "$sse_pid" 2>/dev/null
	wait "$sse_pid" 2>/dev/null
}

s12_no_secrets() {
	scenario "11. Secret 노출 확인"

	local logs="$WORK_DIR/all.log"
	if ! "${COMPOSE[@]}" logs --no-color >"$logs" 2>&1 || [ ! -s "$logs" ]; then
		# 로그 수집 자체가 비어 있으면 아래 check_not_contains는 전부 우연히
		# 통과한다 — 이 시나리오의 존재 이유를 무력화하므로 그 자체를 실패로 본다.
		ng "컨테이너 로그를 수집하지 못했다 (아래 항목은 검증되지 않는다)"
	else
		ok "컨테이너 로그 수집"
	fi

	# needle을 조립한다. 소스에 그 문자열을 그대로 쓰면 CI의 "reject embedded private
	# key material" 검사가 이 파일을 Key가 박힌 파일로 보고 막는다 — 검사 쪽이 옳다.
	local pk="PRIVATE KEY"
	local content; content="$(cat "$logs" 2>/dev/null)"
	check_not_contains "로그에 Private Key가 없다" "$content" "BEGIN EC $pk"
	check_not_contains "로그에 Private Key(PKCS8)가 없다" "$content" "BEGIN $pk"
	check_not_contains "로그에 인증서 원문이 없다" "$content" "BEGIN CERTIFICATE"
	check_not_contains "로그에 CSR 원문이 없다" "$content" "BEGIN CERTIFICATE REQUEST"
	check_not_contains "로그에 Enrollment Token 평문이 없다" "$content" "cg_enroll_"

	local internal_token
	internal_token="$(grep '^GATEWAY_INTERNAL_TOKEN=' "$REPO_DIR/.env.example" | cut -d= -f2-)"
	if [ -n "$internal_token" ]; then
		check_not_contains "로그에 Gateway 내부 Service Token이 없다" "$content" "$internal_token"
	fi

	# Device Agent 자체도 Key·CSR을 직접 다루는 경계다 — Compose 로그와는 별도로
	# 각 Device의 agent.log도 같은 기준으로 검사한다.
	local agent_logs
	agent_logs="$(cat "$WORK_DIR"/*/agent.log 2>/dev/null)"
	check_not_contains "device-agent 로그에 Private Key가 없다" "$agent_logs" "BEGIN EC $pk"
	check_not_contains "device-agent 로그에 Private Key(PKCS8)가 없다" "$agent_logs" "BEGIN $pk"
	check_not_contains "device-agent 로그에 Enrollment Token 평문이 없다" "$agent_logs" "cg_enroll_"

	# 작업 디렉터리는 종료 시 지운다. 저장소 안에 새로 생긴 Key·인증서가 없어야 한다.
	local tracked
	tracked="$(cd "$REPO_DIR" && git status --porcelain | grep -E '\.(key|crt|pem|csr)$' | wc -l | tr -d ' ')"
	check "저장소에 Key·인증서 파일이 새로 생기지 않았다" "$tracked" "0"
}

# ---------------------------------------------------------------- 실행

printf '%sCertGate E2E%s — 실제 스택·실제 mTLS (Issue #4)\n' "$C_HEAD" "$C_OFF"
printf '작업 디렉터리: %s (종료 시 삭제)\n' "$WORK_DIR"

preflight
s1_enrollment
s2_enrollment_rejections
s3_allowed
s4_rejected_certificates
s5_role_policy
s6_identity_headers
s7_outbox_during_outage
s8_gateway_restart
s9_recovery_resend
s11_sse_critical
s12_no_secrets

summary
