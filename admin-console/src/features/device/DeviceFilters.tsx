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
				disabled={roles.isPending}
			>
				<MenuItem value="">전체</MenuItem>
				{(roles.data ?? []).map((role) => (
					<MenuItem key={role.name} value={role.name}>
						{role.name}
					</MenuItem>
				))}
			</TextField>
		</Box>
	);
}
