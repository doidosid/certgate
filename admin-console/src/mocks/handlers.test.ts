import { describe, expect, it } from "vitest";
import { apiGet } from "../shared/api/client";
import type {
	DashboardSummary,
	DeviceDetail,
	DeviceListItem,
	PageResponse,
	RoleResponse,
	SecurityEvent,
} from "../shared/api/types";
import * as fixtures from "./fixtures";

/**
 * Task 3의 HTTP Client와 Task 4의 Mock이 실제로 맞물리는지 확인한다. 각각을
 * 따로 검증하면 둘 사이의 Base URL·경로 불일치는 화면 작업에 들어가서야 드러난다.
 * setupTests.ts가 onUnhandledRequest: "error"로 켜 두었으므로, 여기서 요청이
 * 가로채지지 않으면 테스트가 통과하지 못한다.
 */
describe("MSW handlers", () => {
	it("serves the device page fixture through apiGet", async () => {
		const page = await apiGet<PageResponse<DeviceListItem>>("/devices");

		expect(page).toEqual(fixtures.devicePage);
	});

	/** 목록 항목이 아니라 상세 계약을 확인한다 — 두 Type은 필드가 다르다. */
	it("serves the device detail contract on a path-parameterised route", async () => {
		const detail = await apiGet<DeviceDetail>(`/devices/${fixtures.devicePage.content[0].id}`);

		expect(detail).toEqual(fixtures.deviceDetail);
		expect(detail.policyRules).not.toHaveLength(0);
		expect(detail.certificate).not.toBeNull();
		expect(detail.recentEvents[0].reasonCode).toBe("REQUEST_ALLOWED");
	});

	it("serves a security event whose nullable fields are actually null", async () => {
		const page = await apiGet<PageResponse<SecurityEvent>>("/security-events");
		const systemEvent = page.content.find((event) => event.type === "SYSTEM");

		// SYSTEM Event는 특정 Device·요청에 묶이지 않는다(docs/data-model.md).
		expect(systemEvent?.deviceId).toBeNull();
		expect(systemEvent?.httpMethod).toBeNull();
		// 반대로 이 셋은 NOT NULL이라 어떤 Event에서도 값이 있어야 한다.
		expect(systemEvent?.decision).toBeTruthy();
		expect(systemEvent?.reasonCode).toBeTruthy();
		expect(systemEvent?.traceId).toBeTruthy();
	});

	it("serves the dashboard summary with its nullable outbox present", async () => {
		const summary = await apiGet<DashboardSummary>("/dashboard/summary");

		expect(summary.outbox).toEqual({ pendingCount: 12, oldestAgeSeconds: 24 });
		expect(summary.services).toHaveLength(3);
	});

	it("serves /roles as a bare array, not a page", async () => {
		const roles = await apiGet<RoleResponse[]>("/roles");

		expect(Array.isArray(roles)).toBe(true);
		expect(roles.map((role) => role.name)).toEqual(["SENSOR", "OPERATOR"]);
	});

	/**
	 * status=ACTIVE는 devicePage의 두 항목(ACTIVE·DISABLED) 중 하나만 남겨야 한다. 필터를
	 * 무시하고 항상 같은 목록을 돌려주면, 화면에서 필터를 바꿔도 아무 변화가 없어 "필터가
	 * 안 먹는다"는 인상을 준다 — 실제로 사용자가 겪은 문제다.
	 */
	it("passes query params through and actually filters by them", async () => {
		const page = await apiGet<PageResponse<DeviceListItem>>("/devices", { page: 0, status: "ACTIVE" });

		expect(page.content).toHaveLength(1);
		expect(page.content[0].status).toBe("ACTIVE");
	});

	/**
	 * 브라우저 Mock(VITE_USE_MOCK=true)은 setupWorker가 /mockServiceWorker.js를
	 * 등록해야 시작된다. 이 파일이 없으면 등록이 실패하고, main.tsx가 그것을
	 * top-level await하므로 React 렌더링까지 도달하지 못해 화면이 통째로 비었다
	 * (Codex 리뷰 PR #43 Medium). Node 기반 setupServer 테스트는 다른 경로라
	 * 이 실패를 잡지 못하므로 asset 존재만이라도 여기서 고정한다.
	 */
	it("keeps the browser worker asset that startMockWorker depends on", () => {
		// import.meta.glob은 Vite가 빌드 시점에 파일 목록으로 치환하므로 Node API 없이
		// (= 브라우저용 tsconfig 안에서) 파일 존재를 확인할 수 있다.
		const workerModules = import.meta.glob("../../public/mockServiceWorker.js");

		expect(Object.keys(workerModules)).toHaveLength(1);
	});
});
