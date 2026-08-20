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
	/*
	 * Mock 모드에서도 CRITICAL Toast를 눈으로 확인할 수 있게 SSE를 흉내낸다. 이게 없으면
	 * EventSource가 연결에 실패해 3초마다 무한 재시도한다. 실제 서버는 CRITICAL Event가
	 * 저장될 때만 보내므로 시점을 재현할 수 없다 — 연결 3초 뒤 한 번 보내는 것으로 대신한다.
	 * 이 경로는 :eventId 상세보다 먼저 와야 한다(msw는 먼저 맞는 handler를 쓴다).
	 */
	http.get(`${BASE}/security-events/stream`, () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(": connected\n\n"));
				setTimeout(() => {
					const data = JSON.stringify(fixtures.criticalEventPayload);
					controller.enqueue(encoder.encode(`event: critical-security-event\ndata: ${data}\n\n`));
				}, 3_000);
			},
		});
		return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
	}),
	http.get(`${BASE}/security-events/:eventId`, () =>
		HttpResponse.json(fixtures.securityEventPage.content[0]),
	),

	http.get(`${BASE}/dashboard/summary`, () => HttpResponse.json(fixtures.dashboardSummary)),
];
