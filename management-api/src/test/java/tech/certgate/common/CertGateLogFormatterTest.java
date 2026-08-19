package tech.certgate.common;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * docs/operations.md "로그" requires JSON structured logs with a common field
 * set from every service. The Go Gateway already emits exactly these names; this
 * formatter makes management-api match so both services read as one stream.
 */
class CertGateLogFormatterTest {

	private final CertGateLogFormatter formatter = new CertGateLogFormatter();
	private final ObjectMapper objectMapper = new ObjectMapper();

	/** Derived from the instant rather than a literal epoch value, so the expectation cannot drift from the arithmetic. */
	private static final Instant OCCURRED_AT = Instant.parse("2026-08-19T05:50:00Z");

	private LoggingEvent event(Level level, String message, Map<String, String> mdc) {
		LoggingEvent event = new LoggingEvent();
		event.setLoggerContext(new LoggerContext());
		event.setLoggerName("tech.certgate.device.DeviceService");
		event.setLevel(level);
		event.setMessage(message);
		event.setTimeStamp(OCCURRED_AT.toEpochMilli());
		event.setMDCPropertyMap(mdc);
		return event;
	}

	private JsonNode format(LoggingEvent event) throws Exception {
		String line = formatter.format(event);
		assertThat(line).endsWith("\n");
		return objectMapper.readTree(line);
	}

	@Test
	void format_emitsCommonFieldsAsOneJsonLine() throws Exception {
		JsonNode json = format(event(Level.WARN, "device disabled", Map.of()));

		assertThat(json.get("timestamp").asText()).isEqualTo("2026-08-19T05:50:00Z");
		assertThat(json.get("level").asText()).isEqualTo("WARN");
		assertThat(json.get("service").asText()).isEqualTo("management-api");
		assertThat(json.get("message").asText()).isEqualTo("device disabled");
		assertThat(json.get("logger").asText()).isEqualTo("tech.certgate.device.DeviceService");
	}

	/**
	 * TraceIdFilter already puts traceId in the MDC, but nothing printed it: the
	 * default Spring pattern ignores MDC, so no log line carried a Trace ID at
	 * all. Without it an error cannot be tied back to a request
	 * (docs/api-spec.md §1).
	 */
	@Test
	void format_includesTraceIdAndOptionalContextFromMdc() throws Exception {
		JsonNode json = format(event(Level.WARN, "blocked", Map.of(
				"traceId", "8a6ba949-f3ec-4916-aae2-d55bd787893d",
				"deviceKey", "sensor-floor-03",
				"reasonCode", "CERTIFICATE_REVOKED",
				"latencyMs", "8")));

		assertThat(json.get("traceId").asText()).isEqualTo("8a6ba949-f3ec-4916-aae2-d55bd787893d");
		assertThat(json.get("deviceKey").asText()).isEqualTo("sensor-floor-03");
		assertThat(json.get("reasonCode").asText()).isEqualTo("CERTIFICATE_REVOKED");
		assertThat(json.get("latencyMs").asInt()).isEqualTo(8);
	}

	/** Absent optional fields are omitted rather than emitted as null noise. */
	@Test
	void format_omitsOptionalFieldsWhenMdcIsEmpty() throws Exception {
		JsonNode json = format(event(Level.INFO, "started", Map.of()));

		assertThat(json.has("traceId")).isFalse();
		assertThat(json.has("deviceKey")).isFalse();
		assertThat(json.has("reasonCode")).isFalse();
		assertThat(json.has("latencyMs")).isFalse();
	}

	/** A newline inside the message must not break the one-event-one-line contract. */
	@Test
	void format_escapesNewlinesSoOneEventStaysOneLine() throws Exception {
		String line = formatter.format(event(Level.ERROR, "first\nsecond", Map.of()));

		assertThat(line.strip()).doesNotContain("\n");
		assertThat(objectMapper.readTree(line).get("message").asText()).isEqualTo("first\nsecond");
	}

	/** Parameterized messages must be rendered, not left as "{}" placeholders. */
	@Test
	void format_rendersParameterizedMessages() throws Exception {
		LoggingEvent event = event(Level.WARN, "revocation failed for {}", Map.of());
		event.setArgumentArray(new Object[] {"7F28A109"});

		assertThat(format(event).get("message").asText()).isEqualTo("revocation failed for 7F28A109");
	}

	/**
	 * A latencyMs that is not a number must not break the line. It is carried
	 * through as a string rather than dropped, so the anomaly stays visible.
	 */
	@Test
	void format_keepsNonNumericLatencyAsString() throws Exception {
		JsonNode json = format(event(Level.INFO, "odd", Map.of("latencyMs", "fast")));

		assertThat(json.get("latencyMs").asText()).isEqualTo("fast");
	}

	@Test
	void format_includesExceptionTypeAndStackTrace() throws Exception {
		LoggingEvent event = event(Level.ERROR, "failed", Map.of());
		event.setThrowableProxy(new ch.qos.logback.classic.spi.ThrowableProxy(
				new IllegalStateException("database is locked")));

		String error = format(event).get("error").asText();
		assertThat(error).contains("IllegalStateException").contains("database is locked");
	}
}
