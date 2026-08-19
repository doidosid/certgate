package tech.certgate.common;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.springframework.boot.logging.structured.StructuredLogFormatter;

/**
 * Emits the JSON structured log fields docs/operations.md "로그" requires. The Go
 * Gateway already logs with these exact names, so both services can be read as
 * one stream with one schema.
 *
 * <p>Optional fields come from the MDC that {@link TraceIdFilter} populates and
 * are omitted when absent. Secrets, Tokens, Private Keys, full CSR/Certificate
 * bodies and Telemetry payloads never reach this formatter because nothing puts
 * them in the MDC — that is the rule, not something this class can enforce
 * (docs/security-design.md §10).
 *
 * <p>Enabled by pointing {@code logging.structured.format.console} at this
 * class. The service name is a constant rather than being read from
 * {@code spring.application.name}: the logging system initializes before the
 * Environment is bound, so a formatter cannot rely on property resolution.
 */
public class CertGateLogFormatter implements StructuredLogFormatter<ILoggingEvent> {

	private static final String SERVICE = "management-api";
	private static final DateTimeFormatter TIMESTAMP = DateTimeFormatter.ISO_INSTANT;

	private final ObjectMapper objectMapper = new ObjectMapper();

	@Override
	public String format(ILoggingEvent event) {
		ObjectNode json = this.objectMapper.createObjectNode();
		json.put("timestamp", TIMESTAMP.format(event.getInstant().atOffset(ZoneOffset.UTC)));
		json.put("level", event.getLevel().toString());
		json.put("service", SERVICE);
		json.put("logger", event.getLoggerName());
		json.put("message", event.getFormattedMessage());

		Map<String, String> mdc = event.getMDCPropertyMap();
		putIfPresent(json, mdc, "traceId");
		putIfPresent(json, mdc, "deviceKey");
		putIfPresent(json, mdc, "reasonCode");
		putIntIfPresent(json, mdc, "latencyMs");

		IThrowableProxy throwable = event.getThrowableProxy();
		if (throwable != null) {
			json.put("error", ThrowableProxyUtil.asString(throwable));
		}

		// Jackson escapes newlines and quotes in message/error, so one event is
		// always one line. The trailing newline is the StructuredLogFormatter
		// contract -- the appender does not add one.
		return json.toString() + "\n";
	}

	private static void putIfPresent(ObjectNode json, Map<String, String> mdc, String key) {
		String value = mdc.get(key);
		if (value != null && !value.isBlank()) {
			json.put(key, value);
		}
	}

	private static void putIntIfPresent(ObjectNode json, Map<String, String> mdc, String key) {
		String value = mdc.get(key);
		if (value == null || value.isBlank()) {
			return;
		}
		try {
			json.put(key, Integer.parseInt(value));
		} catch (NumberFormatException notANumber) {
			// Carry it through as a string instead of dropping it: a malformed
			// value is itself worth seeing in the log.
			json.put(key, value);
		}
	}
}
