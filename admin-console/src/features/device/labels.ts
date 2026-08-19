import type { ChipColor } from "../../shared/ui/StatusChip";
import type { CertificateStatus, DeviceStatus } from "../../shared/api/types";

// api-spec.md §1: Enum은 API에서 영문 대문자로 전달하고 Console에서 한국어로 변환한다.

export function deviceStatusLabel(status: DeviceStatus): string {
	return status === "ACTIVE" ? "활성" : "비활성";
}

export function deviceStatusColor(status: DeviceStatus): ChipColor {
	return status === "ACTIVE" ? "success" : "default";
}

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
		default:
			return "발급 없음";
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
