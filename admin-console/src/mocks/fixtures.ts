import type {
	CertificateItem,
	CertificateRequestDetail,
	CertificateRequestItem,
	CriticalEventPayload,
	DashboardSummary,
	DeviceDetail,
	DeviceListItem,
	DeviceRegistered,
	DeviceSummary,
	EnrollmentTokenIssued,
	PageResponse,
	RoleResponse,
	SecurityEvent,
} from "../shared/api/types";

// docs/api-spec.md의 예시 값을 그대로 쓴다. `satisfies`가 계약 불일치를 typecheck
// 단계에서 잡아준다 — Issue #7 완료 기준 "Mock과 실제 API Type이 같다".

function page<T>(content: T[]): PageResponse<T> {
	return { content, page: 0, size: 20, totalElements: content.length, totalPages: 1 };
}

export const devicePage = page<DeviceListItem>([
	{
		id: "0d6515ae-d560-4777-b102-054e71f98ef9",
		deviceKey: "sensor-floor-01",
		name: "1층 온도 센서",
		status: "ACTIVE",
		roleName: "SENSOR",
		certificateStatus: "VALID",
		certificateExpiresAt: "2026-09-12T05:32:18Z",
		lastSeenAt: "2026-08-13T05:31:54Z",
	},
	{
		id: "1a1b2c3d-0000-4000-8000-000000000002",
		deviceKey: "sensor-floor-02",
		name: "2층 온도 센서",
		status: "DISABLED",
		roleName: "SENSOR",
		certificateStatus: null,
		certificateExpiresAt: null,
		lastSeenAt: null,
	},
]) satisfies PageResponse<DeviceListItem>;

export const deviceDetail = {
	id: "0d6515ae-d560-4777-b102-054e71f98ef9",
	deviceKey: "sensor-floor-01",
	name: "1층 온도 센서",
	status: "ACTIVE",
	roleName: "SENSOR",
	createdAt: "2026-08-13T05:32:18Z",
	lastSeenAt: "2026-08-13T05:31:54Z",
	certificate: {
		id: "74ecff78-d52a-4f80-ae54-ac688b1c93ad",
		serialNumber: "7F28A109",
		status: "VALID",
		expiresAt: "2026-09-12T05:32:18Z",
	},
	policyRules: [{ httpMethod: "POST", pathPattern: "/telemetry", effect: "ALLOW", priority: 10 }],
	recentEvents: [
		{
			id: "c8c78370-174f-4f88-b230-784e2d9115be",
			occurredAt: "2026-08-13T05:50:00Z",
			type: "ACCESS",
			severity: "INFO",
			decision: "ALLOWED",
			reasonCode: "REQUEST_ALLOWED",
			httpMethod: "POST",
			requestPath: "/telemetry",
		},
	],
} satisfies DeviceDetail;

/**
 * POST /devices 응답. `enrollmentToken`은 이 응답에만 한 번 담긴다 — 실제 Token이 아니라
 * 모양만 흉내낸 값이다.
 */
export const deviceRegistered = {
	id: "9a9b9c9d-0000-4000-8000-000000000009",
	deviceKey: "sensor-floor-09",
	name: "9층 센서",
	status: "ACTIVE",
	roleName: "SENSOR",
	createdAt: "2026-08-19T05:32:18Z",
	enrollmentToken: "cg_enroll_MOCK_TEST_ONLY_0123456789",
	enrollmentExpiresAt: "2026-08-20T05:32:18Z",
} satisfies DeviceRegistered;

/** PATCH /devices/{id}/status, PUT /devices/{id}/role 응답. */
export const deviceSummary = {
	id: "0d6515ae-d560-4777-b102-054e71f98ef9",
	deviceKey: "sensor-floor-01",
	name: "1층 온도 센서",
	status: "DISABLED",
	roleName: "OPERATOR",
	createdAt: "2026-08-13T05:32:18Z",
	lastSeenAt: "2026-08-13T05:31:54Z",
} satisfies DeviceSummary;

/** POST /devices/{id}/enrollment-token 응답. 재발급하면 기존 활성 Token은 폐기된다. */
export const enrollmentTokenIssued = {
	enrollmentToken: "cg_enroll_MOCK_REISSUED_9876543210",
	enrollmentExpiresAt: "2026-08-20T06:00:00Z",
} satisfies EnrollmentTokenIssued;

/**
 * 세 상태를 모두 담아 둔다. 상태 필터가 실제로 다른 결과를 보여주는지 Mock 모드에서도
 * 확인할 수 있어야 한다 — 항목이 하나뿐이면 어떤 상태를 선택해도 같은 값이 보이거나
 * 빈 목록만 나와서, 필터가 "안 먹는 것"처럼 보인다(실제로는 서버 계약이 아니라 이
 * Mock의 표현력 문제였다).
 */
export const certificateRequestPage = page<CertificateRequestItem>([
	{
		id: "241a9ba8-b4d0-4a20-8684-486847ae98a4",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		status: "PENDING",
		requestedAt: "2026-08-13T05:40:00Z",
	},
	{
		id: "3b2c1d0e-9f8e-4a7d-8c6b-5a4938271605",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		status: "APPROVED",
		requestedAt: "2026-08-12T02:10:00Z",
	},
	{
		id: "7c6d5e4f-3a2b-4190-8877-665544332211",
		deviceId: "1a1b2c3d-0000-4000-8000-000000000002",
		status: "REJECTED",
		requestedAt: "2026-08-11T09:00:00Z",
	},
]) satisfies PageResponse<CertificateRequestItem>;

export const certificateRequestDetail = {
	id: "241a9ba8-b4d0-4a20-8684-486847ae98a4",
	deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
	status: "PENDING",
	subjectDn: "CN=sensor-floor-01",
	sanUri: "urn:certgate:device:sensor-floor-01",
	publicKeyAlgorithm: "EC P-256",
	fingerprintSha256: "9f2c4a1b8e0d6f3a5c7b9d1e2f4a6c8b0d2e4f6a8c0b2d4e6f8a0c2b4d6e8f0a",
	requestedAt: "2026-08-13T05:40:00Z",
	decidedAt: null,
	decisionNote: null,
} satisfies CertificateRequestDetail;

/** 상태 필터가 실제로 다른 결과를 보여주도록 네 상태를 모두 담아 둔다. */
export const certificatePage = page<CertificateItem>([
	{
		id: "74ecff78-d52a-4f80-ae54-ac688b1c93ad",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		serialNumber: "7F28A109",
		status: "VALID",
		notBefore: "2026-08-13T05:45:00Z",
		notAfter: "2026-09-12T05:45:00Z",
		issuedAt: "2026-08-13T05:45:00Z",
		revokedAt: null,
		revocationReason: null,
		revocationNote: null,
	},
	{
		id: "b1a2c3d4-5e6f-4708-9a1b-2c3d4e5f6071",
		deviceId: "1a1b2c3d-0000-4000-8000-000000000002",
		serialNumber: "9A3F1C22",
		status: "EXPIRING_SOON",
		notBefore: "2026-07-13T05:45:00Z",
		notAfter: "2026-08-20T05:45:00Z",
		issuedAt: "2026-07-13T05:45:00Z",
		revokedAt: null,
		revocationReason: null,
		revocationNote: null,
	},
	{
		id: "c2b3a4d5-6f70-4819-8a2b-3c4d5e6f7082",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		serialNumber: "5D8E2B10",
		status: "EXPIRED",
		notBefore: "2026-05-13T05:45:00Z",
		notAfter: "2026-07-13T05:45:00Z",
		issuedAt: "2026-05-13T05:45:00Z",
		revokedAt: null,
		revocationReason: null,
		revocationNote: null,
	},
	{
		id: "d3c4b5e6-7081-492a-9b3c-4d5e6f708193",
		deviceId: "1a1b2c3d-0000-4000-8000-000000000002",
		serialNumber: "1F4A9C77",
		status: "REVOKED",
		notBefore: "2026-06-13T05:45:00Z",
		notAfter: "2026-09-13T05:45:00Z",
		issuedAt: "2026-06-13T05:45:00Z",
		revokedAt: "2026-08-01T09:00:00Z",
		revocationReason: "KEY_COMPROMISE",
		revocationNote: "단말 분실 신고",
	},
]) satisfies PageResponse<CertificateItem>;

/**
 * `GET /certificates/{id}/download`의 응답 모양만 흉내낸 가짜 값이다. 실제 인증서가
 * 아니며 저장소에 인증서·Key 파일을 두지 않는다는 규칙(.gitignore, CI secret-scan)과도
 * 어긋나지 않는다.
 */
export const certificatePem = "-----BEGIN CERTIFICATE-----\nMOCK-CERTGATE-TEST-ONLY\n-----END CERTIFICATE-----\n";

export const securityEventPage = page<SecurityEvent>([
	{
		id: "c8c78370-174f-4f88-b230-784e2d9115be",
		occurredAt: "2026-08-13T05:50:00Z",
		type: "ACCESS",
		severity: "INFO",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		certificateSerial: "7F28A109",
		httpMethod: "POST",
		requestPath: "/telemetry",
		decision: "ALLOWED",
		reasonCode: "REQUEST_ALLOWED",
		clientIp: "203.0.113.21",
		latencyMs: 12,
		traceId: "8a6ba949-f3ec-4916-aae2-d55bd787893d",
	},
	{
		id: "e1e2e3e4-0000-4000-8000-000000000009",
		occurredAt: "2026-08-13T05:52:00Z",
		type: "SYSTEM",
		severity: "CRITICAL",
		deviceId: null,
		certificateSerial: null,
		httpMethod: null,
		requestPath: null,
		decision: "ERROR",
		reasonCode: "EVENT_OUTBOX_BACKLOG",
		clientIp: null,
		latencyMs: null,
		traceId: "b0b1b2b3-0000-4000-8000-00000000000a",
	},
]) satisfies PageResponse<SecurityEvent>;

export const roles = [
	{
		name: "SENSOR",
		rules: [
			{ httpMethod: "POST", pathPattern: "/telemetry", effect: "ALLOW", priority: 10 },
			{ httpMethod: "POST", pathPattern: "/heartbeat", effect: "ALLOW", priority: 20 },
		],
	},
	{ name: "OPERATOR", rules: [{ httpMethod: "GET", pathPattern: "/commands", effect: "ALLOW", priority: 10 }] },
] satisfies RoleResponse[];

export const dashboardSummary = {
	devices: { active: 24, total: 27 },
	certificates: { valid: 22, expiringSoon: 2 },
	pendingCertificateRequests: 3,
	criticalEvents24h: 2,
	requestBuckets: [{ startedAt: "2026-08-13T04:00:00Z", allowed: 208, denied: 4 }],
	services: [
		{ name: "gateway", status: "UP", latencyMs: 12 },
		{ name: "management-api", status: "UP", latencyMs: 3 },
		{ name: "postgres", status: "UP", latencyMs: 1 },
	],
	outbox: { pendingCount: 12, oldestAgeSeconds: 24 },
	recentCriticalEvents: [securityEventPage.content[1]],
} satisfies DashboardSummary;

/**
 * Mock 모드에서 CRITICAL Toast를 실제로 띄워 보기 위해 "방금 발생한" Event를 만든다.
 *
 * fixture 목록에 미리 넣어 두면 안 된다 — Provider는 마운트할 때 서버의 최신 CRITICAL을
 * 읽어 커서를 세우고 그것들을 이미 본 것으로 표시하므로, 페이지를 열기 전부터 있던
 * Event로는 알림이 뜨지 않는다(그게 올바른 동작이다).
 */
export function newCriticalEvent(occurredAt: string): SecurityEvent {
	return {
		id: crypto.randomUUID(),
		occurredAt,
		type: "ACCESS",
		severity: "CRITICAL",
		deviceId: devicePage.content[1].id,
		certificateSerial: "9A3F1C22",
		httpMethod: "POST",
		requestPath: "/telemetry",
		decision: "DENIED",
		reasonCode: "CERTIFICATE_REVOKED",
		clientIp: "203.0.113.44",
		latencyMs: 6,
		traceId: crypto.randomUUID(),
	} satisfies SecurityEvent;
}

/**
 * 그 Event를 SSE `data` 필드 모양으로 바꾼다(docs/api-spec.md §9 "SSE 형식").
 * `message`는 서버가 Reason Code로 만들어 보내는 사용자용 문구다(CriticalEventMessages).
 */
export function criticalEventPayload(event: SecurityEvent): CriticalEventPayload {
	return {
		eventId: event.id,
		occurredAt: event.occurredAt,
		deviceKey: devicePage.content[1].deviceKey,
		reasonCode: event.reasonCode,
		message: "폐기된 인증서의 접근이 차단되었습니다.",
	} satisfies CriticalEventPayload;
}
