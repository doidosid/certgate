import type { PageResponse } from "../shared/api/types";

/**
 * MSW handler가 쿼리 파라미터로 실제 필터링을 하게 만드는 헬퍼.
 *
 * 이게 없으면 목록 handler가 고정된 fixture를 항상 그대로 돌려준다 — 실제 서버는
 * 필터링하는데(예: CertificateRequestAdminController) Mock은 안 하니, 화면에서 상태를
 * 바꿔도 같은 목록이 보여 "필터가 안 먹는다"는 인상을 준다(사용자가 실제로 겪은 문제).
 * 실제 서버 동작을 재현하는 것이지 서버를 대체하는 것이 아니다 — 페이지네이션까지는
 * 흉내내지 않는다. size는 항상 전체 필터 결과 수다.
 */
/** api-spec.md §1: size 기본값. 실제 서버 Controller의 DEFAULT_PAGE_SIZE와 같다. */
const DEFAULT_PAGE_SIZE = 20;

export function filterPage<T>(all: T[], predicate: (item: T) => boolean): PageResponse<T> {
	const content = all.filter(predicate);
	return { content, page: 0, size: DEFAULT_PAGE_SIZE, totalElements: content.length, totalPages: 1 };
}

/** 대소문자 구분 없이 부분 일치. `query` 파라미터가 비었으면 항상 통과한다. */
export function includesCaseInsensitive(haystack: string, needle: string | null): boolean {
	if (!needle) {
		return true;
	}
	return haystack.toLowerCase().includes(needle.toLowerCase());
}
