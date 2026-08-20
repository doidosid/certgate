import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	decideRequest,
	fetchCertificateRequest,
	fetchCertificateRequests,
	type CertificateRequestListParams,
	type DecisionAction,
} from "./api";
import { deviceKeys } from "../device/queries";

export const certificateRequestKeys = {
	all: ["certificate-requests"] as const,
	list: (params: CertificateRequestListParams) => [...certificateRequestKeys.all, "list", params] as const,
	detail: (requestId: string) => [...certificateRequestKeys.all, "detail", requestId] as const,
};

export function useCertificateRequests(params: CertificateRequestListParams) {
	return useQuery({
		queryKey: certificateRequestKeys.list(params),
		queryFn: () => fetchCertificateRequests(params),
	});
}

export function useCertificateRequest(requestId: string) {
	return useQuery({
		queryKey: certificateRequestKeys.detail(requestId),
		queryFn: () => fetchCertificateRequest(requestId),
		enabled: requestId !== "",
	});
}

export function useDecideRequest() {
	const queryClient = useQueryClient();

	/**
	 * 승인은 Intermediate CA가 인증서를 발급하는 동작이라 CSR 목록만 바뀌는 것이
	 * 아니다 — Certificate 목록과 Device 상세의 인증서 요약도 함께 바뀐다.
	 *
	 * 낙관적 갱신은 하지 않는다. 승인은 실패할 수 있고(경합, CA 서명 실패) 되돌릴 수
	 * 없는 동작이라, 서버가 실제로 무엇을 했는지 확인한 뒤 화면을 바꾸는 편이 맞다.
	 */
	function invalidateAffected() {
		void queryClient.invalidateQueries({ queryKey: certificateRequestKeys.all });
		void queryClient.invalidateQueries({ queryKey: ["certificates"] });
		void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
	}

	return useMutation({
		mutationFn: (input: { requestId: string; action: DecisionAction; decisionNote?: string }) =>
			decideRequest(input.requestId, input.action, input.decisionNote),
		onSuccess: invalidateAffected,
		/*
		 * 실패해도 다시 읽는다. 409 CERTIFICATE_REQUEST_NOT_PENDING은 "다른 관리자가
		 * 이미 처리했다"는 뜻이므로, 화면에 남아 있는 PENDING 상태 자체가 낡은 것이다.
		 * 오류만 보여주고 목록을 그대로 두면 같은 버튼을 다시 누르게 된다.
		 */
		onError: invalidateAffected,
	});
}
