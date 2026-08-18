package tech.certgate.common;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {

	@ExceptionHandler(ApiException.class)
	public ResponseEntity<ErrorResponse> handleApiException(ApiException ex) {
		return ResponseEntity.status(ex.getStatus())
				.body(ErrorResponse.of(ex.getReasonCode(), ex.getMessage(), TraceIdFilter.current()));
	}

	/**
	 * A unique-constraint race lost at commit time (two concurrent requests both
	 * passed the application-level check). Maps to the same Reason Code the
	 * losing request would have gotten if it had lost the race earlier.
	 */
	@ExceptionHandler(DataIntegrityViolationException.class)
	public ResponseEntity<ErrorResponse> handleConflict(DataIntegrityViolationException ex) {
		String message = String.valueOf(ex.getMostSpecificCause().getMessage());
		if (message.contains("idx_certificate_request_pending_per_device")) {
			return conflict("CERTIFICATE_REQUEST_DUPLICATE", "이미 대기 중인 CSR 요청이 있습니다.");
		}
		if (message.contains("device_device_key_key")) {
			return conflict("DEVICE_KEY_DUPLICATE", "이미 등록된 Device Key입니다.");
		}
		if (message.contains("certificate_request_id_key")) {
			return conflict("CERTIFICATE_REQUEST_NOT_PENDING", "이미 처리된 요청입니다.");
		}
		if (message.contains("idx_enrollment_credential_active_per_device")) {
			return conflict("ENROLLMENT_TOKEN_CONFLICT", "Token 발급 요청이 동시에 처리되었습니다.");
		}
		return conflict("CONFLICT", "요청이 현재 상태와 충돌합니다.");
	}

	@ExceptionHandler(MissingRequestHeaderException.class)
	public ResponseEntity<ErrorResponse> handleMissingHeader(MissingRequestHeaderException ex) {
		return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
				.body(ErrorResponse.of("ENROLLMENT_TOKEN_INVALID", "Enrollment Token이 필요합니다.", TraceIdFilter.current()));
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ResponseEntity<ErrorResponse> handleMalformedBody(HttpMessageNotReadableException ex) {
		return ResponseEntity.status(HttpStatus.BAD_REQUEST)
				.body(ErrorResponse.of("MALFORMED_REQUEST_BODY", "요청 본문을 읽을 수 없습니다.", TraceIdFilter.current()));
	}

	/**
	 * A Path Variable or Query Parameter that Spring couldn't convert to its
	 * declared type — e.g. an unknown enum value for {@code status} or a
	 * non-UUID {@code deviceId}. Without this handler it falls through to the
	 * generic 500 below, which hides a client input error as a server fault.
	 */
	@ExceptionHandler(MethodArgumentTypeMismatchException.class)
	public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
		return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ErrorResponse.of(
				"INVALID_REQUEST_PARAMETER", "'" + ex.getName() + "' 값이 올바르지 않습니다.", TraceIdFilter.current()));
	}

	/** A required Query Parameter (e.g. {@code serialNumber}) is missing entirely — same Code as a malformed one. */
	@ExceptionHandler(MissingServletRequestParameterException.class)
	public ResponseEntity<ErrorResponse> handleMissingParameter(MissingServletRequestParameterException ex) {
		return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ErrorResponse.of(
				"INVALID_REQUEST_PARAMETER", "'" + ex.getParameterName() + "' 파라미터가 필요합니다.", TraceIdFilter.current()));
	}

	/** Without this, Spring MVC's standard 405 would be swallowed by the generic 500 Handler below. */
	@ExceptionHandler(HttpRequestMethodNotSupportedException.class)
	public ResponseEntity<ErrorResponse> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
		return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(ErrorResponse.of(
				"METHOD_NOT_ALLOWED", "지원하지 않는 HTTP Method입니다.", TraceIdFilter.current()));
	}

	/** Without this, Spring MVC's standard 415 would be swallowed by the generic 500 Handler below. */
	@ExceptionHandler(HttpMediaTypeNotSupportedException.class)
	public ResponseEntity<ErrorResponse> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException ex) {
		return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(ErrorResponse.of(
				"UNSUPPORTED_MEDIA_TYPE", "지원하지 않는 Content-Type입니다.", TraceIdFilter.current()));
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
				.body(ErrorResponse.of("INTERNAL_ERROR", "내부 오류가 발생했습니다.", TraceIdFilter.current()));
	}

	private ResponseEntity<ErrorResponse> conflict(String code, String message) {
		return ResponseEntity.status(HttpStatus.CONFLICT).body(ErrorResponse.of(code, message, TraceIdFilter.current()));
	}
}
