import { apiGet, apiGetText, apiSend } from "../../shared/api/client";
import type { CertificateItem, PageResponse } from "../../shared/api/types";

/** api-spec.md §5 "Certificate API". expiresBefore는 서버가 ISO 8601 Instant로 받는다. */
export interface CertificateListParams {
	status?: string;
	deviceId?: string;
	expiresBefore?: string;
	page: number;
	size: number;
}

export function fetchCertificates(params: CertificateListParams): Promise<PageResponse<CertificateItem>> {
	return apiGet("/certificates", { ...params });
}

export function fetchCertificate(certificateId: string): Promise<CertificateItem> {
	return apiGet(`/certificates/${certificateId}`);
}

/**
 * 공개 인증서만 내려받는다. Device Private Key는 Device가 만들고 밖으로 내보내지
 * 않으므로 서버에 존재하지 않는다(security-design.md).
 *
 * 목록·상세 응답에는 원문이 없고 이 endpoint만 준다(CertificateResponse 주석).
 */
export function downloadCertificatePem(certificateId: string): Promise<string> {
	return apiGetText(`/certificates/${certificateId}/download`);
}

/** reason은 필수·64자 이내, note는 500자 이내다(CertificateService의 검증). */
export function revokeCertificate(
	certificateId: string,
	body: { reason: string; note?: string },
): Promise<CertificateItem> {
	const note = body.note?.trim();
	return apiSend("POST", `/certificates/${certificateId}/revoke`, {
		reason: body.reason.trim(),
		note: note ? note : undefined,
	});
}
