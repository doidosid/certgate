import { http, HttpResponse } from "msw";
import * as fixtures from "./fixtures";

const BASE = "/api/v1";

export const handlers = [
	http.get(`${BASE}/roles`, () => HttpResponse.json(fixtures.roles)),
	http.get(`${BASE}/devices`, () => HttpResponse.json(fixtures.devicePage)),
	http.get(`${BASE}/devices/:deviceId`, () => HttpResponse.json(fixtures.deviceDetail)),
	http.get(`${BASE}/certificate-requests`, () => HttpResponse.json(fixtures.certificateRequestPage)),
	http.get(`${BASE}/certificate-requests/:requestId`, () =>
		HttpResponse.json(fixtures.certificateRequestDetail),
	),
	// 승인·거절은 서버가 바뀐 항목을 돌려준다(CertificateRequestResponse).
	http.post(`${BASE}/certificate-requests/:requestId/approve`, () =>
		HttpResponse.json({ ...fixtures.certificateRequestPage.content[0], status: "APPROVED" }),
	),
	http.post(`${BASE}/certificate-requests/:requestId/reject`, () =>
		HttpResponse.json({ ...fixtures.certificateRequestPage.content[0], status: "REJECTED" }),
	),
	http.get(`${BASE}/certificates`, () => HttpResponse.json(fixtures.certificatePage)),
	http.get(`${BASE}/certificates/:certificateId`, () =>
		HttpResponse.json(fixtures.certificatePage.content[0]),
	),
	/* 원문은 이 endpoint만 준다. JSON이 아니라 PEM 문자열이다(CertificateController). */
	http.get(`${BASE}/certificates/:certificateId/download`, () =>
		HttpResponse.text(fixtures.certificatePem, { headers: { "Content-Type": "application/x-pem-file" } }),
	),
	http.post(`${BASE}/certificates/:certificateId/revoke`, () =>
		HttpResponse.json({
			...fixtures.certificatePage.content[0],
			status: "REVOKED",
			revokedAt: "2026-08-14T02:10:00Z",
			revocationReason: "KEY_COMPROMISE",
			revocationNote: null,
		}),
	),
	http.get(`${BASE}/security-events`, () => HttpResponse.json(fixtures.securityEventPage)),
	http.get(`${BASE}/security-events/:eventId`, () =>
		HttpResponse.json(fixtures.securityEventPage.content[0]),
	),
	http.get(`${BASE}/dashboard/summary`, () => HttpResponse.json(fixtures.dashboardSummary)),
];
