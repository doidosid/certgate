import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useRoles } from "./queries";

interface Props {
	query: string;
	status: string;
	roleName: string;
	onChange: (key: "query" | "status" | "roleName", value: string) => void;
}

/** ui-design.md §4 "검색·필터: 이름, Device Key, 상태, Role". */
export default function DeviceFilters({ query, status, roleName, onChange }: Props) {
	const roles = useRoles();

	// URL에서 읽은 roleName이 아직 목록에 없으면(로딩 중이거나 조회 실패) select가
	// 값을 표시하지 못하고 out-of-range 상태가 된다. 현재 값을 임시 option으로
	// 보존해 URL 상태와 화면이 어긋나지 않게 한다.
	const loadedRoleNames = (roles.data ?? []).map((role) => role.name);
	const roleOptions =
		roleName && !loadedRoleNames.includes(roleName) ? [roleName, ...loadedRoleNames] : loadedRoleNames;

	return (
		<Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
			<TextField
				label="이름 또는 Device Key"
				size="small"
				value={query}
				onChange={(event) => onChange("query", event.target.value)}
				sx={{ minWidth: 240 }}
			/>
			<TextField
				select
				label="상태"
				size="small"
				value={status}
				onChange={(event) => onChange("status", event.target.value)}
				sx={{ minWidth: 140 }}
			>
				<MenuItem value="">전체</MenuItem>
				<MenuItem value="ACTIVE">활성</MenuItem>
				<MenuItem value="DISABLED">비활성</MenuItem>
			</TextField>
			<TextField
				select
				label="Role"
				size="small"
				value={roleName}
				onChange={(event) => onChange("roleName", event.target.value)}
				sx={{ minWidth: 160 }}
				disabled={roles.isPending || roles.isError}
				// Role 목록만 실패해도 Device 목록은 정상이다. 필터가 왜 안 되는지
				// 알려주지 않으면 사용자는 기능이 사라진 이유를 알 수 없다.
				error={roles.isError}
				helperText={roles.isError ? "Role 목록을 불러오지 못했습니다." : undefined}
			>
				<MenuItem value="">전체</MenuItem>
				{roleOptions.map((name) => (
					<MenuItem key={name} value={name}>
						{name}
					</MenuItem>
				))}
			</TextField>
		</Box>
	);
}
