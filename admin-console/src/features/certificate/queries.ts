import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	downloadCertificatePem,
	fetchCertificate,
	fetchCertificates,
	revokeCertificate,
	type CertificateListParams,
} from "./api";
import { savePem } from "./savePem";
import { deviceKeys } from "../device/queries";

export const certificateKeys = {
	all: ["certificates"] as const,
	list: (params: CertificateListParams) => [...certificateKeys.all, "list", params] as const,
	detail: (certificateId: string) => [...certificateKeys.all, "detail", certificateId] as const,
};

export function useCertificates(params: CertificateListParams) {
	return useQuery({ queryKey: certificateKeys.list(params), queryFn: () => fetchCertificates(params) });
}

export function useCertificate(certificateId: string) {
	return useQuery({
		queryKey: certificateKeys.detail(certificateId),
		queryFn: () => fetchCertificate(certificateId),
		enabled: certificateId !== "",
	});
}

export function useRevokeCertificate() {
	const queryClient = useQueryClient();

	/**
	 * 폐기는 Device 상세의 인증서 요약도 바꾼다. CSR 목록은 건드리지 않는다 — 폐기가
	 * 기존 요청의 상태를 바꾸지는 않고, 재발급은 새 CSR 요청으로 처리한다
	 * (ui-design.md §6).
	 */
	function invalidateAffected() {
		void queryClient.invalidateQueries({ queryKey: certificateKeys.all });
		void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
	}

	return useMutation({
		mutationFn: (input: { certificateId: string; reason: string; note?: string }) =>
			revokeCertificate(input.certificateId, { reason: input.reason, note: input.note }),
		onSuccess: invalidateAffected,
		/*
		 * 실패해도 다시 읽는다. 409 CONFLICT는 "이미 폐기됨"이므로 화면에 남은 상태가
		 * 낡은 것이고, 응답을 못 받은 경우도 서버가 Commit했는지 알 수 없다. 폐기는
		 * 되돌릴 수 없으니 보수적으로 서버 값을 다시 확인한다.
		 */
		onError: invalidateAffected,
	});
}

/**
 * 다운로드도 mutation으로 다룬다 — 실패를 화면에 보여줘야 하고, 진행 중 버튼을 잠가야
 * 하기 때문이다. 응답을 cache에 남기지 않는 것도 의도다: 인증서 원문을 메모리에
 * 오래 들고 있을 이유가 없다.
 */
export function useDownloadPem() {
	return useMutation({
		mutationFn: async (input: { certificateId: string; serialNumber: string }) => {
			savePem(input.serialNumber, await downloadCertificatePem(input.certificateId));
		},
	});
}
