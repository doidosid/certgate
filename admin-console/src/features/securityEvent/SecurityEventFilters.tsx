import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { DEVICE_OPTION_LIMIT, useDeviceOptions } from "../device/queries";
import { SECURITY_EVENT_REASON_CODES } from "./labels";

export interface SecurityEventFilterValues {
	from: string;
	to: string;
	deviceId: string;
	decision: string;
	severity: string;
	reasonCode: string;
}

interface Props {
	values: SecurityEventFilterValues;
	onChange: (key: keyof SecurityEventFilterValues, value: string) => void;
}

/** ui-design.md §7 "검색·필터: 기간, 디바이스, 결과, 이벤트 코드, 심각도". */
export default function SecurityEventFilters({ values, onChange }: Props) {
	const devices = useDeviceOptions();

	const loaded = devices.data?.content ?? [];
	const loadedOptions = loaded.map((device) => ({ id: device.id, label: device.name }));

	// URL에 있던 값이 아직(또는 끝내) 목록에 없으면 select가 값을 표시하지 못하고
	// out-of-range가 된다. 현재 값을 임시 선택지로 남겨 URL 상태와 화면이 어긋나지
	// 않게 한다(DeviceFilters의 roleName과 같은 판단).
	const deviceOptions =
		values.deviceId && !loaded.some((device) => device.id === values.deviceId)
			? [{ id: values.deviceId, label: values.deviceId }, ...loadedOptions]
			: loadedOptions;

	const knownReasonCodes: readonly string[] = SECURITY_EVENT_REASON_CODES;
	const reasonCodeOptions =
		values.reasonCode && !knownReasonCodes.includes(values.reasonCode)
			? [values.reasonCode, ...knownReasonCodes]
			: knownReasonCodes;

	const truncated = (devices.data?.totalElements ?? 0) > loaded.length;

	let deviceHelperText: ReactNode = undefined;
	if (devices.isError) {
		// Event 목록과 별개로 실패한다. 조용히 두면 필터가 이유 없이 비어 보인다
		// (Codex 리뷰 PR #44 Low). 새로고침 없이 되돌릴 수 있게 재시도를 붙인다.
		deviceHelperText = (
			<>
				Device 목록을 불러오지 못했습니다.{" "}
				<Link
					component="button"
					type="button"
					aria-label="Device 목록 다시 불러오기"
					onClick={() => void devices.refetch()}
				>
					다시 시도
				</Link>
			</>
		);
	} else if (truncated) {
		deviceHelperText = `Device가 많아 처음 ${DEVICE_OPTION_LIMIT}개만 표시합니다.`;
	}

	return (
		<Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
			<TextField
				label="시작"
				type="datetime-local"
				size="small"
				value={values.from}
				slotProps={{ inputLabel: { shrink: true } }}
				onChange={(event) => onChange("from", event.target.value)}
			/>
			<TextField
				label="종료"
				type="datetime-local"
				size="small"
				value={values.to}
				slotProps={{ inputLabel: { shrink: true } }}
				onChange={(event) => onChange("to", event.target.value)}
			/>
			{/*
			 * 조회 실패에도 disabled로 두지 않는다 — URL로 들어온 deviceId 필터를
			 * "전체"로 되돌릴 방법이 없어지기 때문이다.
			 */}
			<TextField
				select
				label="디바이스"
				size="small"
				sx={{ minWidth: 200 }}
				value={values.deviceId}
				onChange={(event) => onChange("deviceId", event.target.value)}
				error={devices.isError}
				helperText={deviceHelperText}
			>
				<MenuItem value="">전체</MenuItem>
				{deviceOptions.map((option) => (
					<MenuItem key={option.id} value={option.id}>
						{option.label}
					</MenuItem>
				))}
			</TextField>
			<TextField
				select
				label="결과"
				size="small"
				sx={{ minWidth: 120 }}
				value={values.decision}
				onChange={(event) => onChange("decision", event.target.value)}
			>
				<MenuItem value="">전체</MenuItem>
				<MenuItem value="ALLOWED">허용</MenuItem>
				<MenuItem value="DENIED">차단</MenuItem>
				<MenuItem value="ERROR">오류</MenuItem>
			</TextField>
			<TextField
				select
				label="심각도"
				size="small"
				sx={{ minWidth: 120 }}
				value={values.severity}
				onChange={(event) => onChange("severity", event.target.value)}
			>
				<MenuItem value="">전체</MenuItem>
				<MenuItem value="CRITICAL">심각</MenuItem>
				<MenuItem value="WARNING">경고</MenuItem>
				<MenuItem value="INFO">정보</MenuItem>
			</TextField>
			{/*
			 * 이벤트 코드는 자유 입력이 아니라 선택이다. Reason Code는 서버가 정한
			 * 닫힌 집합이라(api-spec.md §10) 오타 한 글자로 결과가 0건이 되는 입력을
			 * 사용자에게 맡길 이유가 없다.
			 */}
			<TextField
				select
				label="이벤트 코드"
				size="small"
				sx={{ minWidth: 220 }}
				value={values.reasonCode}
				onChange={(event) => onChange("reasonCode", event.target.value)}
			>
				<MenuItem value="">전체</MenuItem>
				{reasonCodeOptions.map((code) => (
					<MenuItem key={code} value={code}>
						{code}
					</MenuItem>
				))}
			</TextField>
		</Box>
	);
}
