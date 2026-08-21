#!/usr/bin/env bash
# tests/e2e/run.sh 가 쓰는 공용 함수. 직접 실행하지 않는다.
#
# 실패해도 멈추지 않고 끝까지 돈 뒤 한 번에 보고한다(`set -e`를 쓰지 않는 이유).
# 한 시나리오가 깨졌을 때 나머지 상태도 같이 봐야 원인을 좁힐 수 있다.

PASSED=0
FAILED=0
SKIPPED=0
FAILURES=()

if [ -t 1 ]; then
	C_OK=$'\033[32m'; C_NG=$'\033[31m'; C_SKIP=$'\033[33m'; C_HEAD=$'\033[1m'; C_OFF=$'\033[0m'
else
	C_OK=''; C_NG=''; C_SKIP=''; C_HEAD=''; C_OFF=''
fi

scenario() { printf '\n%s== %s%s\n' "$C_HEAD" "$1" "$C_OFF"; }
ok()   { PASSED=$((PASSED + 1)); printf '  %sPASS%s %s\n' "$C_OK" "$C_OFF" "$1"; }
ng()   { FAILED=$((FAILED + 1)); FAILURES+=("$1"); printf '  %sFAIL%s %s\n' "$C_NG" "$C_OFF" "$1"; }
skip() { SKIPPED=$((SKIPPED + 1)); printf '  %sSKIP%s %s\n' "$C_SKIP" "$C_OFF" "$1"; }

# check <설명> <실제> <기대>
check() {
	if [ "$2" = "$3" ]; then
		ok "$1"
	else
		ng "$1 — 기대 '$3', 실제 '$2'"
	fi
}

# check_contains <설명> <문자열> <부분문자열>
check_contains() {
	case "$2" in
	*"$3"*) ok "$1" ;;
	*) ng "$1 — '$3' 를 포함해야 하는데 '$2'" ;;
	esac
}

# check_not_contains <설명> <문자열> <부분문자열>
# 실패 메시지에 검사 대상 문자열($2) 전체를 그대로 싣지 않는다 — 이 함수 자체가
# Private Key·Token 같은 Secret이 새지 않았는지 확인하는 용도라, 실패했을 때 그
# Secret을 다시 화면·로그에 찍으면 검사가 스스로 유출 경로가 된다.
check_not_contains() {
	case "$2" in
	*"$3"*) ng "$1 — '$3' 패턴이 발견됐다" ;;
	*) ok "$1" ;;
	esac
}

summary() {
	printf '\n%s== 결과%s\n' "$C_HEAD" "$C_OFF"
	printf '  통과 %d · 실패 %d · 건너뜀 %d\n' "$PASSED" "$FAILED" "$SKIPPED"
	if [ "$FAILED" -gt 0 ]; then
		printf '\n  실패 항목:\n'
		for f in "${FAILURES[@]}"; do printf '    - %s\n' "$f"; done
		return 1
	fi
	return 0
}

json() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

# 값이 나올 때까지 최대 <초>만큼 기다린다. wait_for <초> <셸 표현식>
wait_for() {
	local deadline=$(( $(date +%s) + $1 ))
	shift
	while [ "$(date +%s)" -lt "$deadline" ]; do
		if eval "$@" >/dev/null 2>&1; then return 0; fi
		sleep 1
	done
	return 1
}
