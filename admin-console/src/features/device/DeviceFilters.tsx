import { useEffect, useRef, useState } from "react";
import Paper from "@mui/material/Paper";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useRoles } from "./queries";

interface Props {
	query: string;
	status: string;
	roleName: string;
	onChange: (key: "query" | "status" | "roleName", value: string) => void;
}

/** 입력이 멈춘 뒤 요청을 보낼 때까지 기다리는 시간. */
const SEARCH_DEBOUNCE_MS = 300;

/** ui-design.md §4 "검색·필터: 이름, Device Key, 상태, Role". */
export default function DeviceFilters({ query, status, roleName, onChange }: Props) {
	const roles = useRoles();

	// 검색어는 입력 중에도 화면에 즉시 반영하고, 서버 요청은 입력이 멈춘 뒤에만
	// 보낸다. URL(=요청 조건)을 keystroke마다 갱신하면 글자 수만큼 요청이 나간다
	// (Codex 리뷰 PR #44 Low).
	const [searchText, setSearchText] = useState(query);

	// 뒤로가기·링크 이동처럼 바깥에서 URL이 바뀌면 입력도 그 값을 따라간다.
	useEffect(() => {
		setSearchText(query);
	}, [query]);

	// 호출자가 onChange를 inline 화살표 함수로 넘기면 매 render마다 identity가
	// 바뀐다. 그걸 의존성에 두면 관계없는 re-render(목록 응답 도착 등)마다 타이머가
	// 처음부터 다시 시작해 요청이 계속 밀린다. 최신 함수는 ref로 읽는다.
	const onChangeRef = useRef(onChange);
	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		if (searchText === query) {
			return;
		}
		const timer = setTimeout(() => onChangeRef.current("query", searchText), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [searchText, query]);

	// URL에서 읽은 roleName이 아직 목록에 없으면(로딩 중이거나 조회 실패) select가
	// 값을 표시하지 못하고 out-of-range 상태가 된다. 현재 값을 임시 option으로
	// 보존해 URL 상태와 화면이 어긋나지 않게 한다.
	const loadedRoleNames = (roles.data ?? []).map((role) => role.name);
	const roleOptions =
		roleName && !loadedRoleNames.includes(roleName) ? [roleName, ...loadedRoleNames] : loadedRoleNames;

	return (
		<Paper sx={{ p: 2, mb: 2.5, display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}>
			<TextField
				label="이름 또는 Device Key"
				size="small"
				value={searchText}
				onChange={(event) => setSearchText(event.target.value)}
				sx={{ width: 260 }}
			/>
			<TextField
				select
				label="상태"
				size="small"
				value={status}
				onChange={(event) => onChange("status", event.target.value)}
				sx={{ width: 128 }}
			>
				<MenuItem value="">전체</MenuItem>
				<MenuItem value="ACTIVE">활성</MenuItem>
				<MenuItem value="DISABLED">비활성</MenuItem>
			</TextField>
			{/*
			 * Role 목록만 실패해도 Device 목록은 정상이다. 필터가 왜 안 되는지 알려주고,
			 * 새로고침 없이 되돌릴 수 있게 재시도를 붙인다(Codex 리뷰 PR #44 Low).
			 * 실패에도 disabled로 두지 않는다 — URL로 들어온 Role 필터를 "전체"로
			 * 되돌릴 방법이 없어지기 때문이다.
			 */}
			<TextField
				select
				label="Role"
				size="small"
				value={roleName}
				onChange={(event) => onChange("roleName", event.target.value)}
				sx={{ width: 176 }}
				error={roles.isError}
				helperText={
					roles.isError ? (
						<>
							Role 목록을 불러오지 못했습니다.{" "}
							<Link
								component="button"
								type="button"
								aria-label="Role 목록 다시 불러오기"
								onClick={() => void roles.refetch()}
							>
								다시 시도
							</Link>
						</>
					) : undefined
				}
			>
				<MenuItem value="">전체</MenuItem>
				{roleOptions.map((name) => (
					<MenuItem key={name} value={name}>
						{name}
					</MenuItem>
				))}
			</TextField>
		</Paper>
	);
}
