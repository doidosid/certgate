import type { ChipColor } from "../../shared/ui/StatusChip";
import type { Decision, SecurityEventType, Severity } from "../../shared/api/types";

// api-spec.md §1: Enum은 API에서 영문 대문자로 전달하고 Console에서 한국어로 변환한다.
// TypeScript union은 compile-time에만 유효하므로, 서버가 계약에 없는 값을 보내는
// 경우를 "알 수 없음"으로 드러낸다 — 아는 값 중 하나로 단정하면 계약 불일치가
// 정상 상태로 위장된다(features/device/labels.ts와 같은 판단).

export function decisionLabel(decision: Decision): string {
	switch (decision) {
		case "ALLOWED":
			return "허용";
		case "DENIED":
			return "차단";
		case "ERROR":
			return "오류";
		default:
			return "알 수 없음";
	}
}

/**
 * 차단(DENIED)은 Gateway가 정책대로 판단한 정상 동작이므로 warning이고, 오류
 * (ERROR)는 판단 자체를 못 한 상태라 error다. 색만으로도 둘을 구분할 수 있어야
 * 한다(ui-design.md §7 "결과: 허용, 차단, 오류").
 */
export function decisionColor(decision: Decision): ChipColor {
	switch (decision) {
		case "ALLOWED":
			return "success";
		case "DENIED":
			return "warning";
		case "ERROR":
			return "error";
		default:
			return "default";
	}
}

export function severityLabel(severity: Severity): string {
	switch (severity) {
		case "CRITICAL":
			return "심각";
		case "WARNING":
			return "경고";
		case "INFO":
			return "정보";
		default:
			return "알 수 없음";
	}
}

export function severityColor(severity: Severity): ChipColor {
	switch (severity) {
		case "CRITICAL":
			return "error";
		case "WARNING":
			return "warning";
		case "INFO":
			return "info";
		default:
			return "default";
	}
}

/** data-model.md SecurityEvent의 type: ACCESS, TLS, SYSTEM, PKI. */
export function eventTypeLabel(type: SecurityEventType): string {
	switch (type) {
		case "ACCESS":
			return "접근";
		case "TLS":
			return "TLS";
		case "SYSTEM":
			return "시스템";
		case "PKI":
			return "인증서 발급";
		default:
			return "알 수 없음";
	}
}

/**
 * Security Event로 저장될 수 있는 Reason Code만 필터 선택지에 넣는다. 근거는
 * gateway/internal/event/event.go의 상수와 Management API의 CA 서명 실패 기록이다.
 *
 * api-spec.md §10 목록 전체를 쓰지 않는 이유: 그 목록에는 HTTP 오류 응답 code도
 * 섞여 있고, CERTIFICATE_REQUIRED처럼 TLS handshake에서 끝나 Security Event가
 * 되지 않는 것도 있다(security-design.md §5, event.go 주석). 저장될 수 없는 값을
 * 선택지로 주면 사용자는 결과가 0건인 이유를 알 수 없다.
 */
export const SECURITY_EVENT_REASON_CODES = [
	"REQUEST_ALLOWED",
	"ACCESS_DENIED",
	"DEVICE_DISABLED",
	"DEVICE_NOT_REGISTERED",
	"CERTIFICATE_REVOKED",
	"CERTIFICATE_EXPIRED",
	"INVALID_CERTIFICATE",
	"CA_SIGNING_FAILED",
	"EVENT_OUTBOX_BACKLOG",
	"EVENT_DELIVERY_DELAYED",
	"INTERNAL_ERROR",
] as const;
