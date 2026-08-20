import { useEffect, useRef, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import { DEVICE_OPTION_LIMIT, useDevice, useDevices } from "./queries";

interface Option {
	id: string;
	label: string;
}

interface Props {
	/** 선택된 deviceId. 비어 있으면 "전체"다. */
	value: string;
	onChange: (deviceId: string) => void;
	label?: string;
}

/** 입력이 멈춘 뒤 서버 검색을 보낼 때까지 기다리는 시간. */
const SEARCH_DEBOUNCE_MS = 300;

function toOption(device: { id: string; name: string; deviceKey: string }): Option {
	return { id: device.id, label: `${device.name} (${device.deviceKey})` };
}

/**
 * Device를 고르는 필터. 한 번에 100개까지만 받아오는 목록(api-spec.md §1의 size 상한)을
 * 그대로 select에 넣으면 101번째 이후 Device는 필터에서 고를 수 없다 — Device가 많은
 * 환경에서 ui-design.md §7의 검색 흐름이 일부 Device에 대해 동작하지 않는다
 * (Codex 리뷰 PR #46 Medium). 그래서 선택지를 화면에서 걸러내지 않고 `query`를 서버로
 * 보내 검색한다.
 *
 * 선택된 Device의 이름은 검색 결과가 아니라 `GET /devices/{id}`로 따로 확인한다. 검색어를
 * 바꾸면 현재 선택값이 결과 목록에서 사라지는데, 그때 라벨이 UUID로 바뀌면 안 된다.
 *
 * Security Event·CSR·Certificate 목록이 모두 deviceId로 필터하므로(api-spec.md §3~5·§9)
 * 이 컴포넌트는 features/device에 둬서 화면들이 공유한다.
 */
export default function DeviceSelect({ value, onChange, label = "디바이스" }: Props) {
	const [text, setText] = useState("");
	const [search, setSearch] = useState("");

	// 타이핑마다 요청하지 않는다. 입력이 멈춘 뒤 한 번만 검색한다.
	useEffect(() => {
		if (text === search) {
			return;
		}
		const timer = setTimeout(() => setSearch(text), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [text, search]);

	const devices = useDevices({ query: search, page: 0, size: DEVICE_OPTION_LIMIT });
	const selectedDevice = useDevice(value);

	const options = (devices.data?.content ?? []).map(toOption);
	// 선택값이 현재 검색 결과에 없어도 라벨을 잃지 않게 한다. 상세 조회도 아직
	// 못 했으면 UUID를 그대로 드러낸다 — 무엇이 걸려 있는지는 알 수 있어야 한다.
	const selectedOption: Option | null =
		value === ""
			? null
			: (options.find((option) => option.id === value) ??
				(selectedDevice.data ? toOption(selectedDevice.data) : { id: value, label: value }));

	const matched = devices.data?.totalElements ?? 0;
	const hasMoreMatches = matched > (devices.data?.content.length ?? 0);

	// 목록이 실패해도 Autocomplete를 잠그지 않는다 — URL로 들어온 필터를 "전체"로
	// 되돌릴 방법이 없어지기 때문이다(Codex 리뷰 PR #44 Low).
	const onChangeRef = useRef(onChange);
	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	let helperText: React.ReactNode = undefined;
	if (devices.isError) {
		helperText = (
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
	} else if (hasMoreMatches) {
		helperText = `일치하는 Device가 ${DEVICE_OPTION_LIMIT}개를 넘습니다(${matched}개). 검색어를 좁히세요.`;
	}

	return (
		<Autocomplete
			sx={{ minWidth: 260 }}
			size="small"
			options={options}
			value={selectedOption}
			onChange={(_, option) => onChangeRef.current(option?.id ?? "")}
			onInputChange={(_, next, reason) => {
				if (reason === "input") {
					setText(next);
				}
			}}
			// 걸러내기는 서버가 한다. 화면에서 한 번 더 걸러내면 검색 결과가 사라진다.
			filterOptions={(option) => option}
			isOptionEqualToValue={(a, b) => a.id === b.id}
			getOptionLabel={(option) => option.label}
			loading={devices.isPending}
			noOptionsText={devices.isError ? "Device 목록을 불러오지 못했습니다." : "일치하는 Device가 없습니다."}
			renderInput={(params) => (
				<TextField {...params} label={label} error={devices.isError} helperText={helperText} />
			)}
		/>
	);
}
