import type { ChipColor } from "../../shared/ui/StatusChip";
import type { CertificateStatus, DeviceStatus } from "../../shared/api/types";

// api-spec.md §1: Enum은 API에서 영문 대문자로 전달하고 Console에서 한국어로 변환한다.

/** 모르는 값을 "비활성"이라고 단정하지 않는다 — 계약이 어긋난 것과 실제 비활성은 다르다. */
export function deviceStatusLabel(status: DeviceStatus): string {
	switch (status) {
		case "ACTIVE":
			return "활성";
		case "DISABLED":
			return "비활성";
		default:
			return "알 수 없음";
	}
}

export function deviceStatusColor(status: DeviceStatus): ChipColor {
	return status === "ACTIVE" ? "success" : "default";
}

/**
 * null은 "아직 인증서가 없다"는 서버의 실제 상태이고, 그 외의 모르는 값은 계약이
 * 어긋났다는 뜻이다. 둘을 같은 문구로 합치면 계약 불일치가 "인증서 없음"으로
 * 위장된다(Codex 리뷰 PR #44 Low). TypeScript union은 compile-time에만 유효하므로
 * 런타임에 새 Enum이 들어올 수 있다.
 */
export function certificateStatusLabel(status: CertificateStatus | null): string {
	switch (status) {
		case "VALID":
			return "유효";
		case "EXPIRING_SOON":
			return "만료 임박";
		case "EXPIRED":
			return "만료";
		case "REVOKED":
			return "폐기";
		case null:
			return "발급 없음";
		default:
			return "알 수 없음";
	}
}

export function certificateStatusColor(status: CertificateStatus | null): ChipColor {
	switch (status) {
		case "VALID":
			return "success";
		case "EXPIRING_SOON":
			return "warning";
		case "EXPIRED":
			return "default";
		case "REVOKED":
			return "error";
		default:
			return "default";
	}
}
