import { http, HttpResponse } from "msw";
import * as fixtures from "./fixtures";
import { filterPage, includesCaseInsensitive, withinRange } from "./filterPage";
import type { SecurityEvent } from "../shared/api/types";

const BASE = "/api/v1";

/**
 * Mock 모드에서 SSE로 새로 "발생시킨" Event. 목록·상세 handler가 fixture와 함께
 * 돌려주므로 Toast를 눌러 상세로 들어가는 흐름까지 이어진다.
 *
 * Provider는 마운트할 때 서버에서 최신 CRITICAL을 읽어 커서를 세우고 그것들을 "이미
 * 본 것"으로 표시한다 — 페이지를 열기 전의 기록으로 알림을 띄우지 않기 위해서다.
 * 그래서 데모용 Event는 fixture에 미리 넣어 두면 안 되고, 연결 뒤에 새로 생겨야 한다.
 */
const liveCriticalEvents: SecurityEvent[] = [];

function allSecurityEvents(): SecurityEvent[] {
	return [...liveCriticalEvents, ...fixtures.securityEventPage.content];
}

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
				params,
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
				params,
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
					// 서버도 expiresBefore만 배타(`c.notAfter < :expiresBefore`)다.
					(!expiresBefore || item.notAfter < expiresBefore),
				params,
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
				allSecurityEvents(),
				(event) =>
					withinRange(event.occurredAt, from, to) &&
					(!deviceId || event.deviceId === deviceId) &&
					(!decision || event.decision === decision) &&
					(!reasonCode || event.reasonCode === reasonCode) &&
					(!severity || event.severity === severity),
				params,
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
					// 연결 뒤에 새로 생긴 Event여야 한다 — fixture에 이미 있는 것은 Provider가
					// 페이지를 열기 전의 기록으로 보고 알리지 않는다.
					const event = fixtures.newCriticalEvent(new Date().toISOString());
					liveCriticalEvents.unshift(event);
					const data = JSON.stringify(fixtures.criticalEventPayload(event));
					controller.enqueue(encoder.encode(`event: critical-security-event\ndata: ${data}\n\n`));
				}, 3_000);
			},
		});
		return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
	}),
	/*
	 * id로 실제로 찾는다. 무엇을 주든 첫 번째 Event를 돌려주면, CRITICAL Toast·Dashboard
	 * 패널이 "원인이 된 그 Event"를 여는지 화면 테스트가 검증할 수 없다.
	 */
	http.get(`${BASE}/security-events/:eventId`, ({ params }) => {
		const found = allSecurityEvents().find((event) => event.id === params.eventId);
		return found
			? HttpResponse.json(found)
			: HttpResponse.json(
					{ code: "SECURITY_EVENT_NOT_FOUND", message: "보안 이벤트를 찾을 수 없습니다.", traceId: "mock" },
					{ status: 404 },
				);
	}),

	http.get(`${BASE}/dashboard/summary`, () => HttpResponse.json(fixtures.dashboardSummary)),
];
