package tech.certgate.common;

import org.springframework.http.HttpStatus;

/**
 * Carries an HTTP status, an internal Reason Code (docs/api-spec.md), and a
 * user-facing message kept separate from the Reason Code.
 */
public class ApiException extends RuntimeException {

	private final HttpStatus status;
	private final String reasonCode;

	public ApiException(HttpStatus status, String reasonCode, String userMessage) {
		super(userMessage);
		this.status = status;
		this.reasonCode = reasonCode;
	}

	public HttpStatus getStatus() {
		return status;
	}

	public String getReasonCode() {
		return reasonCode;
	}
}
