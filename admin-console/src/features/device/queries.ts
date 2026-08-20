import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	fetchDevice,
	fetchDevices,
	fetchRoles,
	registerDevice,
	reissueEnrollmentToken,
	updateDeviceRole,
	updateDeviceStatus,
	type DeviceListParams,
} from "./api";
import type { DeviceStatus } from "../../shared/api/types";

export const deviceKeys = {
	all: ["devices"] as const,
	list: (params: DeviceListParams) => [...deviceKeys.all, "list", params] as const,
	detail: (deviceId: string) => [...deviceKeys.all, "detail", deviceId] as const,
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
export function useDeviceOptions(query = "") {
	// list()와 같은 key를 쓴다. 별도 key를 두면 검색어 없는 첫 조회가 같은 요청인데도
	// 두 번 나간다 — 목록의 이름 표시와 필터가 동시에 열리는 화면에서 실제로 그랬다
	// (Codex 리뷰 PR #46 Low).
	const params = { query, page: 0, size: DEVICE_OPTION_LIMIT };
	return useQuery({
		queryKey: deviceKeys.list(params),
		queryFn: () => fetchDevices(params),
		staleTime: 60 * 1000,
	});
}

/** Role 목록은 Seed Data라 자주 바뀌지 않는다. */
export function useRoles() {
	return useQuery({ queryKey: deviceKeys.roles, queryFn: fetchRoles, staleTime: 5 * 60 * 1000 });
}

/*
 * 아래는 Device를 바꾸는 동작들이다(api-spec.md §3). 모두 성공 후 deviceKeys.all을
 * 무효화한다 — 목록·상세·필터 선택지가 같은 Device를 다르게 보여주면 안 된다.
 *
 * 상태·Role 변경은 낙관적 갱신을 하지 않지만, 서버 확정 상태를 화면이 따로 들고 있지도
 * 않는다. 되돌릴 수 있는 동작이라(다시 활성화하거나 Role을 되돌리면 된다) 재조회가
 * 늦어도 사용자가 잘못된 판단을 하게 만들지 않는다. 되돌릴 수 없는 CSR 승인·인증서
 * 폐기에서만 확정 상태를 들고 있는다.
 */
function useDeviceMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: deviceKeys.all }),
	});
}

export function useRegisterDevice() {
	return useDeviceMutation((input: { deviceKey: string; name: string; roleName: string }) =>
		registerDevice(input),
	);
}

export function useUpdateDeviceStatus() {
	return useDeviceMutation((input: { deviceId: string; status: DeviceStatus }) =>
		updateDeviceStatus(input.deviceId, input.status),
	);
}

export function useUpdateDeviceRole() {
	return useDeviceMutation((input: { deviceId: string; roleName: string }) =>
		updateDeviceRole(input.deviceId, input.roleName),
	);
}

/** 재발급하면 기존 활성 Token은 서버에서 폐기된다(security-design.md §2). */
export function useReissueToken() {
	return useDeviceMutation((input: { deviceId: string }) => reissueEnrollmentToken(input.deviceId));
}
