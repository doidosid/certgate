package tech.certgate.common;

import java.util.List;

/** docs/api-spec.md 오류 응답 형식. */
public record ErrorResponse(String code, String message, String traceId, List<FieldError> fieldErrors) {

	public record FieldError(String field, String message) {
	}

	public static ErrorResponse of(String code, String message, String traceId) {
		return new ErrorResponse(code, message, traceId, List.of());
	}
}
