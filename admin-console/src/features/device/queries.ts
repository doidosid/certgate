import { useQuery } from "@tanstack/react-query";
import { fetchDevice, fetchDevices, fetchRoles, type DeviceListParams } from "./api";

export const deviceKeys = {
	all: ["devices"] as const,
	list: (params: DeviceListParams) => [...deviceKeys.all, "list", params] as const,
	detail: (deviceId: string) => [...deviceKeys.all, "detail", deviceId] as const,
	roles: ["roles"] as const,
};

export function useDevices(params: DeviceListParams) {
	return useQuery({ queryKey: deviceKeys.list(params), queryFn: () => fetchDevices(params) });
}

export function useDevice(deviceId: string) {
	return useQuery({ queryKey: deviceKeys.detail(deviceId), queryFn: () => fetchDevice(deviceId) });
}

/** Role 목록은 Seed Data라 자주 바뀌지 않는다. */
export function useRoles() {
	return useQuery({ queryKey: deviceKeys.roles, queryFn: fetchRoles, staleTime: 5 * 60 * 1000 });
}
