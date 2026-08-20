import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import DateTimeText from "./DateTimeText";

/**
 * 공유 컴포넌트의 표시 형식을 고정한다. 감사 화면의 시각은 Gateway·Management API
 * 로그와 맞춰 보는 값이라 24시간제·고정폭이어야 하고, 표에서 세로로 정렬되려면
 * 월·일·시·분·초가 항상 두 자리여야 한다(Codex 리뷰 PR #46 권고).
 *
 * 기대값을 Date에서 다시 뽑지 않고 로컬 시각 성분으로 직접 만든다 — 구현과 같은
 * 방법으로 기대값을 만들면 같은 실수를 정답으로 받아들인다.
 */
function renderValue(value: string | null | undefined): string {
	return render(<DateTimeText value={value} />).container.textContent ?? "";
}

describe("DateTimeText", () => {
	it("shows the server's UTC instant as local time in 24-hour form", () => {
		// 2026-08-13T05:50:00Z를 이 환경의 로컬 시각으로 옮긴 값과 비교한다.
		const local = new Date("2026-08-13T05:50:00Z");
		const expected =
			`${local.getFullYear()}-` +
			`${String(local.getMonth() + 1).padStart(2, "0")}-` +
			`${String(local.getDate()).padStart(2, "0")} ` +
			`${String(local.getHours()).padStart(2, "0")}:` +
			`${String(local.getMinutes()).padStart(2, "0")}:` +
			`${String(local.getSeconds()).padStart(2, "0")}`;

		expect(renderValue("2026-08-13T05:50:00Z")).toBe(expected);
	});

	/** 한 자리 월·일·시·분·초를 0으로 채우지 않으면 표에서 열이 어긋난다. */
	it("pads every field to two digits", () => {
		const rendered = renderValue(new Date(2026, 0, 2, 3, 4, 5).toISOString());

		expect(rendered).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(rendered).toContain("2026-01-02 03:04:05");
	});

	/** 오전·오후 같은 로케일 문구가 섞이면 등폭 정렬이 깨진다. */
	it("never falls back to a locale phrase", () => {
		const rendered = renderValue("2026-08-13T05:50:00Z");

		expect(rendered).not.toMatch(/오전|오후|AM|PM/);
	});

	it.each([
		["null", null],
		["undefined", undefined],
		["빈 문자열", ""],
		["날짜가 아닌 값", "notadate"],
	])("표시할 수 없는 값은 없음으로 둔다: %s", (_label, value) => {
		expect(renderValue(value)).toBe("—");
	});
});
