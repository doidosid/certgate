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

function isErrorResponse(body: unknown): body is ErrorResponse {
	return (
		typeof body === "object" &&
		body !== null &&
		typeof (body as { code?: unknown }).code === "string" &&
		typeof (body as { message?: unknown }).message === "string"
	);
}

async function toApiError(response: Response, traceId: string): Promise<ApiError> {
	try {
		const body: unknown = await response.json();
		if (isErrorResponse(body)) {
			return new ApiError(response.status, {
				...body,
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
