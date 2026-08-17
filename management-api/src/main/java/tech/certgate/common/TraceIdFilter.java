package tech.certgate.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

/**
 * Reads X-Trace-Id from the request or generates one, and makes it available
 * for the duration of the request (docs/api-spec.md: "요청 추적 ID는
 * X-Trace-Id로 전달하고 없으면 서버가 생성한다").
 */
@Component
public class TraceIdFilter extends HttpFilter {

	public static final String HEADER = "X-Trace-Id";
	private static final String MDC_KEY = "traceId";
	private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

	public static String current() {
		String traceId = CURRENT.get();
		return traceId != null ? traceId : "unknown";
	}

	// Caps external Trace ID length/charset so a client can't inject arbitrary
	// bytes into logs or the response header via X-Trace-Id.
	private static final java.util.regex.Pattern VALID_TRACE_ID = java.util.regex.Pattern.compile("[A-Za-z0-9._-]{1,100}");

	@Override
	protected void doFilter(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		String traceId = request.getHeader(HEADER);
		if (traceId == null || !VALID_TRACE_ID.matcher(traceId).matches()) {
			traceId = UUID.randomUUID().toString();
		}
		CURRENT.set(traceId);
		MDC.put(MDC_KEY, traceId);
		response.setHeader(HEADER, traceId);
		try {
			chain.doFilter(request, response);
		} finally {
			CURRENT.remove();
			MDC.remove(MDC_KEY);
		}
	}
}
