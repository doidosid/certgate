import { describe, expect, it } from "vitest";
import { localDateTimeToInstant } from "./localDateTime";

describe("localDateTimeToInstant", () => {
	it("reads the value as the user's local wall-clock time", () => {
		expect(localDateTimeToInstant("2026-08-13T09:00")).toBe(new Date(2026, 7, 13, 9, 0, 0).toISOString());
	});

	it("accepts seconds", () => {
		expect(localDateTimeToInstant("2026-08-13T09:00:30")).toBe(new Date(2026, 7, 13, 9, 0, 30).toISOString());
	});

	it.each([
		["빈 값", ""],
		["날짜가 아닌 문자열", "notadate"],
		["시간 없는 날짜", "2026-08-13"],
		["offset이 붙은 값", "2026-08-13T09:00Z"],
	])("버린다: %s", (_label, value) => {
		expect(localDateTimeToInstant(value)).toBeUndefined();
	});

	/**
	 * new Date(...)는 이런 값을 NaN으로 만들지 않고 다른 시각으로 보정한다. 보정된
	 * 시각을 서버로 보내면 사용자가 지정하지 않은 범위를 조회하게 된다.
	 *
	 * DST가 있는 지역에서 전환으로 사라진 시각도 같은 경로로 걸러진다 — 그때는
	 * "시"가 어긋난다(예: America/New_York의 2026-03-08T02:30 → 03:30). 이 저장소의
	 * CI·개발 환경 시간대에는 DST가 없어 그 입력 자체를 여기서 재현할 수는 없지만,
	 * 검사는 자리별 비교 하나로 두 경우를 함께 막는다.
	 */
	it.each([
		["달력에 없는 날(2월 30일)", "2026-02-30T09:00"],
		["13월", "2026-13-01T00:00"],
		["25시", "2026-08-13T25:00"],
		["60분", "2026-08-13T09:60"],
	])("보정된 시각을 그대로 쓰지 않고 버린다: %s", (_label, value) => {
		expect(localDateTimeToInstant(value)).toBeUndefined();
	});

	/** 보정을 눈으로 확인해 위 검사가 실제로 필요한 것임을 남긴다. */
	it("shows why the round-trip check is needed", () => {
		expect(new Date("2026-02-30T09:00").getDate()).not.toBe(30);
	});
});
