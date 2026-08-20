import { http, HttpResponse } from "msw";
import * as fixtures from "./fixtures";
import { filterPage, includesCaseInsensitive } from "./filterPage";

const BASE = "/api/v1";

export const handlers = [
	http.get(`${BASE}/roles`, () => HttpResponse.json(fixtures.roles)),

	http.get(`${BASE}/devices`, ({ request }) => {
		const params = new URL(request.url).searchParams;
		const query = params.get("query");
		const status = params.get("status");
		const roleName = params.get("roleName");
		return HttpResponse.json(
			filterPage(
				fixtures.devicePage.content,
				(device) =>
					(includesCaseInsensitive(device.name, query) || includesCaseInsensitive(device.deviceKey, query)) &&
					(!status || device.status === status) &&
					(!roleName || device.roleName === roleName),
			),
		);
	}),
	/* 평문 Token은 등록·재발급 응답에만 한 번 온다(security-design.md §2). */
	http.post(`${BASE}/devices`, () => HttpResponse.json(fixtures.deviceRegistered, { status: 201 })),
	http.patch(`${BASE}/devices/:deviceId/status`, () => HttpResponse.json(fixtures.deviceSummary)),
	http.put(`${BASE}/devices/:deviceId/role`, () => HttpResponse.json(fixtures.deviceSummary)),
	http.post(`${BASE}/devices/:deviceId/enrollment-token`, () =>
		HttpResponse.json(fixtures.enrollmentTokenIssued),
	),
	http.get(`${BASE}/devices/:deviceId`, () => HttpResponse.json(fixtures.deviceDetail)),

	http.get(`${BASE}/certificate-requests`, ({ request }) => {
		const params = new URL(request.url).searchParams;
		const status = params.get("status");
		const deviceId = params.get("deviceId");
		return HttpResponse.json(
			filterPage(
				fixtures.certificateRequestPage.content,
				(item) => (!status || item.status === status) && (!deviceId || item.deviceId === deviceId),
			),
		);
	}),
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

	http.get(`${BASE}/certificates`, ({ request }) => {
		const params = new URL(request.url).searchParams;
		const status = params.get("status");
		const deviceId = params.get("deviceId");
		const expiresBefore = params.get("expiresBefore");
		return HttpResponse.json(
			filterPage(
				fixtures.certificatePage.content,
				(item) =>
					(!status || item.status === status) &&
					(!deviceId || item.deviceId === deviceId) &&
					(!expiresBefore || item.notAfter < expiresBefore),
			),
		);
	}),
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

	http.get(`${BASE}/security-events`, ({ request }) => {
		const params = new URL(request.url).searchParams;
		const from = params.get("from");
		const to = params.get("to");
		const deviceId = params.get("deviceId");
		const decision = params.get("decision");
		const reasonCode = params.get("reasonCode");
		const severity = params.get("severity");
		return HttpResponse.json(
			filterPage(
				fixtures.securityEventPage.content,
				(event) =>
					(!from || event.occurredAt >= from) &&
					(!to || event.occurredAt < to) &&
					(!deviceId || event.deviceId === deviceId) &&
					(!decision || event.decision === decision) &&
					(!reasonCode || event.reasonCode === reasonCode) &&
					(!severity || event.severity === severity),
			),
		);
	}),
	http.get(`${BASE}/security-events/:eventId`, () =>
		HttpResponse.json(fixtures.securityEventPage.content[0]),
	),

	http.get(`${BASE}/dashboard/summary`, () => HttpResponse.json(fixtures.dashboardSummary)),
];
