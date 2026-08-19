import { apiGet, apiSend } from "../../shared/api/client";
import type {
	DeviceDetail,
	DeviceListItem,
	DeviceRegistered,
	DeviceStatus,
	DeviceSummary,
	EnrollmentTokenIssued,
	PageResponse,
	RoleResponse,
} from "../../shared/api/types";

export interface DeviceListParams {
	query?: string;
	status?: string;
	roleName?: string;
	page: number;
	size: number;
}

export function fetchDevices(params: DeviceListParams): Promise<PageResponse<DeviceListItem>> {
	return apiGet("/devices", { ...params });
}

export function fetchDevice(deviceId: string): Promise<DeviceDetail> {
	return apiGet(`/devices/${deviceId}`);
}

export function fetchRoles(): Promise<RoleResponse[]> {
	return apiGet("/roles");
}

export function registerDevice(body: {
	deviceKey: string;
	name: string;
	roleName: string;
}): Promise<DeviceRegistered> {
	return apiSend("POST", "/devices", body);
}

export function updateDeviceStatus(deviceId: string, status: DeviceStatus): Promise<DeviceSummary> {
	return apiSend("PATCH", `/devices/${deviceId}/status`, { status });
}

export function updateDeviceRole(deviceId: string, roleName: string): Promise<DeviceSummary> {
	return apiSend("PUT", `/devices/${deviceId}/role`, { roleName });
}

/** 재발급 시 기존 활성 Token은 서버에서 폐기된다(security-design.md §2). */
export function reissueEnrollmentToken(deviceId: string): Promise<EnrollmentTokenIssued> {
	return apiSend("POST", `/devices/${deviceId}/enrollment-token`);
}
