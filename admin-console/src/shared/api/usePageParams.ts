import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

const DEFAULT_SIZE = 20;
/** api-spec.md §1: size 기본 20, 최대 100. 서버 Controller도 1~100으로 clamp한다. */
const MIN_SIZE = 1;
const MAX_SIZE = 100;

/**
 * 페이지·필터 상태를 URL Query String에 둔다. 새로고침·뒤로가기·링크 공유에서
 * 목록 상태가 유지되고, 별도 전역 상태 관리를 도입하지 않아도 된다
 * (Issue #7 완료 기준 "별도 Alert 화면·상태 관리가 없다").
 */
export function usePageParams() {
	const [searchParams, setSearchParams] = useSearchParams();

	// 사용자가 URL을 직접 고칠 수 있으므로 범위를 벗어난 값은 기본값으로 되돌린다.
	// page와 size는 유효 범위가 다르다 — page는 0 이상, size는 1~100이다. 같은
	// parser를 쓰면 ?size=0이나 ?size=101을 그대로 통과시키는데, 서버는 이를
	// 1·100으로 clamp하므로 화면이 쓰는 크기와 실제 적용된 크기가 어긋난다.
	const page = intInRange(searchParams.get("page"), 0, Number.MAX_SAFE_INTEGER, 0);
	const size = intInRange(searchParams.get("size"), MIN_SIZE, MAX_SIZE, DEFAULT_SIZE);

	const setParam = useCallback(
		(key: string, value: string | undefined) => {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					if (value === undefined || value === "") {
						next.delete(key);
					} else {
						next.set(key, value);
					}
					// 필터가 바뀌면 항상 첫 페이지로 돌아간다. 3페이지를 보던 중 필터를
					// 좁히면 결과가 없어 빈 화면이 뜨는 것을 막는다.
					if (key !== "page") {
						next.delete("page");
					}
					return next;
				},
				{ replace: true },
			);
		},
		[setSearchParams],
	);

	const setPage = useCallback((next: number) => setParam("page", String(next)), [setParam]);
	const setSize = useCallback((next: number) => setParam("size", String(next)), [setParam]);
	const get = useCallback((key: string) => searchParams.get(key) ?? undefined, [searchParams]);

	return { page, size, setPage, setSize, setParam, get };
}

function intInRange(raw: string | null, min: number, max: number, fallback: number): number {
	if (raw === null || raw.trim() === "") {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
