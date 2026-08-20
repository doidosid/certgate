const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * `<input type="datetime-local">` 값(`YYYY-MM-DDTHH:mm[:ss]`, 사용자의 로컬 시간)을
 * 서버가 받는 ISO 8601 Instant로 바꾼다. 해석할 수 없으면 undefined다.
 *
 * `new Date(value)`가 NaN인지만 보는 검사로는 부족하다 — JavaScript `Date`는 존재하지
 * 않는 시각을 거절하지 않고 조용히 다른 시각으로 보정한다. `2026-02-30T09:00`은 3월
 * 2일이 되고, DST가 있는 지역에서 전환으로 사라진 시각(예: America/New_York의
 * `2026-03-08T02:30`)은 한 시간 뒤로 밀린다. 보안 감사 화면이 사용자가 지정한 것과
 * 다른 시간 범위를 조회하는 것은 조회에 실패하는 것보다 나쁘다 — 화면에는 원래 입력이
 * 남아 있어 왜 결과가 다른지 알 수 없다(Codex 리뷰 PR #46 Medium).
 *
 * 그래서 만들어진 시각을 입력값과 자리별로 다시 비교한다. 연·월·일·시·분·초 중 어느
 * 자리든 어긋났다면 보정이 일어난 것이므로 값을 버린다. 달력에 없는 날짜와 DST gap은
 * 어긋나는 자리만 다르고 같은 검사로 함께 걸러진다.
 */
export function localDateTimeToInstant(value: string): string | undefined {
	const match = DATETIME_LOCAL.exec(value.trim());
	if (match === null) {
		return undefined;
	}

	const [, year, month, day, hour, minute, second = "00"] = match;
	const parsed = new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
	);
	if (Number.isNaN(parsed.getTime())) {
		return undefined;
	}

	const keptEveryField =
		parsed.getFullYear() === Number(year) &&
		parsed.getMonth() === Number(month) - 1 &&
		parsed.getDate() === Number(day) &&
		parsed.getHours() === Number(hour) &&
		parsed.getMinutes() === Number(minute) &&
		parsed.getSeconds() === Number(second);

	return keptEveryField ? parsed.toISOString() : undefined;
}
