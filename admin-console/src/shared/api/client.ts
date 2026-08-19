import { apiBaseUrl } from "./env";
import { ApiError, unexpectedError } from "./ApiError";
import type { ErrorResponse } from "./types";

export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue>;

/**
 * 값이 있는 Query Parameter만 붙인다. 빈 문자열을 그대로 보내면 서버가 빈 필터를
 * 조건으로 해석해 결과가 사라지므로 여기서 걸러낸다.
 */
function buildUrl(path: string, params?: QueryParams): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params ?? {})) {
		if (value === undefined || value === null || value === "") {
			continue;
		}
		search.set(key, String(value));
	}
	const query = search.toString();
	return `${apiBaseUrl}${path}${query ? `?${query}` : ""}`;
}

function isFieldErrorArray(value: unknown): value is ErrorResponse["fieldErrors"] {
	return (
		Array.isArray(value) &&
		value.every(
			(item) =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as { field?: unknown }).field === "string" &&
				typeof (item as { message?: unknown }).message === "string",
		)
	);
}

/**
 * 계약(docs/api-spec.md §1 "오류 응답")을 실제 형태까지 확인한다. code·message만
 * 보고 통과시키면 traceId가 객체인 응답이 그대로 ApiError에 들어가고, 그 값을
 * JSX로 렌더링하는 순간 오류 화면 자체가 사라진다.
 *
 * traceId는 없거나 비어 있을 수 있다 — 그 경우만 호출 쪽 X-Trace-Id로 보완하고,
 * 타입 자체가 틀린 응답은 계약 위반으로 보고 unexpectedError로 내린다.
 */
function isErrorResponse(body: unknown): body is Omit<ErrorResponse, "traceId" | "fieldErrors"> & {
	// null도 통과시키므로(누락과 같게 취급해 아래에서 정규화한다) Type에도 그대로 적는다.
	traceId?: string | null;
	fieldErrors?: ErrorResponse["fieldErrors"] | null;
} {
	if (typeof body !== "object" || body === null) {
		return false;
	}
	const candidate = body as Record<string, unknown>;
	if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
		return false;
	}
	if (candidate.traceId !== undefined && candidate.traceId !== null && typeof candidate.traceId !== "string") {
		return false;
	}
	if (candidate.fieldErrors !== undefined && candidate.fieldErrors !== null && !isFieldErrorArray(candidate.fieldErrors)) {
		return false;
	}
	return true;
}

async function toApiError(response: Response, traceId: string): Promise<ApiError> {
	try {
		const body: unknown = await response.json();
		if (isErrorResponse(body)) {
			return new ApiError(response.status, {
				code: body.code,
				message: body.message,
				// 서버가 traceId를 비워 보내도 진단 단서를 잃지 않도록 요청 쪽 ID로 되돌린다.
				traceId: body.traceId || traceId,
				fieldErrors: body.fieldErrors ?? [],
			});
		}
	} catch {
		// 오류 본문이 JSON이 아닌 경우(Proxy 502 HTML 등)는 아래로 떨어진다.
	}
	return unexpectedError(response.status, traceId);
}

async function request(method: string, path: string, params?: QueryParams, body?: unknown): Promise<Response> {
	// api-spec.md §1: 요청 추적 ID는 X-Trace-Id로 전달하고 없으면 서버가 생성한다.
	const traceId = crypto.randomUUID();
	const headers: Record<string, string> = { "X-Trace-Id": traceId, Accept: "application/json" };
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const response = await fetch(buildUrl(path, params), {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	if (!response.ok) {
		throw await toApiError(response, traceId);
	}
	return response;
}

async function readJson<T>(response: Response): Promise<T> {
	if (response.status === 204 || response.headers.get("Content-Length") === "0") {
		return undefined as T;
	}
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
	return readJson<T>(await request("GET", path, params));
}

export async function apiSend<T>(
	method: "POST" | "PUT" | "PATCH",
	path: string,
	body?: unknown,
): Promise<T> {
	return readJson<T>(await request(method, path, undefined, body));
}

/** GET /certificates/{id}/download는 JSON이 아니라 PEM 문자열을 돌려준다. */
export async function apiGetText(path: string): Promise<string> {
	return (await request("GET", path)).text();
}
