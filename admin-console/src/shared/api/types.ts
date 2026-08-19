// docs/api-spec.md의 응답 계약을 그대로 옮긴 Type. 화면 표시용 한국어 라벨과
// 파생 값은 features/*/labels.ts가 담당하고 여기서는 서버가 주는 모양만 표현한다.

export type DeviceStatus = "ACTIVE" | "DISABLED";
export type CertificateStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "REVOKED";
export type CertificateRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type Decision = "ALLOWED" | "DENIED" | "ERROR";
export type Severity = "INFO" | "WARNING" | "CRITICAL";

export interface PageResponse<T> {
	content: T[];
	page: number;
	size: number;
	totalElements: number;
	totalPages: number;
}

export interface FieldError {
	field: string;
	message: string;
}

export interface ErrorResponse {
	code: string;
	message: string;
	traceId: string;
	fieldErrors: FieldError[];
}

export interface RuleView {
	httpMethod: string;
	pathPattern: string;
	effect: string;
	priority: number;
}

export interface RoleResponse {
	name: string;
	rules: RuleView[];
}

export interface DeviceListItem {
	id: string;
	deviceKey: string;
	name: string;
	status: DeviceStatus;
	roleName: string;
	certificateStatus: CertificateStatus | null;
	certificateExpiresAt: string | null;
	lastSeenAt: string | null;
}

export interface DeviceCertificateSummary {
	id: string;
	serialNumber: string;
	status: CertificateStatus;
	expiresAt: string;
}

export interface DeviceEventView {
	id: string;
	occurredAt: string;
	type: string;
	severity: string;
	decision: string | null;
	reasonCode: string | null;
	httpMethod: string | null;
	requestPath: string | null;
}

export interface DeviceDetail {
	id: string;
	deviceKey: string;
	name: string;
	status: DeviceStatus;
	roleName: string;
	createdAt: string;
	lastSeenAt: string | null;
	certificate: DeviceCertificateSummary | null;
	policyRules: RuleView[];
	recentEvents: DeviceEventView[];
}

/** PATCH /devices/{id}/status, PUT /devices/{id}/role의 응답. */
export interface DeviceSummary {
	id: string;
	deviceKey: string;
	name: string;
	status: DeviceStatus;
	roleName: string;
	createdAt: string;
	lastSeenAt: string | null;
}

/**
 * POST /devices 응답에만 enrollmentToken 평문이 1회 포함된다.
 *
 * DeviceSummary를 확장하지 않는다 — 등록 직후에는 접속 이력이 없으므로 서버
 * 응답(DeviceResponse)에 lastSeenAt 자체가 없다. 확장하면 있지도 않은 필드를
 * string | null로 선언하게 된다.
 */
export interface DeviceRegistered {
	id: string;
	deviceKey: string;
	name: string;
	status: DeviceStatus;
	roleName: string;
	createdAt: string;
	enrollmentToken: string;
	enrollmentExpiresAt: string;
}

export interface EnrollmentTokenIssued {
	enrollmentToken: string;
	enrollmentExpiresAt: string;
}

export interface CertificateRequestItem {
	id: string;
	deviceId: string;
	status: CertificateRequestStatus;
	requestedAt: string;
}

export interface CertificateRequestDetail {
	id: string;
	deviceId: string;
	status: CertificateRequestStatus;
	subjectDn: string;
	sanUri: string | null;
	publicKeyAlgorithm: string;
	fingerprintSha256: string;
	requestedAt: string;
	decidedAt: string | null;
	decisionNote: string | null;
}

export interface CertificateItem {
	id: string;
	deviceId: string;
	serialNumber: string;
	status: CertificateStatus;
	notBefore: string;
	notAfter: string;
	issuedAt: string;
	revokedAt: string | null;
	revocationReason: string | null;
	revocationNote: string | null;
}

export interface SecurityEvent {
	id: string;
	occurredAt: string;
	type: string;
	severity: string;
	deviceId: string | null;
	certificateSerial: string | null;
	httpMethod: string | null;
	requestPath: string | null;
	decision: string | null;
	reasonCode: string | null;
	clientIp: string | null;
	latencyMs: number | null;
	traceId: string | null;
}

/** SSE `critical-security-event`의 data 필드 (docs/api-spec.md §9). */
export interface CriticalEventPayload {
	eventId: string;
	occurredAt: string;
	deviceKey: string | null;
	reasonCode: string;
	message: string;
}

export interface DashboardSummary {
	devices: { active: number; total: number };
	certificates: { valid: number; expiringSoon: number };
	pendingCertificateRequests: number;
	criticalEvents24h: number;
	requestBuckets: Array<{ startedAt: string; allowed: number; denied: number }>;
	services: Array<{ name: string; status: "UP" | "DOWN"; latencyMs: number | null }>;
	/** Gateway를 조회하지 못하면 null이다 — Dashboard 나머지는 그대로 온다. */
	outbox: { pendingCount: number; oldestAgeSeconds: number } | null;
	recentCriticalEvents: SecurityEvent[];
}
