import { describe, expect, it } from "vitest";
import { apiGet } from "../shared/api/client";
import type { DashboardSummary, DeviceListItem, PageResponse, RoleResponse } from "../shared/api/types";
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

	it("serves a path-parameterised route", async () => {
		const detail = await apiGet<DeviceListItem>(`/devices/${fixtures.devicePage.content[0].id}`);

		expect(detail).toMatchObject({ deviceKey: "sensor-floor-01" });
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

	it("passes query params through without breaking the match", async () => {
		const page = await apiGet<PageResponse<DeviceListItem>>("/devices", { page: 0, status: "ACTIVE" });

		expect(page.content).toHaveLength(2);
	});
});
