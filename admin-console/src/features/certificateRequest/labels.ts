import type { ChipColor } from "../../shared/ui/StatusChip";
import type { CertificateRequestStatus } from "../../shared/api/types";

// api-spec.md §1: Enum은 API에서 영문 대문자로 전달하고 Console에서 한국어로 변환한다.
// ui-design.md §5 상태: 승인 대기, 발급 완료, 거절.

/** 계약에 없는 값을 아는 상태로 단정하지 않는다(features/device/labels.ts와 같은 판단). */
export function requestStatusLabel(status: CertificateRequestStatus): string {
	switch (status) {
		case "PENDING":
			return "승인 대기";
		case "APPROVED":
			return "발급 완료";
		case "REJECTED":
			return "거절";
		default:
			return "알 수 없음";
	}
}

/**
 * 승인 대기는 사람이 처리해야 할 일이 남았다는 뜻이라 warning이다. 거절은 정상적으로
 * 끝난 결정이므로 error가 아니라 조용한 default다 — 붉은색은 폐기·오류에만 남긴다.
 */
export function requestStatusColor(status: CertificateRequestStatus): ChipColor {
	switch (status) {
		case "PENDING":
			return "warning";
		case "APPROVED":
			return "success";
		case "REJECTED":
			return "default";
		default:
			return "default";
	}
}
