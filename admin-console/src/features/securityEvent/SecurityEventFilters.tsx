import Paper from "@mui/material/Paper";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import DeviceSelect from "../device/DeviceSelect";
import { localDateTimeToInstant } from "../../shared/api/localDateTime";
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
	// URL에 있던 값이 선택지에 없으면 select가 값을 표시하지 못하고 out-of-range가
	// 된다. 현재 값을 임시 선택지로 남겨 URL 상태와 화면이 어긋나지 않게 한다.
	const knownReasonCodes: readonly string[] = SECURITY_EVENT_REASON_CODES;
	const reasonCodeOptions =
		values.reasonCode && !knownReasonCodes.includes(values.reasonCode)
			? [values.reasonCode, ...knownReasonCodes]
			: knownReasonCodes;

	// 뒤집힌 기간은 서버에서 오류가 아니라 결과 0건으로 돌아온다. 이유를 말해주지
	// 않으면 사용자는 이벤트가 없는 것과 구분할 수 없다.
	const fromInstant = localDateTimeToInstant(values.from);
	const toInstant = localDateTimeToInstant(values.to);
	const rangeReversed = fromInstant !== undefined && toInstant !== undefined && fromInstant > toInstant;
	const fromInvalid = values.from !== "" && fromInstant === undefined;
	const toInvalid = values.to !== "" && toInstant === undefined;

	return (
		/*
		 * 컨트롤을 페이지 바닥에 흩어 놓지 않고 한 판으로 묶는다. 조건을 세우는 자리와
		 * 결과를 읽는 자리를 눈으로 구분할 수 있어야 한다. 폭을 고정해 접힐 때도 열이
		 * 어긋나지 않게 한다.
		 */
		<Paper sx={{ p: 2, mb: 2.5, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}>
			<TextField
				label="시작"
				type="datetime-local"
				size="small"
				sx={{ width: 190 }}
				value={values.from}
				slotProps={{ inputLabel: { shrink: true } }}
				onChange={(event) => onChange("from", event.target.value)}
				error={fromInvalid}
				helperText={fromInvalid ? "시각으로 읽을 수 없어 조건에서 제외됩니다." : undefined}
			/>
			<TextField
				label="종료"
				type="datetime-local"
				size="small"
				sx={{ width: 190 }}
				value={values.to}
				slotProps={{ inputLabel: { shrink: true } }}
				onChange={(event) => onChange("to", event.target.value)}
				error={toInvalid || rangeReversed}
				helperText={
					toInvalid
						? "시각으로 읽을 수 없어 조건에서 제외됩니다."
						: rangeReversed
							? "종료가 시작보다 앞서 결과가 없습니다."
							: undefined
				}
			/>
			<DeviceSelect value={values.deviceId} onChange={(deviceId) => onChange("deviceId", deviceId)} />
			<TextField
				select
				label="결과"
				size="small"
				sx={{ width: 128 }}
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
				sx={{ width: 128 }}
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
				sx={{ width: 224 }}
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
		</Paper>
	);
}
