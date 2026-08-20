import type { PageResponse } from "../shared/api/types";

/**
 * MSW handler가 쿼리 파라미터로 실제 필터링과 pagination을 하게 만드는 헬퍼.
 *
 * 이게 없으면 목록 handler가 고정된 fixture를 항상 그대로 돌려준다 — 실제 서버는
 * 필터링하는데(예: CertificateRequestAdminController) Mock은 안 하니, 화면에서 상태를
 * 바꿔도 같은 목록이 보여 "필터가 안 먹는다"는 인상을 준다(사용자가 실제로 겪은 문제).
 * 실제 서버 동작을 재현하는 것이지 서버를 대체하는 것이 아니다.
 */

/** api-spec.md §1: size 기본 20, 최대 100. 서버 Controller도 이 범위로 clamp한다. */
const DEFAULT_PAGE_SIZE = 20;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

function intParam(raw: string | null, min: number, max: number, fallback: number): number {
	if (raw === null || raw.trim() === "") {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

/**
 * `params`를 넘기면 서버와 같은 방식으로 page를 자른다. 넘기지 않으면 전체를 한
 * 페이지로 돌려준다(pagination이 없는 보조 조회용).
 *
 * 빈 결과의 `totalPages`는 Spring `Page`와 같이 **0**이다 — 1로 두면 화면이 "1페이지가
 * 있는데 비어 있다"로 오해할 수 있고 실제 서버 응답과도 다르다
 * (Codex 리뷰 PR #49 Medium).
 */
export function filterPage<T>(
	all: T[],
	predicate: (item: T) => boolean,
	params?: URLSearchParams,
): PageResponse<T> {
	const matched = all.filter(predicate);
	const size = intParam(params?.get("size") ?? null, MIN_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
	const totalPages = Math.ceil(matched.length / size);
	const page = intParam(params?.get("page") ?? null, 0, Number.MAX_SAFE_INTEGER, 0);
	return {
		content: matched.slice(page * size, page * size + size),
		page,
		size,
		totalElements: matched.length,
		totalPages,
	};
}

/** 대소문자 구분 없이 부분 일치. `query` 파라미터가 비었으면 항상 통과한다. */
export function includesCaseInsensitive(haystack: string, needle: string | null): boolean {
	if (!needle) {
		return true;
	}
	return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * 서버의 기간 필터와 같은 경계를 쓴다 — `from`은 `>=`, `to`는 `<=` 둘 다 **포함**이다
 * (`SecurityEventRepository#search`, `CertificateRepository#search`). Mock만 `to`를
 * 배타로 두면 종료 시각과 정확히 같은 Event가 화면 테스트에서만 사라진다
 * (Codex 리뷰 PR #49 Medium).
 */
export function withinRange(value: string, from: string | null, to: string | null): boolean {
	return (!from || value >= from) && (!to || value <= to);
}
