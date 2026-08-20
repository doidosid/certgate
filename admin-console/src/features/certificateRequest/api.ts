import { apiGet, apiSend } from "../../shared/api/client";
import type {
	CertificateRequestDetail,
	CertificateRequestItem,
	PageResponse,
} from "../../shared/api/types";

/** api-spec.md §4 "관리자 CSR 관리". status는 서버에서 Enum으로 변환된다. */
export interface CertificateRequestListParams {
	status?: string;
	deviceId?: string;
	page: number;
	size: number;
}

export type DecisionAction = "approve" | "reject";

export function fetchCertificateRequests(
	params: CertificateRequestListParams,
): Promise<PageResponse<CertificateRequestItem>> {
	return apiGet("/certificate-requests", { ...params });
}

/**
 * 상세에도 CSR 원문(csrPem)은 없다 — 서버 응답이 아예 담지 않는다
 * (CertificateRequestDetailResponse). 화면에도 표시할 것이 없다는 뜻이다
 * (ui-design.md §5 "Device 개인키는 서버와 관리 화면에 저장하거나 표시하지 않는다").
 */
export function fetchCertificateRequest(requestId: string): Promise<CertificateRequestDetail> {
	return apiGet(`/certificate-requests/${requestId}`);
}

/** 서버는 본문 생략을 허용한다(DecisionRequest는 @RequestBody(required = false)). */
export function decideRequest(
	requestId: string,
	action: DecisionAction,
	decisionNote?: string,
): Promise<CertificateRequestItem> {
	const note = decisionNote?.trim();
	return apiSend("POST", `/certificate-requests/${requestId}/${action}`, note ? { decisionNote: note } : undefined);
}
