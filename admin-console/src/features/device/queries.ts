import { useQuery } from "@tanstack/react-query";
import { fetchDevice, fetchDevices, fetchRoles, type DeviceListParams } from "./api";

export const deviceKeys = {
	all: ["devices"] as const,
	list: (params: DeviceListParams) => [...deviceKeys.all, "list", params] as const,
	detail: (deviceId: string) => [...deviceKeys.all, "detail", deviceId] as const,
	options: ["devices", "options"] as const,
	roles: ["roles"] as const,
};

/** api-spec.md §1: size 상한이 100이다. 그보다 많은 Device는 이 목록에 담기지 않는다. */
export const DEVICE_OPTION_LIMIT = 100;

export function useDevices(params: DeviceListParams) {
	return useQuery({ queryKey: deviceKeys.list(params), queryFn: () => fetchDevices(params) });
}

export function useDevice(deviceId: string) {
	return useQuery({
		queryKey: deviceKeys.detail(deviceId),
		queryFn: () => fetchDevice(deviceId),
		// 빈 id로 부르면 `/devices/`를 요청해 의미 없는 오류를 만든다. 선택값이 없는
		// 필터(DeviceSelect)처럼 id가 아직 없는 호출자가 있다.
		enabled: deviceId !== "",
	});
}

/**
 * Device를 id가 아니라 이름으로 보여주거나 고르게 하려면 목록이 필요하다. Security
 * Event 응답에는 deviceId(UUID)만 있어서(SecurityEventResponse) 이 조회 없이는
 * ui-design.md §7의 "디바이스" 열과 필터를 사람이 읽을 수 있게 만들 수 없다.
 *
 * 여러 컴포넌트가 같은 key를 쓰므로 React Query가 요청을 하나로 합친다. totalElements가
 * content.length보다 크면 잘린 것이고, 그 사실은 화면이 드러내야 한다 — 조용히 자르면
 * 사용자는 특정 Device를 필터에서 찾지 못하는 이유를 알 수 없다.
 */
export function useDeviceOptions() {
	return useQuery({
		queryKey: deviceKeys.options,
		queryFn: () => fetchDevices({ page: 0, size: DEVICE_OPTION_LIMIT }),
		staleTime: 60 * 1000,
	});
}

/** Role 목록은 Seed Data라 자주 바뀌지 않는다. */
export function useRoles() {
	return useQuery({ queryKey: deviceKeys.roles, queryFn: fetchRoles, staleTime: 5 * 60 * 1000 });
}
