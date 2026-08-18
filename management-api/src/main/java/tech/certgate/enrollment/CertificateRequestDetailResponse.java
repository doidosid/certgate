package tech.certgate.enrollment;

import java.time.Instant;
import java.util.UUID;

/**
 * docs/api-spec.md §4 "관리자 CSR 관리" 상세 응답. CSR 원문({@code csrPem})은
 * 제외한다 — Certificate API가 원문을 목록/상세에서 빼고 {@code /download}로만
 * 제공하는 것과 같은 판단이다(PR #24 설계 판단 참고).
 */
public record CertificateRequestDetailResponse(
		UUID id,
		UUID deviceId,
		CertificateRequestStatus status,
		String subjectDn,
		String sanUri,
		String publicKeyAlgorithm,
		String fingerprintSha256,
		Instant requestedAt,
		Instant decidedAt,
		String decisionNote) {

	public static CertificateRequestDetailResponse from(CertificateRequest request) {
		return new CertificateRequestDetailResponse(
				request.getId(), request.getDeviceId(), request.getStatus(), request.getSubjectDn(), request.getSanUri(),
				request.getPublicKeyAlgorithm(), request.getFingerprintSha256(), request.getRequestedAt(),
				request.getDecidedAt(), request.getDecisionNote());
	}
}
