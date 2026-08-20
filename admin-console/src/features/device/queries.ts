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
 * 아래는 Device를 바꾸는 동작들이다(api-spec.md §3).
 *
 * 상태·Role 변경은 성공 후 deviceKeys.all을 무효화한다 — 목록·상세·필터 선택지가 같은
 * Device를 다르게 보여주면 안 된다. 무효화는 fire-and-forget이다. Promise를 onSuccess에서
 * 반환하면 React Query가 그것을 기다린 뒤에야 호출자 콜백을 실행하므로, 재조회가 느릴 때
 * 확인 Dialog가 계속 pending으로 남아 취소도 못 하게 된다.
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
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
		},
	});
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

/** 발급된 Enrollment Token. 평문은 이 값 안에만 있고 화면의 지역 상태로 바로 넘어간다. */
export interface IssuedEnrollmentToken {
	token: string;
	expiresAt: string;
}

/*
 * Token을 돌려주는 두 동작은 일반 Device mutation과 분리한다.
 *
 * 이유 — 평문을 mutation의 `data`로 만들면 화면에서 지워도 Mutation Cache에 남는다.
 * `reset()`은 observer만 떼고 `scheduleGc()`를 걸 뿐이어서(query-core mutation.js의
 * removeObserver·optionalRemove) 기본 gcTime 5분 동안 `getMutationCache()`로 평문을
 * 계속 꺼낼 수 있다. 서버가 한 번만 주는 값을 그렇게 오래 들고 있을 이유가 없다
 * (security-design.md §2, Codex 리뷰 PR #47 Critical).
 *
 * 그래서 응답을 받은 자리에서 호출자에게 넘기고 `void`를 반환한다 — 평문이 mutation
 * 상태에 들어가는 경로 자체를 없앤다. `gcTime: 0`은 그래도 남는 mutation 껍데기를 바로
 * 치우기 위한 것이다. `variables`에는 비밀이 없다(deviceKey·name·roleName·deviceId).
 */
export function useRegisterDevice(onIssued: (issued: IssuedEnrollmentToken) => void) {
	const queryClient = useQueryClient();
	return useMutation({
		gcTime: 0,
		mutationFn: async (input: { deviceKey: string; name: string; roleName: string }) => {
			const device = await registerDevice(input);
			onIssued({ token: device.enrollmentToken, expiresAt: device.enrollmentExpiresAt });
			// 새 Device가 목록·필터 선택지에 나타나야 한다. Token 표시를 막지 않게 기다리지 않는다.
			void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
		},
	});
}

/**
 * 재발급하면 기존 활성 Token은 서버에서 폐기된다(security-design.md §2).
 *
 * Device query는 무효화하지 않는다 — Device 목록·상세 응답에 Enrollment 정보가 없어서
 * (DeviceListItemResponse·DeviceDetailResponse) 다시 읽어도 바뀌는 것이 없다.
 */
export function useReissueToken(onIssued: (issued: IssuedEnrollmentToken) => void) {
	return useMutation({
		gcTime: 0,
		mutationFn: async (input: { deviceId: string }) => {
			const issued = await reissueEnrollmentToken(input.deviceId);
			onIssued({ token: issued.enrollmentToken, expiresAt: issued.enrollmentExpiresAt });
		},
	});
}
