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
	http.get(`${BASE}/certificates`, () => HttpResponse.json(fixtures.certificatePage)),
	http.get(`${BASE}/certificates/:certificateId`, () =>
		HttpResponse.json(fixtures.certificatePage.content[0]),
	),
	http.get(`${BASE}/security-events`, () => HttpResponse.json(fixtures.securityEventPage)),
	http.get(`${BASE}/security-events/:eventId`, () =>
		HttpResponse.json(fixtures.securityEventPage.content[0]),
	),
	http.get(`${BASE}/dashboard/summary`, () => HttpResponse.json(fixtures.dashboardSummary)),
];
