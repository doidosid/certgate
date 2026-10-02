package tech.certgate.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.PathContainer;
import org.springframework.http.server.RequestPath;
import org.springframework.stereotype.Component;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/**
 * Guards <code>/internal/**</code> (docs/api-spec.md §2 "Gateway 내부 API")
 * with the shared Gateway Service Token. Runs after TraceIdFilter so its own
 * error response can carry a Trace ID.
 *
 * <p>Whether a request is internal is decided the way Spring MVC matches
 * Handlers, not from the raw <code>getRequestURI()</code> alone: MVC
 * percent-decodes each segment and drops <code>;param</code>s, so
 * <code>/%69nternal/...</code> and <code>/internal;x=1/...</code> reach
 * <code>/internal/**</code> Handlers while failing a raw prefix check. The raw
 * URI and Tomcat's normalized servlet path are checked too, so a difference
 * between the normalizations fails closed rather than open.
 */
@Component
@Order(2)
public class GatewayServiceTokenFilter extends HttpFilter {

	private static final String INTERNAL_PREFIX = "/internal/";
	private static final PathPattern INTERNAL_PATH = PathPatternParser.defaultInstance.parse("/internal/**");

	private final String serviceToken;
	private final ObjectMapper objectMapper;

	public GatewayServiceTokenFilter(@Value("${certgate.gateway.service-token:}") String serviceToken, ObjectMapper objectMapper) {
		this.serviceToken = serviceToken;
		this.objectMapper = objectMapper;
	}

	@Override
	protected void doFilter(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws IOException, ServletException {
		if (!isInternal(request)) {
			chain.doFilter(request, response);
			return;
		}

		String header = request.getHeader("Authorization");
		if (!isValid(header)) {
			response.setStatus(HttpStatus.UNAUTHORIZED.value());
			response.setContentType(MediaType.APPLICATION_JSON_VALUE);
			objectMapper.writeValue(
					response.getWriter(),
					ErrorResponse.of("SERVICE_TOKEN_INVALID", "Gateway Service Token이 유효하지 않습니다.", TraceIdFilter.current()));
			return;
		}

		chain.doFilter(request, response);
	}

	private static boolean isInternal(HttpServletRequest request) {
		if (request.getRequestURI().startsWith(INTERNAL_PREFIX)) {
			return true;
		}
		String pathInfo = request.getPathInfo();
		String servletPath = request.getServletPath() + (pathInfo == null ? "" : pathInfo);
		if (servletPath.startsWith(INTERNAL_PREFIX)) {
			return true;
		}
		PathContainer mvcPath = RequestPath.parse(request.getRequestURI(), request.getContextPath()).pathWithinApplication();
		return INTERNAL_PATH.matches(mvcPath);
	}

	private boolean isValid(String authorizationHeader) {
		if (serviceToken.isBlank() || authorizationHeader == null) {
			return false;
		}
		byte[] expected = ("Bearer " + serviceToken).getBytes(StandardCharsets.UTF_8);
		byte[] actual = authorizationHeader.getBytes(StandardCharsets.UTF_8);
		return MessageDigest.isEqual(expected, actual);
	}
}
