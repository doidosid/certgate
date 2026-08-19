import type { ErrorResponse, FieldError } from "./types";

/**
 * 서버가 돌려준 오류 계약을 그대로 담는다(docs/api-spec.md §1 "오류 응답").
 * 화면에는 message를, 진단에는 traceId를 쓴다 — 둘을 섞지 않는다.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly traceId: string;
	readonly fieldErrors: FieldError[];

	constructor(status: number, body: ErrorResponse) {
		super(body.message);
		this.name = "ApiError";
		this.status = status;
		this.code = body.code;
		this.traceId = body.traceId;
		this.fieldErrors = body.fieldErrors ?? [];
	}
}

/** 응답 본문이 오류 계약을 따르지 않을 때(502 HTML 등) 쓰는 대체 표현. */
export function unexpectedError(status: number, traceId: string): ApiError {
	return new ApiError(status, {
		code: "INTERNAL_ERROR",
		message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		traceId,
		fieldErrors: [],
	});
}
